// 文本处理：拆句、中英配对、字幕解析、逐词比对评分。纯函数，无 DOM 依赖。
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN = /[A-Za-z]/g;

export function lang(s) {
  const c = (s.match(CJK) || []).length, l = (s.match(LATIN) || []).length;
  if (!c && !l) return 'other';
  return c * 2 >= l && c > 0 ? 'zh' : 'en';
}
const hasZh = s => /[\u3400-\u9fff]/.test(s);

const ABBR = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Inc|Ltd|Co|U\.S|a\.m|p\.m|e\.g|i\.e)\./gi;

export function splitEnglish(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const prot = t.replace(ABBR, m => m.replace(/\./g, '\u0001')).replace(/(\d)\.(\d)/g, '$1\u0001$2');
  const parts = prot.split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[A-Z0-9])/);
  return parts.map(p => p.replace(/\u0001/g, '.').trim()).filter(Boolean);
}
export function splitChinese(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.split(/(?<=[。！？!?；;]["”’）)]?)/);
  return parts.map(p => p.trim()).filter(Boolean);
}

const KNOWN_SPEAKERS = /^(doctor|dr|patient|me|you|q|a|customer|receptionist|nurse|therapist|client|staff|医生|医师|患者|病人|前台|护士|治疗师|客户|顾客|我|你|问|答)$/i;
const SPEAKER_RE = /^([A-Za-z][A-Za-z .'-]{0,24}|[\u4e00-\u9fff]{1,8})\s*[:：]\s*(\S.*)$/;

function stripBullet(s) { return s.replace(/^\s*(?:[-*•·]|\d{1,3}[.)、])\s+/, '').trim(); }

function splitSeparator(line) {
  const m = line.split(/\s*(?:\||｜|\t+|\s\/\s|\s[-–—]{1,2}\s)\s*/).filter(x => x.length);
  if (m.length === 2 && ((lang(m[0]) === 'zh') !== (lang(m[1]) === 'zh'))) {
    return lang(m[0]) === 'zh' ? { zh: m[0], en: m[1] } : { zh: m[1], en: m[0] };
  }
  return null;
}

/** 解析粘贴文本 → [{speaker, en, zh}]。支持：每行「中文 | English」、中英交替行、纯英文段落、带说话人前缀。 */
export function parseBilingual(raw) {
  let lines = String(raw || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).map(stripBullet).filter(Boolean);
  // 纯英文 / 纯中文文件：把硬换行（上一行没有句末标点）接回同一段，避免把半句当成一句
  const langs = lines.map(lang).filter(l => l !== 'other'); const mono = langs.length && langs.every(l => l === langs[0]) ? langs[0] : null;
  if (mono && !lines.some(l => SPEAKER_RE.test(l))) {
    const END = mono === 'zh' ? /[。！？!?；…”』」）)]$/ : /[.!?…"”’)\]:]$/; const joined = [];
    for (const l of lines) { const prev = joined[joined.length - 1]; if (prev != null && !END.test(prev) && !(mono === 'en' && /^[A-Z]/.test(l) && prev.length < 60)) joined[joined.length - 1] = prev + (mono === 'zh' ? '' : ' ') + l; else joined.push(l); }
    lines = joined;
  }
  // 说话人前缀（出现≥2次或属于常见称谓才认定，避免把 “Note: xxx” 当说话人）
  const cand = lines.map(l => { const m = l.match(SPEAKER_RE); return m ? m[1].trim() : null; });
  const cnt = {}; cand.forEach(c => { if (c) cnt[c.toLowerCase()] = (cnt[c.toLowerCase()] || 0) + 1; });
  const okSpk = c => c && (cnt[c.toLowerCase()] >= 2 || KNOWN_SPEAKERS.test(c));
  const items = lines.map((l, i) => {
    if (okSpk(cand[i])) { const m = l.match(SPEAKER_RE); return { speaker: m[1].trim(), text: m[2].trim() }; }
    return { speaker: '', text: l };
  });
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const { speaker, text } = items[i];
    const sep = splitSeparator(text);
    if (sep) { out.push({ speaker, ...sep }); continue; }
    const L = lang(text);
    const nx = items[i + 1];
    if (nx && L !== 'other') {
      const L2 = lang(nx.text);
      if (L2 !== 'other' && L !== L2 && !splitSeparator(nx.text)) {
        const zh = L === 'zh' ? text : nx.text, en = L === 'en' ? text : nx.text;
        const ens = splitEnglish(en), zhs = splitChinese(zh);
        if (ens.length > 1 && ens.length === zhs.length) ens.forEach((e, k) => out.push({ speaker: k ? '' : (speaker || nx.speaker), en: e, zh: zhs[k] }));
        else out.push({ speaker: speaker || nx.speaker, en, zh });
        i++; continue;
      }
    }
    if (L === 'zh') splitChinese(text).forEach((z, k) => out.push({ speaker: k ? '' : speaker, en: '', zh: z }));
    else if (L === 'en') splitEnglish(text).forEach((e, k) => out.push({ speaker: k ? '' : speaker, en: e, zh: '' }));
  }
  return out;
}

// ---------- 字幕 ----------
const TS = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
function toSec(s) { const p = s.replace(',', '.').split(':').map(Number); return p.reduce((a, v) => a * 60 + v, 0); }
function cleanCue(t) {
  return t.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/^\s*[♪♫]+\s*|\s*[♪♫]+\s*$/g, '').trim();
}
export function parseSubtitleCues(text) {
  const blocks = String(text).replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n{2,}/);
  const cues = [];
  for (const b of blocks) {
    const ls = b.split('\n');
    const ti = ls.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const [a, bb] = ls[ti].split('-->');
    const ma = a.match(TS), mb = bb && bb.match(TS);
    if (!ma) continue;
    const body = ls.slice(ti + 1).map(cleanCue).filter(Boolean);
    if (!body.length) continue;
    cues.push({ t0: toSec(ma[0]), t1: mb ? toSec(mb[0]) : null, lines: body });
  }
  return cues;
}
/** srt/vtt → [{en, zh, t0, t1}]；同一条字幕内一行中文一行英文时自动配对；英文断句碎片按标点合并。 */
export function parseSubtitles(text) {
  const cues = parseSubtitleCues(text);
  const out = [];
  let pend = null;
  const push = (o) => { const prev = out[out.length - 1]; if (prev && prev.en === o.en && prev.zh === o.zh) return; out.push(o); };
  for (const c of cues) {
    const zhL = c.lines.filter(l => lang(l) === 'zh'), enL = c.lines.filter(l => lang(l) === 'en');
    if (zhL.length && enL.length) {
      if (pend) { push(pend); pend = null; }
      push({ en: enL.join(' '), zh: zhL.join(''), t0: c.t0, t1: c.t1, speaker: '' });
    } else if (enL.length) {
      const en = enL.join(' ').replace(/^[-–]\s*/, '').trim();
      if (pend) { pend.en += ' ' + en; pend.t1 = c.t1; } else pend = { en, zh: '', t0: c.t0, t1: c.t1, speaker: '' };
      if (/[.!?…]["'”’)\]]*$/.test(pend.en) || pend.en.length > 220) { push(pend); pend = null; }
    } else if (zhL.length) {
      if (pend) { push(pend); pend = null; }
      push({ en: '', zh: zhL.join(''), t0: c.t0, t1: c.t1, speaker: '' });
    }
  }
  if (pend) push(pend);
  // 单条里含多句且无中文：再拆句
  const res = [];
  for (const o of out) {
    const ss = !o.zh ? splitEnglish(o.en) : [o.en];
    if (ss.length > 1) ss.forEach((e, k) => res.push({ ...o, en: e, t1: k < ss.length - 1 ? null : o.t1, t0: k ? null : o.t0 }));
    else res.push(o);
  }
  return res;
}

// ---------- 逐词比对 ----------
export function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/(^|\s)'+|'+(\s|$)/g, ' ').split(/\s+/).filter(Boolean);
}
/** 把参考句 ref 与听到/写出的 hyp 逐词对齐。返回 {score, tokens:[{w, status:'ok'|'wrong'|'miss', heard}], extra:[]}
 * 注意：ref 里保留原词的大小写与标点用于显示。 */
export function compareWords(ref, hyp) {
  const rawRef = String(ref || '').split(/\s+/).filter(Boolean);
  // 带连字符的词（follow-up）拆成几个记号，与作答的拆法一致；显示时再合并回原词
  const items = rawRef.flatMap(w => tokenize(w).map((t, k) => ({ show: k ? '' : w, norm: t })));
  const hy = tokenize(hyp);
  const n = items.length, m = hy.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = items[i].norm === hy[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const tokens = []; const extra = [];
  let i = 0, j = 0;
  const gap = (i2, j2) => { // 在锚点之间：把 ref[i..i2) 与 hy[j..j2) 按顺序配成“读错”，多余的为漏读/多读
    const a = i2 - i, b = j2 - j, k = Math.min(a, b);
    for (let x = 0; x < a; x++) tokens.push({ w: items[i + x].show, status: x < k ? 'wrong' : 'miss', heard: x < k ? hy[j + x] : undefined });
    for (let y = k; y < b; y++) extra.push(hy[j + y]);
  };
  while (i < n && j < m) {
    if (items[i].norm === hy[j]) { tokens.push({ w: items[i].show, status: 'ok' }); i++; j++; continue; }
    // 找下一个锚点
    let ni = i, nj = j;
    // 沿 dp 路径找到下一个匹配
    let found = false;
    for (let a = i; a < n && !found; a++) for (let b = j; b < m; b++) {
      if (items[a].norm === hy[b] && dp[a][b] === dp[i][j]) { ni = a; nj = b; found = true; break; }
    }
    if (!found) { gap(n, m); i = n; j = m; break; }
    gap(ni, nj); i = ni; j = nj;
  }
  if (i < n || j < m) gap(n, m);
  const ok = tokens.filter(t => t.status === 'ok').length;
  for (let k = tokens.length - 1; k > 0; k--) if (tokens[k].w === '') { const a = tokens[k - 1], b = tokens[k]; if (a.status !== b.status) a.status = a.status === 'miss' && b.status === 'miss' ? 'miss' : 'wrong'; if (b.heard) a.heard = [a.heard, b.heard].filter(Boolean).join(' '); tokens.splice(k, 1); }
  const score = n ? Math.max(0, Math.round(100 * (ok - extra.length * 0.5) / n)) : 0;
  return { score, tokens, extra, total: n, correct: ok };
}
