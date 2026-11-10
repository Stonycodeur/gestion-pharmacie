// Bus d'évènements temps réel (SSE) : les pages s'abonnent et se désabonnent toutes seules quand elles quittent l'écran.
const subs = new Map();
export function emit(ev, data) { for (const f of [...(subs.get(ev) || [])]) try { f(data); } catch { /* page fermée */ } }
export function onEvent(ev, fn, box) {
  const wrapped = (d) => { if (box && !box.isConnected) return off(); fn(d); };
  const off = () => subs.get(ev)?.delete(wrapped); if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(wrapped); return off;
}
