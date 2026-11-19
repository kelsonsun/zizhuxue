// v1.7 首页快速查词 / 翻译框：英文单词 → 离线词典（ECDICT）；中文短词 → 离线反查英文词；句子 / 短语 → 机器翻译（AI / 浏览器端侧 / MyMemory，如实标注）。
// 查询历史存在本机（最多 200 条）；结果一键做成卡片（单词 → 生词卡，自动配上你材料里出现过的原句；句子 → 句子卡），进每日复习。
import * as db from '../db.js';
import * as dict from '../dict.js';
import * as ai from '../ai.js';
import * as TR from '../translate.js';
import * as tts from '../tts.js';
import * as L from '../lookup.js';
import * as S from '../sense.js';
import { settings, saveSettings, session, makeCard } from '../state.js';
import { $, $$, esc, toast, confirmDlg, sheet } from '../ui.js';

const PROV_ZH = { dict: '离线词典 ECDICT', rev: '离线词典反查', ai: 'AI 翻译（你配置的接口）', chrome: '浏览器端侧翻译', mymemory: 'MyMemory 机器翻译（第三方）' };
export const histAll = () => db.meta.get('lookupHist', []);
const histSave = list => db.meta.set('lookupHist', list);

async function providers() {
  const out = []; if (ai.isConfigured()) out.push('ai');
  if ((await TR.chromeStatus('en2zh').catch(() => 'none')) === 'available') out.push('chrome');
  out.push('mymemory'); return out;
}
/** 机器翻译一句（MyMemory 第一次用要确认：会发到第三方） */
async function mt(text, dir, prov) {
  if (prov === 'mymemory' && !session.mmOk) {
    if (!(await confirmDlg('这句话会发送到第三方公共翻译服务 MyMemory（免费、匿名额度约 5000 字/天）。继续吗？', { ok: '继续翻译' }))) throw new Error('已取消');
    session.mmOk = true;
  }
  if (prov === 'chrome') await TR.chromePrepare(dir);
  const [t] = await TR.translateTexts(prov, [text], dir);
  if (!TR.plausible(text, t || '', dir)) throw new Error('翻译结果看起来不对（' + (t ? '原样返回或语言不符' : '没有结果') + '）');
  return t.trim();
}
/** 查询：返回可存进历史的结果 {q, kind, dir, word?, rev?, tr?, prov} */
export async function query(q, { prov } = {}) {
  const kind = L.classify(q); const s = q.trim();
  if (kind === 'word') {
    const d = await dict.lookup(s).catch(() => null);
    if (d) return { q: s, kind, word: { w: s.toLowerCase(), lemma: d.lemma, phonetic: d.phonetic || '', zh: d.zh, rank: d.rank }, prov: 'dict' };
  }
  if (kind === 'zhword') {
    const rev = await dict.reverse(s, 8).catch(() => []);
    if (rev.length) return { q: s, kind, rev: rev.map(x => ({ w: x.w, zh: x.zh, rank: x.rank, exact: x.exact })), prov: 'rev' };
  }
  const dir = kind === 'zh' || kind === 'zhword' ? 'zh2en' : 'en2zh';
  const p = prov || (await providers())[0];
  return { q: s, kind, dir, tr: await mt(s, dir, p), prov: p };
}

/**
 * opts.ctx：() => {en} 当前“原句”（拍照即查：图上的那句话），做生词卡时优先用它当例句；opts.hist=false 不显示查询历史；opts.source 卡片来源
 */
export async function mountQuick(box, { onCard, ctx = null, hist = true, source = 'lookup' } = {}) {
  box.innerHTML = `<form class="qk" id="qkForm" autocomplete="off"><input id="qkIn" type="search" enterkeyhint="search" placeholder="查单词 / 翻译句子（英 ↔ 中）" aria-label="查词或翻译">
    <button class="btn primary" id="qkGo" type="submit">查</button></form><div id="qkRes" role="status"></div><div id="qkHist"></div>`;
  const res = $('#qkRes', box), hb = $('#qkHist', box);
  const drawHist = async () => {
    if (!hist) { hb.innerHTML = ''; return; }
    const h = await histAll();
    hb.innerHTML = h.length ? `<div class="qkh"><span class="muted small">最近查过：</span>${h.slice(0, 6).map((x, i) => `<button class="chip qkhi" data-hi="${i}">${x.carded ? '⭐' : ''}${esc(x.q.length > 18 ? x.q.slice(0, 17) + '…' : x.q)}</button>`).join('')}<button class="chip" id="qkAll">全部（${h.length}）</button></div>` : '';
    $$('[data-hi]', hb).forEach(b => b.onclick = () => show(h[+b.dataset.hi], { fromHist: true }));
    $('#qkAll', hb)?.addEventListener('click', () => openHistory({ onPick: r => show(r, { fromHist: true }), onChange: drawHist }));
  };
  const existing = async term => (await db.cards.all()).find(c => c.term.trim().toLowerCase() === term.trim().toLowerCase());
  async function show(r, { fromHist = false } = {}) {
    $('#qkIn', box).value = r.q;
    const mats = await db.materials.all();
    const parts = [];
    if (r.word) {
      const w = r.word; const mine = [...L.findInMats(mats, w.lemma || w.w), ...L.findInMats(mats, w.w)].filter((x, i, a) => a.findIndex(y => y.sid === x.sid && y.mid === x.mid) === i).slice(0, 3); r.mine = mine;
      parts.push(`<div class="qkw"><b class="qkterm">${esc(w.w)}</b>${w.lemma !== w.w ? ` <span class="muted small">原形 ${esc(w.lemma)}</span>` : ''} ${w.phonetic ? `<span class="muted">/${esc(w.phonetic)}/</span>` : ''} <button class="mini" id="qkSay" aria-label="朗读">🔊</button>
        ${w.rank ? `<span class="tag">词频第 ${w.rank}</span>` : ''}</div><div class="senses">${S.fullHtml(w.zh)}</div>
        ${ctx?.()?.en ? `<div class="muted small">图上的原句：</div><div class="ex small qkctx">${esc(ctx().en)}</div>` : ''}
        ${mine.length ? `<div class="muted small">你的材料里：</div>${mine.map(x => `<div class="ex small">${esc(x.en)}<span class="muted"> —《${esc(x.title)}》</span></div>`).join('')}` : '<div class="muted small">你的材料里还没出现过这个词。</div>'}`);
    } else if (r.rev) {
      parts.push(`<div class="muted small">“${esc(r.q)}”的英文（离线词典反查，常用的在前；义项要自己挑）：</div><div class="qkrev">${r.rev.map((x, i) => `<div class="qkri"><b>${esc(x.w)}</b> <span class="muted small">${esc(S.briefAll(x.zh).text)}</span><button class="mini" data-rcard="${i}">＋卡</button></div>`).join('')}</div>`);
    } else if (r.tr) {
      parts.push(`<div class="qktr"><div class="qksrc">${esc(r.q)}</div><div class="qkout"><b>${esc(r.tr)}</b> <button class="mini" id="qkSay" aria-label="朗读英文">🔊</button></div></div>`);
    }
    const term = r.word ? r.word.w : r.tr ? (r.dir === 'en2zh' ? r.q : r.tr) : '';
    const ex = term ? await existing(r.word ? r.word.lemma : term) || await existing(term) : null;
    res.innerHTML = `<div class="card qkcard">${parts.join('')}
      <div class="muted small qkprov">来源：${esc(PROV_ZH[r.prov] || r.prov)}${r.prov === 'ai' || r.prov === 'mymemory' || r.prov === 'chrome' ? '，机器翻译，仅供参考' : ''}${fromHist ? ' · 来自查询历史（没有重新查）' : ''}</div>
      ${r.word || r.tr ? `<div class="row gap">${ex ? `<span class="tag okt">已在生词本：${esc(ex.term)}</span>` : `<button class="btn primary grow" id="qkCard">⭐ 做成${r.word || r.kind === 'phrase' || r.kind === 'zhword' ? '生词' : '句子'}卡片</button>`}${r.tr && !fromHist ? '<button class="btn" id="qkRetr">换个翻译通道</button>' : ''}</div>` : ''}</div>`;
    $('#qkSay', res)?.addEventListener('click', () => tts.speak(r.word ? r.word.w : r.dir === 'en2zh' ? r.q : r.tr, { rate: settings.rate }).catch(e => toast(e.message)));
    $('#qkCard', res)?.addEventListener('click', () => makeFrom(r));
    $$('[data-rcard]', res).forEach(b => b.onclick = async () => { const x = r.rev[+b.dataset.rcard]; if (await existing(x.w)) return toast('已在生词本里'); const mine = L.findInMats(mats, x.w)[0];
      await db.cards.save(makeCard({ type: 'word', term: x.w, zh: x.zh, sentence: mine ? { en: mine.en, zh: mine.zh } : null, material: mine?.mid || null, sentenceId: mine?.sid || null, source }));
      b.textContent = '✓ 已加'; b.disabled = true; await markCarded(r.q); toast(`已做成生词卡「${x.w}」，会进入每日复习`); onCard?.(); });
    $('#qkRetr', res)?.addEventListener('click', () => pickProv(r));
  }
  async function makeFrom(r) {
    let c;
    const cx = ctx?.()?.en ? ctx() : null;
    if (r.word) { const m0 = cx ? null : r.mine?.[0]; c = makeCard({ type: 'word', term: r.word.w, zh: r.word.zh, phonetic: r.word.phonetic, sentence: cx ? { en: cx.en, zh: cx.zh || '' } : m0 ? { en: m0.en, zh: m0.zh } : null, material: m0?.mid || null, sentenceId: m0?.sid || null, source }); }
    else { const en = r.dir === 'en2zh' ? r.q : r.tr, zh = r.dir === 'en2zh' ? r.tr : r.q; const nw = (en.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length; const isWord = (r.kind === 'phrase' || r.kind === 'zhword' || r.kind === 'word') && nw >= 1 && nw <= 4;
      const mine = isWord && !cx ? L.findInMats(await db.materials.all(), en)[0] : null;
      c = makeCard({ type: isWord ? (/\s/.test(en.trim()) ? 'phrase' : 'word') : 'sentence', term: isWord ? en.trim().replace(/[.!?。！？]+$/, '') : en.trim(), zh, sentence: isWord ? (cx ? { en: cx.en, zh: cx.zh || '' } : mine ? { en: mine.en, zh: mine.zh } : null) : { en: en.trim(), zh }, material: mine?.mid || null, sentenceId: mine?.sid || null, source, note: `查词翻译：${PROV_ZH[r.prov] || r.prov}` }); }
    await db.cards.save(c); await markCarded(r.q);
    toast(`已做成${c.type === 'sentence' ? '句子' : '生词'}卡片，会进入每日复习`); show(r, { fromHist: true }); drawHist(); onCard?.();
  }
  async function markCarded(q) { const h = await histAll(); const x = h.find(y => y.q === q); if (x) { x.carded = true; await histSave(h); } }
  async function pickProv(r) {
    const ps = (await providers()).filter(p => p !== r.prov); if (!ps.length) return toast('没有别的翻译通道：可以在「我的」配置 AI');
    const sh = sheet(`<h3>换个翻译通道</h3><div class="list">${ps.map(p => `<button class="item" data-p="${p}"><b>${esc(PROV_ZH[p])}</b></button>`).join('')}</div>`);
    $$('[data-p]', sh.el).forEach(b => b.onclick = () => { sh.close(); run(r.q, b.dataset.p); });
  }
  async function run(q, prov) {
    if (L.classify(q) === 'empty') return toast('先输入要查的词或句子');
    res.innerHTML = '<div class="muted small">查询中…</div>'; const btn = $('#qkGo', box); btn.disabled = true;
    try {
      const r = await query(q, { prov: prov || settings.qkProv }); if (prov) saveSettings({ qkProv: prov });
      r.id = db.newId(); r.ts = Date.now(); await histSave(L.addHist(await histAll(), r)); await show(r); drawHist();
    } catch (e) { res.innerHTML = `<div class="note small">${e.message === '已取消' ? '已取消翻译。' : '没查到：' + esc(e.message)}${ai.isConfigured() ? '' : ' 没配置 AI 时，句子翻译用 MyMemory（要联网）或浏览器端侧翻译（部分 Chrome 支持）。'}</div>`; }
    finally { btn.disabled = false; }
  }
  $('#qkForm', box).onsubmit = e => { e.preventDefault(); $('#qkIn', box).blur(); run($('#qkIn', box).value); };
  drawHist();
  return { run };
}
/** 全部查询历史：点一条看结果（不重新查），可删一条或清空 */
export async function openHistory({ onPick, onChange } = {}) {
  const sh = sheet(`<h3>查询历史</h3><p class="muted small">只存在这台设备上，最多 200 条。⭐ = 已做成卡片。</p><div id="hlist" class="list"></div><button class="btn danger" id="hclr">清空历史</button>`);
  const draw = async () => {
    const h = await histAll();
    $('#hlist', sh.el).innerHTML = h.length ? h.map((x, i) => `<div class="item hrow"><button class="grow hq" data-p="${i}"><b>${x.carded ? '⭐ ' : ''}${esc(x.q)}</b><span class="muted small">${esc(x.word ? S.briefAll(x.word.zh).text : x.tr || (x.rev || []).map(y => y.w).join(', '))}</span></button><button class="mini" data-d="${i}" aria-label="删除">🗑</button></div>`).join('') : '<p class="muted">还没有查询记录。</p>';
    $$('[data-p]', sh.el).forEach(b => b.onclick = () => { sh.close(); onPick?.(h[+b.dataset.p]); });
    $$('[data-d]', sh.el).forEach(b => b.onclick = async () => { h.splice(+b.dataset.d, 1); await histSave(h); draw(); onChange?.(); });
  };
  $('#hclr', sh.el).onclick = async () => { if (!(await confirmDlg('清空全部查询历史？（已做成的卡片不受影响）', { ok: '清空', danger: true }))) return; await histSave([]); draw(); onChange?.(); };
  draw();
}
