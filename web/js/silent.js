// Rafraîchissement silencieux : une page qui se met à jour (évènement temps réel, minuterie) ne doit JAMAIS
// interrompre ce que fait l'utilisateur. soft(racine, redessiner) :
//   • reporte la mise à jour tant que l'utilisateur tape, sélectionne du texte, a une fenêtre ouverte ou vient d'écrire ;
//   • sinon redessine en conservant filtres, recherches, blocs ouverts (▶), onglets défilés et position de défilement.
let lastKey = 0;
for (const ev of ['keydown', 'input', 'paste', 'compositionstart']) addEventListener(ev, () => { lastKey = Date.now(); }, true);
const SKIP = new Set(['file', 'password', 'button', 'submit', 'reset', 'hidden', 'image']);
const ctrls = (root) => [...root.querySelectorAll('input,select,textarea')].filter((e) => !SKIP.has(e.type));
const keyOf = (e) => [e.tagName, e.type, e.name || e.getAttribute('aria-label') || e.placeholder || e.id || ''].join('|');
function keyed(root) { const seen = new Map(); return ctrls(root).map((e) => { const k = keyOf(e), n = seen.get(k) || 0; seen.set(k, n + 1); return [k + '#' + n, e]; }); }
export function busy(root) {
  if (document.querySelector('.overlay')) return true; // une fenêtre (paiement, suivi, historique…) est ouverte
  const a = document.activeElement; if (a && root.contains(a) && a.matches?.('input,textarea,select,[contenteditable]') && !SKIP.has(a.type)) return true;
  if (Date.now() - lastKey < 6000) return true; // l'utilisateur vient de taper
  const sel = getSelection?.(); return !!(sel && !sel.isCollapsed && sel.anchorNode && root.contains(sel.anchorNode));
}
function snapshot(root) {
  return { y: scrollY, vals: keyed(root).map(([k, e]) => [k, e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value]),
    open: [...root.querySelectorAll('details[open]')].map((d) => d.querySelector('summary')?.textContent.trim()), scrollers: [...root.querySelectorAll('.tw,.tabs')].map((e) => e.scrollLeft) };
}
function restore(root, s) {
  for (const d of root.querySelectorAll('details')) if (s.open.includes(d.querySelector('summary')?.textContent.trim())) d.open = true; // rouvre « Commandes passées »…
  const m = new Map(s.vals); for (const [k, e] of keyed(root)) { if (!m.has(k)) continue; const v = m.get(k); const ck = e.type === 'checkbox' || e.type === 'radio';
    if ((ck ? e.checked : e.value) !== v) { if (ck) e.checked = v; else e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }
  root.querySelectorAll('.tw,.tabs').forEach((e, i) => { if (s.scrollers[i]) e.scrollLeft = s.scrollers[i]; });
  const back = () => scrollTo(0, s.y); back(); requestAnimationFrame(back); setTimeout(back, 250);
}
const timers = new WeakMap();
export function soft(root, redraw) {
  if (!root?.isConnected) return Promise.resolve(false);
  if (busy(root)) { if (!timers.has(root)) timers.set(root, setTimeout(() => { timers.delete(root); soft(root, redraw); }, 4000)); return Promise.resolve(false); }
  const s = snapshot(root), h0 = root.offsetHeight; root.style.minHeight = h0 + 'px'; // évite le saut de page pendant le rechargement
  return Promise.resolve().then(redraw).then(() => { restore(root, s); return true; }).catch(() => false).finally(() => setTimeout(() => { root.style.minHeight = ''; }, 400));
}

// Mise à jour « sans rien voir » : on ne redessine que si les DONNÉES ont réellement changé (les champs qui bougent en continu —
// position GPS, distances, délais — sont ignorés ; la carte et le suivi se mettent à jour séparément, sur place).
const VOLATILE = /(lat|lng|heading|speed|eta|distance|_m$|_min$|updated|last_seen|seen|ts$)/i;
export function changed(el, data) { const s = JSON.stringify(data, (k, v) => (VOLATILE.test(k) ? undefined : v)); if (el._sig === s) return false; el._sig = s; return true; }
