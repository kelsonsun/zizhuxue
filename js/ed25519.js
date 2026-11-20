// v1.9 Ed25519（RFC 8032）纯 JS 实现：零依赖，浏览器 / 安卓 / 电脑客户端 / Node 都能跑，离线验证激活码用。
// App 里只用 verify（只有公钥）；sign / publicKey 给发码工具用（私钥只在 kelson 本机）。SHA-512 也是自带的，不依赖 crypto.subtle（http / 老系统也能用）。
const P = 2n ** 255n - 19n, L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
const pow = (b, e, m = P) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const inv = a => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n)), I = pow(2n, (P - 1n) / 4n);
// ---- SHA-512 ----
const K = `428a2f98d728ae22 7137449123ef65cd b5c0fbcfec4d3b2f e9b5dba58189dbbc 3956c25bf348b538 59f111f1b605d019 923f82a4af194f9b ab1c5ed5da6d8118 d807aa98a3030242 12835b0145706fbe 243185be4ee4b28c 550c7dc3d5ffb4e2 72be5d74f27b896f 80deb1fe3b1696b1 9bdc06a725c71235 c19bf174cf692694 e49b69c19ef14ad2 efbe4786384f25e3 0fc19dc68b8cd5b5 240ca1cc77ac9c65 2de92c6f592b0275 4a7484aa6ea6e483 5cb0a9dcbd41fbd4 76f988da831153b5 983e5152ee66dfab a831c66d2db43210 b00327c898fb213f bf597fc7beef0ee4 c6e00bf33da88fc2 d5a79147930aa725 06ca6351e003826f 142929670a0e6e70 27b70a8546d22ffc 2e1b21385c26c926 4d2c6dfc5ac42aed 53380d139d95b3df 650a73548baf63de 766a0abb3c77b2a8 81c2c92e47edaee6 92722c851482353b a2bfe8a14cf10364 a81a664bbc423001 c24b8b70d0f89791 c76c51a30654be30 d192e819d6ef5218 d69906245565a910 f40e35855771202a 106aa07032bbd1b8 19a4c116b8d2d0c8 1e376c085141ab53 2748774cdf8eeb99 34b0bcb5e19b48a8 391c0cb3c5c95a63 4ed8aa4ae3418acb 5b9cca4f7763e373 682e6ff3d6b2b8a3 748f82ee5defb2fc 78a5636f43172f60 84c87814a1f0ab72 8cc702081a6439ec 90befffa23631e28 a4506cebde82bde9 bef9a3f7b2c67915 c67178f2e372532b ca273eceea26619c d186b8c721c0c207 eada7dd6cde0eb1e f57d4f7fee6ed178 06f067aa72176fba 0a637dc5a2c898a6 113f9804bef90dae 1b710b35131c471b 28db77f523047d84 32caab7b40c72493 3c9ebe0a15c9bebc 431d67c49c100d4c 4cc5d4becb3e42b6 597f299cfc657e2a 5fcb6fab3ad6faec 6c44198c4a475817`.split(/\s+/).map(h => BigInt('0x' + h));
const H0 = '6a09e667f3bcc908 bb67ae8584caa73b 3c6ef372fe94f82b a54ff53a5f1d36f1 510e527fade682d1 9b05688c2b3e6c1f 1f83d9abfb41bd6b 5be0cd19137e2179'.split(' ').map(h => BigInt('0x' + h));
const M64 = (1n << 64n) - 1n;
const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & M64;
export function sha512(msg) {
  msg = Uint8Array.from(msg); const len = msg.length, bitLen = BigInt(len) * 8n;
  const padLen = ((len + 17 + 127) >> 7) << 7; const m = new Uint8Array(padLen); m.set(msg); m[len] = 0x80;
  for (let i = 0; i < 16; i++) m[padLen - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  const h = [...H0], w = new Array(80);
  for (let o = 0; o < padLen; o += 128) {
    for (let t = 0; t < 16; t++) { let x = 0n; for (let j = 0; j < 8; j++) x = (x << 8n) | BigInt(m[o + t * 8 + j]); w[t] = x; }
    for (let t = 16; t < 80; t++) {
      const s0 = rotr(w[t - 15], 1n) ^ rotr(w[t - 15], 8n) ^ (w[t - 15] >> 7n), s1 = rotr(w[t - 2], 19n) ^ rotr(w[t - 2], 61n) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & M64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 80; t++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n), ch = (e & f) ^ (~e & M64 & g), t1 = (hh + S1 + ch + K[t] + w[t]) & M64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) & M64;
      hh = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) & M64; });
  }
  const out = new Uint8Array(64); h.forEach((v, i) => { for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((v >> BigInt(56 - 8 * j)) & 0xffn); });
  return out;
}
// ---- 曲线运算（扩展坐标）----
const le2n = b => { let x = 0n; for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]); return x; };
const n2le = (x, n = 32) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
function add(p, q) {
  const [X1, Y1, Z1, T1] = p, [X2, Y2, Z2, T2] = q;
  const A = mod((Y1 - X1) * (Y2 - X2)), B = mod((Y1 + X1) * (Y2 + X2)), C = mod(T1 * 2n * D * T2), Dd = mod(Z1 * 2n * Z2);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(s, p) { let q = [0n, 1n, 1n, 0n]; while (s > 0n) { if (s & 1n) q = add(q, p); p = add(p, p); s >>= 1n; } return q; }
function recoverX(y, sign) {
  if (y >= P) return null;
  const x2 = mod((y * y - 1n) * inv(D * y * y + 1n)); if (x2 === 0n) return sign ? null : 0n;
  let x = pow(x2, (P + 3n) / 8n); if (mod(x * x - x2) !== 0n) x = mod(x * I); if (mod(x * x - x2) !== 0n) return null;
  if (Number(x & 1n) !== sign) x = P - x; return x;
}
const GY = mod(4n * inv(5n)), GX = recoverX(GY, 0), G = [GX, GY, 1n, mod(GX * GY)];
function compress(p) { const zi = inv(p[2]), x = mod(p[0] * zi), y = mod(p[1] * zi); return n2le(y | ((x & 1n) << 255n)); }
function decompress(b) { if (b.length !== 32) return null; const v = le2n(b), y = v & ((1n << 255n) - 1n), x = recoverX(y, Number(v >> 255n)); return x == null ? null : [x, y, 1n, mod(x * y)]; }
const eq = (p, q) => mod(p[0] * q[2] - q[0] * p[2]) === 0n && mod(p[1] * q[2] - q[1] * p[2]) === 0n;
function expand(seed) { const h = sha512(seed); let a = le2n(h.slice(0, 32)); a &= (1n << 254n) - 8n; a |= 1n << 254n; return { a, prefix: h.slice(32) }; }
/** 32 字节私钥种子 → 32 字节公钥 */
export const publicKey = seed => compress(mul(expand(seed).a, G));
/** 签名：64 字节 */
export function sign(seed, msg) {
  const { a, prefix } = expand(seed), A = compress(mul(a, G));
  const r = mod(le2n(sha512(cat(prefix, msg))), L), R = compress(mul(r, G));
  const h = mod(le2n(sha512(cat(R, A, msg))), L);
  return cat(R, n2le(mod(r + h * a, L)));
}
/** 验证：签名对得上返回 true（格式错、点不在曲线上都返回 false） */
export function verify(pub, msg, sig) {
  try {
    if (pub.length !== 32 || sig.length !== 64) return false;
    const A = decompress(pub), R = decompress(sig.slice(0, 32)); if (!A || !R) return false;
    const s = le2n(sig.slice(32)); if (s >= L) return false;
    const h = mod(le2n(sha512(cat(sig.slice(0, 32), pub, msg))), L);
    return eq(mul(s, G), add(R, mul(h, A)));
  } catch { return false; }
}
