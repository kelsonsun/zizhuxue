// 句子/词级学习工具：点词（多义项）、句子练习（听、跟读、地道表达、语法与翻译方法）。被“章/段/句/词”各级视图共用。
import * as db from './db.js';
import * as ai from './ai.js';
import * as tts from './tts.js';
import * as dict from './dict.js';
import * as sp from './speech.js';
import * as nlp from './nlp.js';
import { settings, aiBtn, makeCard } from './state.js';
import { $, $$, esc, toast, sheet, wordsHtml, tokensOf, hilite } from './ui.js';
import { mountRootBox } from './rootbox.js';

export const recs = new Map(); // 本次打开期间的跟读录音（不落盘）
const cardsOf = ctx => db.cards.all().then(a => a.filter(c => c.materialId === ctx.m.id));
const POSMATCH = { n: /^n/, v: /^v/, a: /^(a|adj)$/, adv: /^adv/, prep: /^prep/, pron: /^pron/, conj: /^conj/, art: /^art/ };
const sensePosOk = (sense, dictPos) => { const k = (dictPos || '').replace('.', ''); const re = POSMATCH[k]; return !!(re && re.test(sense.pos.replace('.', ''))); };

export async function toggleStar(ctx, s) {
  const ex = (await cardsOf(ctx)).find(c => c.type === 'sentence' && c.sentenceId === s.id);
  if (ex) { await db.cards.remove(ex.id); toast('已取消收藏句子'); return false; }
  await db.cards.save(makeCard({ type: 'sentence', term: s.en, zh: s.zh, sentence: { en: s.en, zh: s.zh }, material: ctx.m.id, sentenceId: s.id }));
  toast('已收藏句子，会进入每日复习'); return true;
}

// ================= 词 =================
export async function openWordSheet(ctx, s, k) {
  const m = ctx.m; const toks = tokensOf(s.en); let a = k, b = k, touched = false, src = 'manual', seq = 0;
  let info = { senses: [], guess: [], aiIdx: -1, ai: null, picked: -1 };
  const sh = sheet(`
    <h3>收藏为生词 / 短语</h3>
    <div class="wsent" id="ws"></div>
    <div class="row gap"><button class="mini" id="extL">‹ 前一词</button><input id="wterm" aria-label="词或短语" class="grow"><button class="mini" id="extR">后一词 ›</button><button class="mini" id="wsay" aria-label="朗读">🔊</button></div>
    <div class="field"><label for="wph">音标</label><input id="wph" placeholder="（可空）"></div>
    <div class="field"><label for="wzh">中文释义</label><textarea id="wzh" rows="2" placeholder="释义"></textarea></div>
    <div class="muted small" id="wsrc" role="status"></div>
    <div id="wroot"></div>
    <h3>不同词义（义项）</h3>
    <div id="senses" class="senses"></div>
    <div id="wai-box">${aiBtn('wsense', '判断本句用的义项并补例句')}</div><div class="muted small" id="wsenseMsg" role="status"></div>
    <h3>例句</h3><div id="wex" class="exlist"><p class="muted small">正在查找你材料里的其他用法…</p></div>
    <div class="row gap">${aiBtn('wai', '用AI解释')}<button class="btn primary grow" id="wsave">⭐ 收藏</button></div>`);
  const E = id => $(id, sh.el); const term = () => E('#wterm').value.trim(); const key = () => term().toLowerCase();
  const setSent = () => { E('#ws').innerHTML = hilite(s.en, term()); };
  const setTerm = () => { E('#wterm').value = toks.slice(a, b + 1).join(' '); };
  const existing = async () => (await cardsOf(ctx)).find(c => c.type !== 'sentence' && c.type !== 'expr' && c.term.toLowerCase() === key() && c.sentenceId === s.id);

  const renderSenses = () => {
    const box = E('#senses');
    if (!info.senses.length) { box.innerHTML = `<p class="muted small">${/\s/.test(term()) ? '短语没有离线义项。' : '离线词典里没有这个词的义项。'}${info.ai?.meaning ? '' : ' 释义请手动填写，或配置 AI 后解释。'}</p>${info.ai?.meaning ? aiMeaningHtml() : ''}`; return; }
    box.innerHTML = info.senses.map((x, i) => `<label class="sense ${info.aiIdx === i ? 'ai' : ''} ${info.picked === i ? 'picked' : ''}"><input type="radio" name="sense" value="${i}" ${info.picked === i ? 'checked' : ''}>
      <span><b class="pos">${esc(x.pos) || '·'}</b> ${esc(x.zh)}
      ${info.aiIdx === i ? '<span class="tag okt">AI判断：本句用这个义项</span>' : ''}${info.aiIdx !== i && info.aiIdx < 0 && info.guess.includes(i) ? '<span class="tag">词性相符（本地推测，仅词性）</span>' : ''}${info.picked === i ? '<span class="tag">你选的</span>' : ''}</span></label>`).join('')
      + (info.ai ? aiMeaningHtml() : '') + `<p class="muted small">离线词典（ECDICT）提供义项列表，不带例句；哪个义项贴合本句，需要你判断或由 AI 判断。点一个义项即可把它填为释义。</p>`;
    $$('input[name=sense]', box).forEach(r => r.onchange = () => { info.picked = +r.value; const x = info.senses[info.picked]; E('#wzh').value = `${x.pos} ${x.zh}`.trim(); touched = true; src = 'dict+pick'; renderSenses(); });
  };
  const aiMeaningHtml = () => `<div class="aimean"><b>本句中的意思（AI）：</b>${esc(info.ai.meaning)}${info.ai.reason ? `<div class="muted small">理由：${esc(info.ai.reason)}</div>` : ''}${info.ai.at ? '<div class="muted small">已缓存到这份材料里</div>' : ''}</div>`;
  const renderEx = async () => {
    const t = term(); const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\w*', 'i');
    const out = [];
    for (const mm of await db.materials.all()) { for (const x of mm.sentences || []) { if (x.id !== s.id && x.en && re.test(x.en)) { out.push({ x, mm }); if (out.length >= 3) break; } } if (out.length >= 3) break; }
    const mine = out.map(({ x, mm }) => `<div class="ex"><div>${hilite(x.en, (x.en.match(re) || [t])[0])}</div>${x.zh ? `<div class="muted small">${esc(x.zh)}</div>` : ''}<div class="muted small">来自你的材料《${esc(mm.title)}》</div></div>`).join('');
    const aiEx = (info.ai?.examples || []).map(e => `<div class="ex ai"><div>${hilite(e.en, t)}</div>${e.zh ? `<div class="muted small">${esc(e.zh)}</div>` : ''}<div class="muted small">AI 例句，仅供参考</div></div>`).join('');
    E('#wex').innerHTML = (mine || aiEx) ? mine + aiEx : '<p class="muted small">你的其他材料里还没有出现这个词；词典不带例句。配置 AI 后可以生成例句。</p>';
  };
  const guessPos = async () => {
    info.guess = []; if (!info.senses.length || /\s/.test(term())) return;
    try { const tg = await nlp.tag(s.en); const w = term().toLowerCase(); const hit = tg.find(x => x.w.toLowerCase() === w); if (hit) info.guess = info.senses.map((x, i) => sensePosOk(x, hit.dictPos) ? i : -1).filter(i => i >= 0); } catch { }
  };
  const resolve = async () => {
    const my = ++seq, t = term(); setSent(); touched = false; info = { senses: [], guess: [], aiIdx: -1, ai: null, picked: -1 };
    const cached = s.notes?.[key()]?.sense; if (cached) { info.ai = cached; info.aiIdx = cached.index; }
    const ex = await existing();
    if (ex) { E('#wzh').value = ex.zh; E('#wph').value = ex.phonetic || ''; src = ex.source; E('#wsrc').textContent = '已收藏过这个词（可修改后更新）'; E('#wsave').textContent = '⭐ 更新'; }
    else { E('#wsave').textContent = '⭐ 收藏'; E('#wzh').value = ''; E('#wph').value = ''; }
    let d = null;
    if (!/\s/.test(t)) { try { d = await dict.lookup(t); } catch { } }
    if (my !== seq) return;
    if (/\s/.test(t) || !t) E('#wroot').innerHTML = ''; else mountRootBox(E('#wroot'), t, { lemma: d?.lemma });
    if (d) { info.senses = d.senses; if (cached && cached.index >= 0) info.picked = cached.index; await guessPos(); }
    renderSenses(); renderEx();
    if (ex) { if (ex.sense && d) { const i = d.senses.findIndex(x => x.pos === ex.sense.pos && x.zh === ex.sense.zh); if (i >= 0) { info.picked = i; renderSenses(); } } return; }
    let aiErr = '';
    if (ai.isConfigured()) {
      E('#wsrc').textContent = 'AI 正在解释…';
      try { const r = await ai.defineTerm(t, s.en); if (my !== seq || touched) return; E('#wzh').value = r.zh; E('#wph').value = r.phonetic || d?.phonetic || ''; src = 'ai'; E('#wsrc').textContent = '释义来自 AI（请自行判断是否准确）'; return; }
      catch (e) { aiErr = 'AI 没有成功（' + e.message + '）。'; }
    }
    if (d) { if (touched) return; E('#wzh').value = d.zh.split(' | ').slice(0, 3).join('；'); E('#wph').value = d.phonetic; src = 'dict'; E('#wsrc').textContent = aiErr + '释义来自离线词典（ECDICT，通用义项汇总，请在下面选出贴合本句的义项）'; return; }
    src = 'manual';
    E('#wsrc').textContent = aiErr + (/\s/.test(t) ? '短语没有离线释义' : `离线词典里没有“${t}”`) + (ai.isConfigured() ? '。' : '，且未配置AI。') + '请手动填写释义，或在「我的」里配置AI。';
  };
  setTerm(); resolve();
  E('#extL').onclick = () => { if (a > 0) { a--; setTerm(); resolve(); } };
  E('#extR').onclick = () => { if (b < toks.length - 1) { b++; setTerm(); resolve(); } };
  E('#wterm').onchange = () => resolve();
  E('#wzh').oninput = () => { touched = true; src = (src === 'ai' || src === 'dict') ? src + '+edit' : src; };
  E('#wsay').onclick = () => tts.speak(term(), { rate: ctx.rate() }).catch(e => toast(e.message));
  E('#wai')?.addEventListener('click', async () => {
    const bt = E('#wai'); bt.disabled = true; try { const r = await ai.defineTerm(term(), s.en); E('#wzh').value = r.zh; if (r.phonetic) E('#wph').value = r.phonetic; src = 'ai'; E('#wsrc').textContent = '释义来自 AI（请自行判断是否准确）'; } catch (e) { toast(e.message, 5000); } bt.disabled = false;
  });
  E('#wsense')?.addEventListener('click', async () => {
    const bt = E('#wsense'); bt.disabled = true; E('#wsenseMsg').textContent = 'AI 正在判断义项…';
    try {
      const r = await ai.explainSense(term(), s.en, info.senses); info.ai = r; info.aiIdx = r.index; if (r.index >= 0) info.picked = r.index;
      s.notes = s.notes || {}; s.notes[key()] = { sense: r }; await db.materials.save(m);
      E('#wsenseMsg').textContent = r.index >= 0 ? '已判断，并缓存到材料库。' : 'AI 认为词典里的义项都不贴切，已给出它的解释（见上）。';
      if (!touched) { E('#wzh').value = r.index >= 0 ? `${info.senses[r.index].pos} ${info.senses[r.index].zh}`.trim() : r.meaning; src = 'ai'; }
      renderSenses(); renderEx();
    } catch (e) { E('#wsenseMsg').textContent = '没有成功：' + e.message; }
    bt.disabled = false;
  });
  E('#wsave').onclick = async () => {
    const t = term(); if (!t) return toast('词不能为空');
    const ex = await existing(); const zh = E('#wzh').value.trim();
    const c = ex || makeCard({ type: /\s/.test(t) ? 'phrase' : 'word', term: t, zh, sentence: { en: s.en, zh: s.zh }, material: m.id, sentenceId: s.id });
    c.zh = zh; c.phonetic = E('#wph').value.trim(); c.source = src; c.term = t;
    const pk = info.picked >= 0 ? info.senses[info.picked] : null;
    if (pk) c.sense = { pos: pk.pos, zh: pk.zh, by: info.aiIdx === info.picked ? 'ai' : 'user' }; else if (info.ai?.meaning) c.sense = { pos: '', zh: info.ai.meaning, by: 'ai' };
    await db.cards.save(c); toast(zh ? '已收藏，带上了这句原句' : '已收藏（释义为空，可在生词本里补充）'); sh.close(); ctx.refresh?.();
  };
}

// ================= 句 =================
export function openPractice(ctx, s, opts = {}) {
  const m = ctx.m; let loopTok = 0, recorder = null;
  const attempts = [...(recs.get(s.id)?.attempts || [])]; // 本句历次跟读分数，不限次数
  const sh = sheet(`
    <div class="pen">${s.en ? wordsHtml(s.en) : ''}</div><div class="pzh">${esc(s.zh)}</div>
    <div class="row gap wrap">${ctx.hasOrig?.(s) ? '<button class="btn" id="p0">🎧 原声</button>' : ''}<button class="btn" id="p1">▶ 听</button><button class="btn" id="p2">🐢 慢速</button><button class="btn tog" id="p3">🔂 循环</button></div>
    <h3>跟读</h3>
    <p class="muted small">🎙 第一次点录音，浏览器会请求「麦克风」权限，请点「允许」。录音只保存在本机内存里，不上传；关闭页面即清除。</p>
    <div class="row gap"><button class="btn primary grow" id="rec">🎙 开始跟读</button></div>
    <p class="muted small">跟读不限次数，每次都会单独评分，方便对比效果。</p>
    <div id="recres"></div>
    <h3 id="anasec">语法与翻译方法</h3>
    <div id="localpos" class="posrow"><span class="muted small">正在做本地词性标注…</span></div>
    <div id="analysis"></div>
    <div class="row gap wrap" id="anabtn"></div>
    <h3>收藏与表达</h3>
    <div class="row gap wrap"><button class="btn" id="pstar">☆ 收藏句子</button>${aiBtn('pexpr', '地道表达')}</div>
    <div id="exres"></div>`, { onClose: () => { loopTok++; tts.cancel(); void sp.abortLiveShadowing(); ctx.refresh?.(); } });
  const E = id => $(id, sh.el);
  sh.el.addEventListener('click', e => { const w = e.target.closest('[data-w]'); if (w) openWordSheet(ctx, s, +w.dataset.k); });
  const saySent = rate => tts.speak(s.en, { rate }).catch(e => toast(e.message));
  E('#p0')?.addEventListener('click', () => { loopTok++; E('#p3').classList.remove('on'); ctx.playOrig(s).catch(e => toast(e.message)); });
  E('#p1').onclick = () => { loopTok++; E('#p3').classList.remove('on'); saySent(ctx.rate()); };
  E('#p2').onclick = () => { loopTok++; E('#p3').classList.remove('on'); saySent(0.6); };
  E('#p3').onclick = async (e) => {
    const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); const my = ++loopTok;
    if (!on) { tts.cancel(); return; }
    while (my === loopTok) { const r = await tts.speak(s.en, { rate: ctx.rate() }).catch(() => 'err'); if (r === 'err' || r === 'interrupted' || my !== loopTok) break; await new Promise(r => setTimeout(r, 400)); }
  };
  const showRec = (r) => {
    const og = ctx.hasOrig?.(s);
    let h = `<div class="ab"><audio controls src="${r.url}" id="myaudio"></audio><div class="row gap wrap"><button class="btn" id="aOrig">${og ? '听原声' : '听原句'}</button><button class="btn" id="aMine">听我的</button><button class="btn" id="aBoth">对比：${og ? '原声' : '原句'}→我的</button></div></div>`;
    if (r.asr && r.transcript) {
      const sc = sp.scoreSpeech(s.en, r.transcript);
      h += `<div class="score ${sc.score >= 80 ? 'good' : sc.score >= 50 ? 'mid' : 'low'}"><b>${sc.score}</b> 分</div>
        <div class="diff" aria-label="逐词比对">${sc.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="识别为：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>
        <div class="muted small">识别到：${esc(r.transcript)}</div>
        <div class="legend"><span class="ok">读对</span> <span class="wrong">读错/识别不同</span> <span class="miss">漏读</span></div>`;
    } else if (r.asr) h += `<div class="note">没有识别到声音，请靠近麦克风再试一次。${r.error ? '（' + esc(r.error) + '）' : ''}</div>`;
    else h += `<div class="note">此浏览器不支持语音识别，只能录音回放，无法评分。${r.error ? esc(r.error) : ''}</div>`;
    if (attempts.length >= 2) h += `<div class="muted small" id="rechist">历次跟读：${attempts.map((a, i) => `第 ${i + 1} 次 <b>${a.score}</b> 分`).join(' · ')}</div>`;
    h += `<div class="muted small">⚠ ${sp.ASR_LABEL}。识别结果受口音、噪音和浏览器影响，分数只是参考，不代表发音水平。</div>`;
    E('#recres').innerHTML = h;
    const mine = E('#myaudio');
    const orig = () => og ? ctx.playOrig(s).catch(e => toast(e.message)) : tts.speak(s.en, { rate: ctx.rate() }).catch(e => toast(e.message));
    E('#aOrig').onclick = () => orig(); E('#aMine').onclick = () => { tts.cancel(); mine.currentTime = 0; mine.play(); };
    E('#aBoth').onclick = async () => { await orig(); mine.currentTime = 0; mine.play(); };
  };
  if (recs.has(s.id)) showRec(recs.get(s.id));
  E('#rec').onclick = async (e) => {
    const btn = e.currentTarget;
    if (recorder) {
      btn.disabled = true; const r = await recorder.stop(); recorder = null; btn.disabled = false;
      btn.textContent = '🎙 再来一次'; btn.classList.remove('recording');
      if (r.asr && r.transcript) attempts.push({ score: sp.scoreSpeech(s.en, r.transcript).score, transcript: r.transcript, at: Date.now(), source: r.source || 'browser' });
      r.attempts = attempts.slice(); recs.set(s.id, r); showRec(r); return;
    }
    try { tts.cancel(); recorder = await sp.startShadowing({ useAsr: settings.useAsr }); btn.textContent = '■ 说完了，停止并评分'; btn.classList.add('recording'); }
    catch (err) { toast(err.message, 6000); E('#recres').innerHTML = `<div class="note">${esc(err.message)}</div>`; }
  };
  // —— 语法与翻译方法 ——
  nlp.tag(s.en).then(tg => { E('#localpos').innerHTML = tg.map(t => `<span class="pw pos-${t.pos || 'x'}"><b>${esc(t.w)}</b><i>${esc(t.posZh)}${t.forms.length ? '·' + esc(t.forms.join('/')) : ''}</i></span>`).join('') + '<div class="muted small">基础词性标注（本地规则，离线，可能有误，仅供参考）</div>'; }).catch(e => { E('#localpos').innerHTML = `<span class="muted small">本地词性标注不可用：${esc(e.message)}</span>`; });
  const drawAnalysis = () => {
    const a = s.analysis; const box = E('#analysis');
    if (!a) { box.innerHTML = ai.isConfigured() ? '<p class="muted small">还没有解析。点下面的按钮由 AI 生成句子成分、时态语态、语法点和翻译方法讲解。</p>' : '<p class="muted small">句子成分/语法/翻译方法的讲解需要 AI，目前不可用。上面的词性标注是本地规则，可离线使用。</p>'; }
    else box.innerHTML = `
      ${a.structure.length ? `<div class="ana"><b>句子成分</b>${a.structure.map(x => `<div class="comp"><span class="role">${esc(x.role)}</span> <span class="ctext">${esc(x.text)}</span>${x.zh ? ` <span class="muted">→ ${esc(x.zh)}</span>` : ''}</div>`).join('')}</div>` : ''}
      ${a.tense_voice.length ? `<div class="ana"><b>时态 / 语态</b>${a.tense_voice.map(x => `<div><span class="tag okt">${esc(x.label)}</span> ${esc(x.explain)}</div>`).join('')}</div>` : ''}
      ${a.grammar_points.length ? `<div class="ana"><b>语法点</b>${a.grammar_points.map(x => `<div><b>${esc(x.name)}</b>：${esc(x.explain)}</div>`).join('')}</div>` : ''}
      ${a.translation_methods.length ? `<div class="ana"><b>翻译方法</b>${a.translation_methods.map(x => `<div class="tm"><span class="tag">${esc(x.method)}</span> ${esc(x.explain)}${x.before || x.after ? `<div class="muted small">${x.before ? '直译：' + esc(x.before) : ''}${x.before && x.after ? ' → ' : ''}${x.after ? '调整后：' + esc(x.after) : ''}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${a.natural_zh ? `<div class="ana"><b>自然译文</b>：${esc(a.natural_zh)}</div>` : ''}
      <div class="muted small">由 AI 生成（${new Date(a.at).toLocaleDateString('zh-CN')}），已缓存到材料库，请自行判断是否准确。</div>`;
    E('#anabtn').innerHTML = aiBtn('pana', a ? '重新生成解析' : '生成语法与翻译解析');
    E('#pana')?.addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '✨ 分析中…';
      try { s.analysis = await ai.analyzeSentence(s); await db.materials.save(m); toast('已生成并缓存'); } catch (err) { toast(err.message, 6000); E('#analysis').insertAdjacentHTML('beforeend', `<div class="note">没有生成成功：${esc(err.message)}</div>`); b.disabled = false; b.textContent = '✨ 重试'; return; }
      drawAnalysis();
    });
  };
  drawAnalysis();
  if (opts.focus === 'analysis') setTimeout(() => E('#anasec').scrollIntoView({ block: 'start' }), 50);
  E('#pstar').onclick = async (e) => { const on = await toggleStar(ctx, s); e.currentTarget.textContent = on ? '★ 已收藏' : '☆ 收藏句子'; };
  cardsOf(ctx).then(cs => { if (cs.some(c => c.type === 'sentence' && c.sentenceId === s.id)) E('#pstar').textContent = '★ 已收藏'; });
  E('#pexpr')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; const box = E('#exres'); box.innerHTML = '<p class="muted">AI 生成中…</p>';
    try {
      const ex = await ai.generateExpressions(s);
      box.innerHTML = ex.map((x, n) => `<div class="expr"><div><b>${esc(x.en)}</b> <span class="tag">${esc(x.tone)}</span></div><div class="small">${esc(x.zh)}</div>${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}<div class="row gap"><button class="mini" data-say="${n}">🔊</button><button class="mini" data-save="${n}">⭐ 收藏表达</button></div></div>`).join('') + '<p class="muted small">表达由 AI 生成，请结合场景判断。</p>';
      box.onclick = async (ev) => {
        const sb = ev.target.closest('[data-say]'); if (sb) return tts.speak(ex[+sb.dataset.say].en, { rate: ctx.rate() }).catch(e => toast(e.message));
        const sv = ev.target.closest('[data-save]'); if (sv) { const x = ex[+sv.dataset.save]; await db.cards.save(makeCard({ type: 'expr', term: x.en, zh: x.zh || s.zh, sentence: { en: s.en, zh: s.zh }, material: m.id, sentenceId: s.id, source: 'ai', note: x.note })); sv.textContent = '✓ 已收藏'; sv.disabled = true; toast('已收藏表达，会进入每日复习'); }
      };
    } catch (err) { box.innerHTML = `<div class="note">没有生成成功：${esc(err.message)}</div>`; }
    b.disabled = false;
  });
}
