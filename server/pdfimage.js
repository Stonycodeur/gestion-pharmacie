// Décodage d'images (JPEG, PNG) vers des objets intégrables dans un PDF — sans dépendance.
// JPEG : copie directe (DCTDecode). PNG 8 bits (gris, RVB, palette, avec ou sans transparence, non entrelacé) : défiltrage puis Flate, canal alpha en masque doux.
import zlib from 'node:zlib';
export function parseJpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null; let i = 2;
  while (i + 9 < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m === 0xff) { i++; continue; } const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { const bpc = b[i + 4], h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7), n = b[i + 9]; return { kind: 'jpeg', w, h, bpc, cs: n === 1 ? '/DeviceGray' : n === 4 ? '/DeviceCMYK' : '/DeviceRGB', data: b, decode: n === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '' }; }
    i += 2 + len; }
  return null;
}
export function parsePng(b) {
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null; let o = 8, w, h, bd, ct, il, plte = null, trns = null; const idat = [];
  while (o + 8 <= b.length) { const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; } else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; o += 12 + len; }
  if (!w || bd !== 8 || il !== 0 || ![0, 2, 3, 4, 6].includes(ct) || (ct === 3 && !plte) || w * h > 4e6) return null;
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], stride = w * ch; let raw; try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  if (raw.length < (stride + 1) * h) return null; const px = Buffer.alloc(stride * h); const bpp = ch;
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? px[dst + x - bpp] : 0, up = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; } else if (f !== 0) return null; px[dst + x] = v & 255; } }
  const n = w * h; let rgb, alpha = null;
  if (ct === 2) rgb = px; else if (ct === 0) { rgb = Buffer.alloc(n * 3); for (let i = 0; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i]; }
  else if (ct === 3) { rgb = Buffer.alloc(n * 3); if (trns) alpha = Buffer.alloc(n, 255); for (let i = 0; i < n; i++) { const k = px[i]; rgb[i * 3] = plte[k * 3]; rgb[i * 3 + 1] = plte[k * 3 + 1]; rgb[i * 3 + 2] = plte[k * 3 + 2]; if (trns && k < trns.length) alpha[i] = trns[k]; } }
  else if (ct === 4) { rgb = Buffer.alloc(n * 3); alpha = Buffer.alloc(n); for (let i = 0; i < n; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * 2]; alpha[i] = px[i * 2 + 1]; } }
  else { rgb = Buffer.alloc(n * 3); alpha = Buffer.alloc(n); for (let i = 0; i < n; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; alpha[i] = px[i * 4 + 3]; } }
  return { kind: 'flate', w, h, bpc: 8, cs: '/DeviceRGB', data: zlib.deflateSync(rgb), alpha: alpha && alpha.some((v) => v !== 255) ? zlib.deflateSync(alpha) : null };
}
export const parseImage = (b) => { try { return parseJpeg(b) || parsePng(b); } catch { return null; } };
