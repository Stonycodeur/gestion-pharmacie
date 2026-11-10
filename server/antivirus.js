// Analyse antivirus facultative via ClamAV (clamd, protocole INSTREAM) : CLAMD_HOST (+ CLAMD_PORT, défaut 3310).
// Fichier infecté : supprimé du disque, retiré de l'ordonnance et signalé aux pharmaciens.
import net from 'node:net';
export const avEnabled = () => !!process.env.CLAMD_HOST;
export function scanBuffer(buf) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: process.env.CLAMD_HOST, port: Number(process.env.CLAMD_PORT) || 3310 }); let out = '';
    s.setTimeout(30000, () => { s.destroy(); reject(new Error('clamd : délai dépassé')); }); s.on('error', reject);
    s.on('data', (d) => (out += d)); s.on('end', () => resolve(/FOUND/.test(out) ? { infected: true, signature: out.replace(/^stream:\s*|\s*FOUND.*$/gs, '').trim() } : /OK/.test(out) ? { infected: false } : reject(new Error('clamd : réponse inattendue ' + out.trim()))));
    s.write('zINSTREAM\0'); for (let i = 0; i < buf.length; i += 65536) { const c = buf.subarray(i, i + 65536), l = Buffer.alloc(4); l.writeUInt32BE(c.length); s.write(l); s.write(c); } s.write(Buffer.alloc(4));
  });
}
