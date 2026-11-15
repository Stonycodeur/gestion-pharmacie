// Logo dans le PDF : décodage JPEG/PNG (avec transparence) et intégration au reçu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseImage } from '../server/pdfimage.js';
import { pdfPaymentReceipt } from '../server/export.js';
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };
function png(w, h, ct, px) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ct; const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; const raw = Buffer.alloc((w * ch + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * ch + 1)] = y % 5; for (let x = 0; x < w * ch; x++) raw[y * (w * ch + 1) + 1 + x] = px(x, y); }
  // filtres appliqués à l'encodage (0..4) pour exercer le défiltrage
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
test('PNG RVBA décodé (alpha en masque) et logo intégré au PDF', () => {
  const im = parseImage(png(8, 8, 6, (x, y) => (x % 4 === 3 ? (y % 2 ? 255 : 128) : (x * 17 + y * 5) & 255)));
  assert.ok(im && im.kind === 'flate' && im.w === 8 && im.alpha);
  const pdf = pdfPaymentReceipt({ pharmacy: { name: 'Pharmacie Test' }, receipt: { number: 'R1', decimals: 0, currency: 'XAF', amount: 1000, signature: 'a'.repeat(64), code: 'ABC', created_at: '2026-01-01T00:00:00' }, lines: [], tax: 0, logo: im, verify_url: 'https://x/y', matrix: null });
  const s = pdf.toString('latin1'); assert.match(s, /\/Subtype \/Image/); assert.match(s, /\/SMask/); assert.match(s, /\/XObject << \/Im1 \d+ 0 R >>/); assert.ok(s.endsWith('%%EOF\n'));
});
test('PNG gris et JPEG reconnus ; formats non pris en charge refusés proprement', () => {
  assert.equal(parseImage(png(4, 4, 0, (x) => x * 30))?.w, 4);
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0000b08000a001401012200ffd9', 'hex'); const j = parseImage(jpg); assert.equal(j.kind, 'jpeg'); assert.equal(j.w, 20); assert.equal(j.h, 10);
  assert.equal(parseImage(Buffer.from('GIF89a....')), null);
});
