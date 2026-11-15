// Générateur de QR Code sans dépendance (mode octets, correction d'erreur M, versions 1 à 9 : jusqu'à 180 octets, validées au décodage).
// Sert à vérifier un reçu : le QR contient l'adresse publique de vérification.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const r = new Array(g.length + 1).fill(0); g.forEach((c, j) => { r[j] ^= c; r[j + 1] ^= mul(c, EXP[i]); }); g = r; } return g; }
function rsRem(data, n) { const g = rsGen(n), r = new Array(n).fill(0); for (const d of data) { const f = d ^ r.shift(); r.push(0); if (f) g.slice(1).forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
// [version] → [codewords de correction par bloc, [[nb blocs, mots de données]...]]
const VER = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const dataCap = (v) => VER[v][1].reduce((a, [n, k]) => a + n * k, 0);

function bchFormat(data) { let r = data << 10; for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10); return ((data << 10) | r) ^ 0x5412; }
function bchVersion(v) { let r = v << 12; for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1f25 << (i - 12); return (v << 12) | r; }

export function qrMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8'); let v = 1;
  while (v <= 9 && bytes.length + 2 > dataCap(v)) v++; // 4 bits mode + 8 bits longueur + octets + terminaison
  if (v > 9) throw new Error('QR : texte trop long');
  const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(0b0100, 4); put(bytes.length, 8); for (const b of bytes) put(b, 8);
  const cap = dataCap(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < dataCap(v); p++) cw.push(p % 2 ? 0x11 : 0xec);
  // blocs + correction d'erreur, puis entrelacement
  const [ecn, groups] = VER[v]; const blocks = []; let o = 0;
  for (const [n, k] of groups) for (let i = 0; i < n; i++) { const d = cw.slice(o, o + k); o += k; blocks.push({ d, e: rsRem(d, ecn) }); }
  const out = []; const maxd = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxd; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecn; i++) for (const b of blocks) out.push(b.e[i]);
  const stream = []; for (const c of out) for (let i = 7; i >= 0; i--) stream.push((c >> i) & 1);

  const n = 17 + 4 * v; const M = Array.from({ length: n }, () => new Array(n).fill(0)), F = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, val) => { M[r][c] = val ? 1 : 0; F[r][c] = true; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; set(rr, cc, (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4)); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v]; for (const r of al) for (const c of al) { if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }
  set(n - 8, 8, 1); // module sombre
  for (let i = 0; i < 9; i++) { if (!F[8][i]) set(8, i, 0); if (!F[i][8]) set(i, 8, 0); } for (let i = 0; i < 8; i++) { if (!F[8][n - 1 - i]) set(8, n - 1 - i, 0); if (!F[n - 1 - i][8]) set(n - 1 - i, 8, 0); }
  if (v >= 7) { const vi = bchVersion(v); for (let i = 0; i < 18; i++) { const b = (vi >> i) & 1, a = Math.floor(i / 3), c = (i % 3) + n - 11; set(a, c, b); set(c, a, b); } }
  const reserved = F.map((r) => r.slice());
  const mask = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  const place = (m) => {
    const R = M.map((r) => r.slice()); let i = 0, up = true;
    for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c--; for (let k = 0; k < n; k++) { const r = up ? n - 1 - k : k; for (const cc of [c, c - 1]) { if (reserved[r][cc]) continue; let b = i < stream.length ? stream[i++] : 0; if (mask[m](r, cc)) b ^= 1; R[r][cc] = b; } } up = !up; }
    const fi = bchFormat((0b00 << 3) | m); // niveau M = 00
    const fb = (k) => (fi >> k) & 1;
    for (let k = 0; k < 6; k++) R[k][8] = fb(k); R[7][8] = fb(6); R[8][8] = fb(7); R[8][7] = fb(8); for (let k = 9; k < 15; k++) R[8][14 - k] = fb(k);
    for (let k = 0; k < 8; k++) R[8][n - 1 - k] = fb(k); for (let k = 8; k < 15; k++) R[n - 15 + k][8] = fb(k); R[n - 8][8] = 1;
    return R;
  };
  const penalty = (R) => {
    let p = 0; const lines = [...R, ...R[0].map((_, c) => R.map((r) => r[c]))];
    for (const l of lines) { let run = 1; for (let i = 1; i < n; i++) { if (l[i] === l[i - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (R[r][c] === R[r][c + 1] && R[r][c] === R[r + 1][c] && R[r][c] === R[r + 1][c + 1]) p += 3;
    const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], rev = pat.slice().reverse();
    for (const l of lines) for (let i = 0; i + 11 <= n; i++) { const s = l.slice(i, i + 11); if (s.every((x, k) => x === pat[k]) || s.every((x, k) => x === rev[k])) p += 40; }
    const dark = R.flat().filter(Boolean).length; p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10; return p;
  };
  let best = null, bp = Infinity; for (let m = 0; m < 8; m++) { const R = place(m); const s = penalty(R); if (s < bp) { bp = s; best = R; } }
  return best;
}
export function qrSvg(text, { size = 220, margin = 4 } = {}) {
  const m = qrMatrix(text), n = m.length, t = n + margin * 2; let d = '';
  m.forEach((row, r) => { let c = 0; while (c < n) { if (!row[c]) { c++; continue; } let e = c; while (e < n && row[e]) e++; d += `M${c + margin} ${r + margin}h${e - c}v1h-${e - c}z`; c = e; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR code de vérification"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
