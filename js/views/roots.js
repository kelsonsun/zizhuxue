// v1.5 词根地图：词根在中间、单词沿线散开；按词根 / 按前缀浏览；从材料生成“我的词根网络”。
import * as db from '../db.js';
import * as R from '../roots.js';
import { mountRootBox } from '../rootbox.js';
import { makeCard } from '../state.js';
import { $, $$, esc, toast, tokensOf } from '../ui.js';

const svgMap = (center, sub, words, sel) => {
  const n = words.length, W = 360, H = n > 12 ? 380 : 340, cx = W / 2, cy = H / 2;
  const nodes = words.map((e, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n, ring = n > 12 && i % 2 ? 0.62 : 1;
    const rx = (W / 2 - 46) * ring, ry = (H / 2 - 24) * ring;
    const half = Math.max(36, e.w.length * 7.4 + 12) / 2;
    return { e, x: Math.min(W - half - 2, Math.max(half + 2, cx + rx * Math.cos(a))), y: cy + ry * Math.sin(a) };
  });
  const lw = t => Math.max(36, t.length * 7.4 + 12);
  return `<svg class="rmap" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(center)} 词根网络">
    ${nodes.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="ln"/>`).join('')}
    <g class="ctr"><circle cx="${cx}" cy="${cy}" r="40"/><text x="${cx}" y="${cy - 3}" class="ct">${esc(center)}</text><text x="${cx}" y="${cy + 14}" class="cs">${esc(sub)}</text></g>
    ${nodes.map(p => `<g class="nd${sel === p.e.w ? ' on' : ''}" data-node="${esc(p.e.w)}" tabindex="0" role="button" aria-label="${esc(p.e.w)}"><rect class="hit" x="${(p.x - Math.max(lw(p.e.w), 54) / 2).toFixed(1)}" y="${(p.y - 27).toFixed(1)}" width="${Math.max(lw(p.e.w), 54).toFixed(1)}" height="54"/><rect x="${(p.x - lw(p.e.w) / 2).toFixed(1)}" y="${(p.y - 12).toFixed(1)}" width="${lw(p.e.w).toFixed(1)}" height="24" rx="12"/><text x="${p.x.toFixed(1)}" y="${(p.y + 4.5).toFixed(1)}">${esc(p.e.w)}</text></g>`).join('')}
  </svg>`;
};

export async function render(root, args, params) {
  const st = { tab: params.m || params.mine ? 'mine' : params.p ? 'pre' : 'root', r: params.r || 'port', p: params.p || 'trans', sel: null, q: params.q || '' };
  if (!R.rootById(st.r)) st.r = 'port';
  const S = R.stats();
  const learned = async () => new Set((await db.cards.all()).filter(c => c.type === 'word').map(c => c.term.toLowerCase()));
  root.innerHTML = `
    <header class="top"><a class="back" href="#/library" aria-label="返回">‹</a><h1>🌳 词根地图</h1>
      <span class="muted">${S.roots} 个词根 · ${S.words} 个词 · ${S.prefixes} 个前缀 · ${S.suffixes} 个后缀。词根像“动作”，前缀像“方向”。</span></header>
    <div class="row gap"><input id="rq" class="grow" placeholder="输入任意单词，自动拆解（如 transportation）" autocapitalize="off" autocomplete="off" spellcheck="false" value="${esc(st.q)}"><button class="btn" id="rgo">拆解</button></div>
    <div id="rqres"></div>
    <div class="seg"><a href="#" data-rt="root">按词根</a><a href="#" data-rt="pre">按前缀</a><a href="#" data-rt="mine">我的词根网络</a></div>
    <div id="rbody"></div>`;
  const body = $('#rbody', root);
  const query = () => { const w = $('#rq', root).value.trim(); if (!w) return; if (!/^[A-Za-z][A-Za-z'’-]*$/.test(w)) return toast('请输入一个英文单词'); mountRootBox($('#rqres', root), w); };
  $('#rgo', root).onclick = query; $('#rq', root).onkeydown = e => { if (e.key === 'Enter') query(); };
  if (st.q) query();
  $$('[data-rt]', root).forEach(a => a.onclick = e => { e.preventDefault(); st.tab = a.dataset.rt; st.sel = null; draw(); });

  const detail = w => { const el = $('#rdet', body); if (el) { mountRootBox(el, w, { onSaved: () => draw() }); } };
  const bindMap = () => $$('[data-node]', body).forEach(g => { const f = () => { st.sel = g.dataset.node; $$('[data-node]', body).forEach(x => x.classList.toggle('on', x === g)); detail(st.sel); }; g.onclick = f; g.onkeydown = e => { if (e.key === 'Enter') f(); }; });

  async function draw() {
    $$('[data-rt]', root).forEach(a => a.classList.toggle('on', a.dataset.rt === st.tab));
    if (st.tab === 'root') {
      const r = R.rootById(st.r), fam = R.family(r.id), have = await learned(); const todo = fam.filter(e => !have.has(e.w));
      body.innerHTML = `<div class="rpick">${R.allRoots().map(x => `<button class="chip ${x.id === r.id ? 'on' : ''}" data-r="${x.id}">${esc(x.forms[0])}<small> ${esc(x.m.split('；')[0])}</small></button>`).join('')}</div>
        <div class="card rcard"><div class="rhead"><b>${esc(r.forms.join(' / '))}</b> = ${esc(r.m)}<div class="muted small">${esc(r.src)} · ${fam.length} 个词${r.note ? ' · ⚠ ' + esc(r.note) : ''}</div></div>
        ${svgMap(r.forms[0], r.m.split('；')[0], fam, st.sel)}
        <div id="rdet"><p class="muted small">点图上的词，看它怎么拆。</p></div>
        <button class="btn primary big" id="addFam" ${todo.length ? '' : 'disabled'}>${todo.length ? `＋ 把这个家族加入复习（${todo.length} 个新词）` : '这个家族已全部在生词本里'}</button>
        <p class="muted small">加入后和其他生词一样按“不会/模糊/会/熟练”安排复习；复习时还会出现“看拆解选意思”的题。</p></div>`;
      $$('[data-r]', body).forEach(b => b.onclick = () => { st.r = b.dataset.r; st.sel = null; draw(); });
      bindMap(); if (st.sel) detail(st.sel);
      $('#addFam', body).onclick = async () => {
        for (const e of todo) { const c = makeCard({ type: 'word', term: e.w, zh: e.zh, source: 'roots', note: `${e.parts.map(p => p.t).join(' + ')}：${e.logic}` }); c.root = r.id; await db.cards.save(c); }
        toast(`已加入 ${todo.length} 个词，去「复习」练习`); draw();
      };
    } else if (st.tab === 'pre') {
      const p = R.prefixByKey(st.p) || R.allPrefixes()[0]; const list = R.prefixFamily(p.k);
      const usable = R.allPrefixes().filter(x => R.prefixFamily(x.k).length);
      body.innerHTML = `<div class="rpick">${usable.map(x => `<button class="chip ${x.k === p.k ? 'on' : ''}" data-p="${esc(x.k)}">${esc(x.forms.slice(0, 3).join('/'))}-<small> ${esc(x.m.split('；')[0])}</small></button>`).join('')}</div>
        <div class="card rcard"><div class="rhead"><b>${esc(p.forms.join(' / '))}-</b> = ${esc(p.m)}<div class="muted small">例：${esc(p.ex)} · 内置 ${list.length} 个词。同一个方向，配上不同的动作（词根）：</div></div>
        ${svgMap(p.forms[0] + '-', p.m.split('；')[0], list.slice(0, 20), st.sel)}${list.length > 20 ? `<div class="chips">${list.slice(20).map(e => `<button class="rchip" data-node="${esc(e.w)}">${esc(e.w)}</button>`).join('')}</div>` : ''}
        <div id="rdet"><p class="muted small">点图上的词，看它怎么拆。</p></div></div>`;
      $$('[data-p]', body).forEach(b => b.onclick = () => { st.p = b.dataset.p; st.sel = null; draw(); });
      bindMap(); if (st.sel) detail(st.sel);
    } else {
      body.innerHTML = '<p class="muted">正在扫描你的材料…</p>';
      const mats = (await db.materials.all()).filter(m => !params.m || m.id === params.m);
      const hits = new Map(); // rootId -> Map(word -> {n, title})
      for (const m of mats) for (const s of m.sentences || []) for (const t of tokensOf(s.en || '')) {
        const rid = R.familyTag(t); if (!rid) continue; const d = R.decompose(t); const w = d.e?.w || t.toLowerCase();
        const g = hits.get(rid) || hits.set(rid, new Map()).get(rid); const x = g.get(w) || { n: 0, title: m.title, sample: t.toLowerCase() }; x.n++; g.set(w, x);
      }
      const one = params.m ? mats[0] : null;
      const groups = [...hits].sort((a, b) => b[1].size - a[1].size);
      body.innerHTML = `<div class="card rcard"><div class="rhead"><b>我的词根网络</b><div class="muted small">${one ? `材料《${esc(one.title)}》` : `你的 ${mats.length} 份材料`}里，属于内置词根家族的词（只按内置数据认，不做推测，避免误标）。${params.m ? ' <a href="#/roots?mine=1">看全部材料 ›</a>' : ''}</div></div>
        ${groups.length ? groups.map(([rid, g]) => { const r = R.rootById(rid); const fam = R.family(rid); return `<div class="mynet"><div class="mynet-h"><a class="rlink" href="#/roots?r=${rid}">${esc(r.forms[0])}</a><span class="rb-l">${esc(r.m)} · 材料里 ${g.size} 个，家族共 ${fam.length} 个</span></div>
          <div class="chips">${[...g].map(([w, x]) => `<button class="rchip mine" data-node="${esc(w)}">${esc(w)}${x.n > 1 ? `<small>×${x.n}</small>` : ''}</button>`).join('')}${fam.filter(e => !g.has(e.w)).slice(0, 4).map(e => `<button class="rchip" data-node="${esc(e.w)}">${esc(e.w)}<small>${esc(R.brief(e.zh))}</small></button>`).join('')}</div></div>`; }).join('')
          : '<p class="muted">你的材料里还没找到内置词根家族的词。导入更多材料，或先在「按词根」里浏览。</p>'}
        <div id="rdet"></div></div>`;
      $$('[data-node]', body).forEach(b => b.onclick = () => { $$('[data-node]', body).forEach(x => x.classList.toggle('on', x === b)); detail(b.dataset.node); $('#rdet', body).scrollIntoView({ block: 'nearest' }); });
    }
  }
  await draw();
}
