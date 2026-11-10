// Jeu d'icônes SVG (grille 24, trait arrondi, couleur héritée via currentColor). Remplace tout emoji de l'interface.
const NS = 'http://www.w3.org/2000/svg';
// forme : string = chemin ; {c:[cx,cy,r]} cercle ; {r:[x,y,w,h,rx]} rectangle
const I = {
  pin: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', { c: [12, 10, 2.5] }],
  image: [{ r: [3, 4, 18, 16, 2] }, { c: [9, 10, 1.6] }, 'M21 16l-5-5-8 8'],
  message: ['M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z'],
  folder: ['M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  calendar: [{ r: [3, 5, 18, 16, 2] }, 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  steth: ['M6 3v6a4 4 0 0 0 8 0V3', 'M10 13v2a5 5 0 0 0 10 0v-1', { c: [20, 12, 2] }],
  mail: [{ r: [3, 5, 18, 14, 2] }, 'M3 7l9 6 9-6'],
  car: ['M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16', 'M3 16h18v3H3z', { c: [7, 19, 1.2] }, { c: [17, 19, 1.2] }],
  navigate: ['M3 11l18-8-8 18-2-8z'],
  restore: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  help: [{ c: [12, 12, 9] }, 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7', { c: [12, 17, .5] }],
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  cart: ['M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6', { c: [10, 20.3, 1.3] }, { c: [18, 20.3, 1.3] }],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  wallet: ['M3 7a2 2 0 0 1 2-2h13v4', 'M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3', 'M21 9h-4a2 2 0 0 0 0 4h4z'],
  pill: ['M10.5 20.5a4.95 4.95 0 0 1-7-7l10-10a4.95 4.95 0 0 1 7 7z', 'M8.5 8.5l7 7'],
  boxes: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3.3 7.5L12 12l8.7-4.5', 'M12 12v9'],
  clipboard: ['M9 4h6v3H9z', 'M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2', 'M9 14l2 2 4-4'],
  truck: ['M3 6h11v10H3z', 'M14 9h4l3 3v4h-7', { c: [7, 18.5, 1.7] }, { c: [17, 18.5, 1.7] }],
  bag: ['M6 7h12l1 13H5z', 'M9 7a3 3 0 0 1 6 0'],
  file: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  users: [{ c: [9, 8, 3.5] }, 'M2.5 20a6.5 6.5 0 0 1 13 0', { c: [17, 9, 2.5] }, 'M17 14.5a5 5 0 0 1 4.5 5'],
  user: [{ c: [12, 8, 4] }, 'M4 21a8 8 0 0 1 16 0'],
  store: ['M4 9l1.5-5h13L20 9', 'M4 9v11h16V9', 'M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9', 'M10 20v-6h4v6'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  swap: ['M7 7h13', 'M17 4l3 3-3 3', 'M17 17H4', 'M7 14l-3 3 3 3'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  lock: [{ r: [5, 11, 14, 9, 2] }, 'M8 11V8a4 4 0 0 1 8 0v3'],
  history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 8v4l3 2'],
  sliders: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1', { c: [15, 6, 2] }, { c: [9, 12, 2] }, { c: [17, 18, 2] }],
  bell: ['M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8', 'M10 20a2 2 0 0 0 4 0'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  sun: [{ c: [12, 12, 4] }, 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  clip: ['M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8-8'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  search: [{ c: [11, 11, 6.5] }, 'M16 16l4.5 4.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  down: ['M6 9l6 6 6-6'], left: ['M15 6l-6 6 6 6'], right: ['M9 6l6 6-6 6'],
  more: [{ c: [5, 12, 1.2] }, { c: [12, 12, 1.2] }, { c: [19, 12, 1.2] }],
  apps: [{ r: [4, 4, 6, 6, 1.5] }, { r: [14, 4, 6, 6, 1.5] }, { r: [4, 14, 6, 6, 1.5] }, { r: [14, 14, 6, 6, 1.5] }],
  wifi: ['M2 8.8a15 15 0 0 1 20 0', 'M5 12.9a10 10 0 0 1 14 0', 'M8.5 16.4a5 5 0 0 1 7 0', { c: [12, 20, 0.8] }],
  wifioff: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 5-1.3', 'M5 12.9a10 10 0 0 1 4-2.5', 'M2 8.8a15 15 0 0 1 4.3-2.7', 'M19 12.9a10 10 0 0 0-2.7-1.9', 'M22 8.8a15 15 0 0 0-9.5-3.7', { c: [12, 20, 0.8] }],
  refresh: ['M20 11a8 8 0 0 0-14.5-4', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.5 4', 'M20 20v-4h-4'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M4 20h16'],
  printer: ['M7 9V3h10v6', { r: [4, 9, 16, 8, 2] }, 'M7 14h10v7H7z'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z', { c: [7.5, 11, 1] }, { c: [10, 7, 1] }, { c: [15, 7, 1] }],
  logout: ['M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5', 'M15 8l4 4-4 4', 'M19 12H9'],
  scan: ['M4 7V5a1 1 0 0 1 1-1h2', 'M17 4h2a1 1 0 0 1 1 1v2', 'M20 17v2a1 1 0 0 1-1 1h-2', 'M7 20H5a1 1 0 0 1-1-1v-2', 'M8 8v8', 'M12 8v8', 'M16 8v8'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18.2v.1'],
  info: [{ c: [12, 12, 9] }, 'M12 11v5', 'M12 8v.1'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  edit: ['M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z', 'M14 7l3 3'],
  upload: ['M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18', 'M12 12v7', 'M9 15l3-3 3 3'],
  inbox: ['M4 13l2-8h12l2 8', 'M4 13v6h16v-6', 'M4 13h5l1 2h4l1-2h5'],
  cash: [{ r: [2, 6, 20, 12, 2] }, { c: [12, 12, 2.5] }, 'M6 12h.1', 'M18 12h.1'],
  type: ['M4 7V5h16v2', 'M12 5v14', 'M9 19h6'],
  layout: [{ r: [3, 4, 18, 6, 1.5] }, { r: [3, 14, 18, 6, 1.5] }],
  cross: ['M9 3h6v6h6v6h-6v6H9v-6H3V9h6z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z'],
  globe: [{ c: [12, 12, 9] }, 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  rotate: ['M3 12a9 9 0 0 1 15.5-6.3L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15.5 6.3L3 16', 'M3 21v-5h5'],
  cloudoff: ['M2 2l20 20', 'M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 2-2.7', 'M17.5 18A4 4 0 0 0 18 9.5 6 6 0 0 0 11 4.2'],
  star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
};
export const iconNames = Object.keys(I);
export function icon(name, { size = 20, cls = '', label = '' } = {}) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('class', ('ic ' + cls).trim());
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  for (const sh of I[name] || I.info) {
    let el;
    if (typeof sh === 'string') { el = document.createElementNS(NS, 'path'); el.setAttribute('d', sh); }
    else if (sh.c) { el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', sh.c[0]); el.setAttribute('cy', sh.c[1]); el.setAttribute('r', sh.c[2]); }
    else { el = document.createElementNS(NS, 'rect'); const [x, y, w, hh, rx] = sh.r; el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', rx || 0); }
    s.append(el);
  }
  return s;
}
