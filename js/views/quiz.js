import * as db from '../db.js';
import * as tts from '../tts.js';
import * as dict from '../dict.js';
import { compareWords } from '../textproc.js';
import { settings, makeCard } from '../state.js';
import { paragraphs } from '../structure.js';
import { $, $$, esc, toast, hilite, go } from '../ui.js';

const MODES = [['zh2en', '看中文写英文', '给中文，你写英文，逐词判分'], ['dict', '听写', '听一句，把听到的写下来，逐词判分'], ['mcq', '词义选择', '看生词在你原句里的样子，选中文意思']];
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const shortZh = z => (z || '').replace(/\s*\|\s*/g, '；').slice(0, 26);

export async function render(root, [scope = 'all'], params) {
  const [mats, cards] = await Promise.all([db.materials.all(), db.cards.all()]);
  const [kind, sid, sx] = scope.split(':'); const lessonId = kind === 'lesson' || kind === 'para' || kind === 'sent' ? sid : null;
  let pool, cpool, title, backHref = '#/library', progKey = null;
  const sentsOf = ms => ms.flatMap(m => m.sentences.map(s => ({ ...s, materialId: m.id }))).filter(s => s.en);
  const okCards = c => (c.type === 'word' || c.type === 'phrase') && c.zh;
  if (kind === 'book') { const chs = mats.filter(m => m.bookId === sid); pool = chs; const ids = new Set(chs.map(c => c.id)); cpool = cards.filter(c => okCards(c) && ids.has(c.materialId)); title = '整本书：' + (mats.find(m => m.id === sid)?.title || ''); backHref = '#/book/' + sid; }
  else if (kind === 'para' || kind === 'sent') {
    const m = mats.find(x => x.id === sid); pool = m ? [m] : []; const g = m ? paragraphs(m) : [];
    const idxs = kind === 'sent' ? [+sx] : (g[+sx] ? Array.from({ length: g[+sx].end - g[+sx].start + 1 }, (_, i) => g[+sx].start + i) : []);
    const ids = new Set(idxs.map(i => m?.sentences[i]?.id)); if (m) pool = [{ ...m, sentences: m.sentences.filter(s => ids.has(s.id)) }];
    cpool = cards.filter(c => okCards(c) && ids.has(c.sentenceId)); title = (m?.title || '') + (kind === 'sent' ? ` · 第 ${+sx + 1} 句` : ` · 第 ${+sx + 1} 段`);
    backHref = `#/lesson/${sid}?lv=${kind}&si=${kind === 'sent' ? sx : g[+sx]?.start || 0}`; progKey = kind === 'para' ? 'para' + sx : null;
  } else if (kind === 'lesson') { pool = mats.filter(m => m.id === sid); cpool = cards.filter(c => okCards(c) && c.materialId === sid); title = pool[0]?.title || ''; backHref = '#/lesson/' + sid; progKey = 'lesson'; }
  else { pool = mats; cpool = cards.filter(okCards); title = '全部材料'; }
  const sents = sentsOf(pool);
  const menu = () => {
    root.innerHTML = `<header class="top"><a class="back" href="${backHref}">‹</a><h1>测验</h1><span class="muted">范围：${esc(title)}</span></header>
      <div class="list">${MODES.map(([k, t, d]) => {
        const n = k === 'zh2en' ? sents.filter(s => s.zh).length : k === 'dict' ? sents.length : cpool.length;
        return `<button class="item modeb" data-m="${k}" ${n ? '' : 'disabled'}><b>${t}</b><span class="muted">${d} · 可用 ${n} 题</span></button>`; }).join('')}</div>
      ${(!sents.length) ? '<div class="note">这个范围里还没有句子。</div>' : ''}
      ${(!cpool.length) ? '<div class="note">“词义选择”需要先收藏带释义的生词。</div>' : ''}`;
    $$('.modeb', root).forEach(b => b.onclick = () => start(b.dataset.m));
  };
  async function start(mode) {
    let qs;
    if (mode === 'zh2en') qs = shuffle(sents.filter(s => s.zh)).slice(0, 10).map(s => ({ s }));
    else if (mode === 'dict') qs = shuffle(sents).slice(0, 10).map(s => ({ s }));
    else {
      qs = shuffle(cpool).slice(0, 10);
      const others = cards.map(c => c.zh).filter(Boolean);
      qs = await Promise.all(qs.map(async c => {
        const dis = shuffle(others.filter(z => z !== c.zh)).slice(0, 3).map(shortZh);
        if (dis.length < 3) dis.push(...(await dict.randomZh(3 - dis.length, [c.zh, ...dis])).map(shortZh));
        const opts = shuffle([{ t: shortZh(c.zh), ok: true }, ...[...new Set(dis)].slice(0, 3).map(t => ({ t, ok: false }))]);
        return { c, opts };
      }));
    }
    let i = 0; const res = [];
    const next = () => { i++; i >= qs.length ? summary() : ask(); };
    const head = () => `<header class="top"><h1>${MODES.find(m => m[0] === mode)[1]}</h1><span class="muted">第 ${i + 1} / ${qs.length} 题</span></header><div class="bar"><i style="width:${Math.round(100 * i / qs.length)}%"></i></div>`;
    function ask() {
      const q = qs[i];
      if (mode === 'mcq') {
        root.innerHTML = head() + `<section class="rvcard"><div class="rv-term">${esc(q.c.term)}</div><button class="btn" id="say">🔊 听</button><div class="rv-sent">${hilite(q.c.sentence?.en || '', q.c.term)}</div></section>
          <div class="opts" role="group" aria-label="选项">${q.opts.map((o, k) => `<button class="btn opt" data-k="${k}">${esc(o.t)}</button>`).join('')}</div><div id="fb"></div>`;
        $('#say', root).onclick = () => tts.speak(q.c.term).catch(e => toast(e.message));
        $$('.opt', root).forEach(b => b.onclick = () => {
          const o = q.opts[+b.dataset.k]; $$('.opt', root).forEach((x, k) => { x.disabled = true; { if (q.opts[k].ok) x.classList.add('right'); else if (x === b) x.classList.add('bad'); }; });
          res.push({ q, ok: o.ok, score: o.ok ? 100 : 0 });
          $('#fb', root).innerHTML = `<div class="fb ${o.ok ? 'good' : 'low'}">${o.ok ? '✓ 答对了' : '✗ 正确答案：' + esc(shortZh(q.c.zh))}</div><button class="btn primary" id="nx">${i + 1 >= qs.length ? '看结果' : '下一题'}</button>`;
          $('#nx', root).onclick = next;
        });
        return;
      }
      const s = q.s;
      root.innerHTML = head() + `<section class="rvcard">${mode === 'zh2en' ? `<div class="rv-zh">${esc(s.zh)}</div>` : `<div class="muted">听一句，写下你听到的</div><div class="row gap center"><button class="btn primary" id="say">🔊 播放</button><button class="btn" id="slow">🐢 慢速</button></div>`}</section>
        <textarea id="ans" rows="3" placeholder="在这里写英文……" aria-label="你的答案" autocapitalize="sentences" spellcheck="false"></textarea>
        <div class="row gap"><button class="btn primary grow" id="sub">提交判分</button>${mode === 'zh2en' ? '<button class="btn" id="hear">🔊 听答案</button>' : ''}</div><div id="fb"></div>`;
      if (mode === 'dict') { const sp = r => tts.speak(s.en, { rate: r }).catch(e => toast(e.message)); $('#say', root).onclick = () => sp(settings.rate); $('#slow', root).onclick = () => sp(0.6); setTimeout(() => sp(settings.rate), 300); }
      $('#hear', root)?.addEventListener('click', () => tts.speak(s.en).catch(e => toast(e.message)));
      $('#sub', root).onclick = (e) => {
        const ans = $('#ans', root).value.trim(); if (!ans) return toast('先写一点再提交');
        const r = compareWords(s.en, ans); res.push({ q, ok: r.score >= 80, score: r.score }); e.currentTarget.disabled = true; $('#ans', root).readOnly = true;
        $('#fb', root).innerHTML = `<div class="score ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'low'}"><b>${r.score}</b> 分</div>
          <div class="diff">${r.tokens.map(t => `<span class="${t.status}" ${t.heard ? `title="你写的：${esc(t.heard)}"` : ''}>${esc(t.w)}</span>`).join(' ')}</div>
          <div class="muted small">参考答案：${esc(s.en)}${r.extra.length ? '<br>多写的词：' + esc(r.extra.join(' ')) : ''}</div>
          <div class="muted small">逐词比对，不同但自然的说法也可能是对的；大小写和标点不扣分。</div><button class="btn primary" id="nx">${i + 1 >= qs.length ? '看结果' : '下一题'}</button>`;
        $('#nx', root).onclick = next;
      };
    }
    function summary() {
      const avg = Math.round(res.reduce((a, r) => a + r.score, 0) / res.length), wrong = res.filter(r => !r.ok);
      if (progKey && pool[0]) db.materials.get(sid).then(mm => { if (!mm) return; mm.progress = mm.progress || { done: {}, last: null, quiz: {} }; mm.progress.quiz = mm.progress.quiz || {}; mm.progress.quiz[progKey] = Math.max(avg, mm.progress.quiz[progKey] ?? 0); db.materials.save(mm); });
      root.innerHTML = `<header class="top"><h1>测验结果</h1></header><section class="rvcard"><div class="score ${avg >= 80 ? 'good' : avg >= 50 ? 'mid' : 'low'}"><b>${avg}</b> 分</div><p>答对 ${res.length - wrong.length} / ${res.length} 题</p></section>
        ${wrong.length ? `<h2>需要再练的</h2><div class="list">${wrong.map(r => `<div class="item"><b>${esc(r.q.s?.en || r.q.c.term)}</b><span class="muted">${esc(r.q.s?.zh || shortZh(r.q.c.zh))}</span></div>`).join('')}</div>${mode !== 'mcq' ? '<button class="btn primary" id="addw">把答错的句子加入复习</button>' : ''}` : '<p class="muted">全部答对，漂亮！</p>'}
        <div class="row gap"><button class="btn" id="again">再来一轮</button><a class="btn" href="#/">首页</a></div>`;
      $('#again', root).onclick = () => start(mode);
      $('#addw', root)?.addEventListener('click', async (e) => {
        const have = new Set(cards.filter(c => c.type === 'sentence').map(c => c.sentenceId)); let n = 0;
        for (const r of wrong) { const s = r.q.s; if (have.has(s.id)) continue; await db.cards.save(makeCard({ type: 'sentence', term: s.en, zh: s.zh, sentence: { en: s.en, zh: s.zh }, material: s.materialId, sentenceId: s.id })); have.add(s.id); n++; }
        toast(`已加入 ${n} 张句子卡到复习`); e.currentTarget.disabled = true;
      });
    }
    ask();
  }
  if (params?.m) start(params.m); else menu();
}
