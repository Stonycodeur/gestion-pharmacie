// Icônes SVG (mêmes tracés que le web, couleur au choix) — aucun emoji dans l'interface.
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
type Shape = string | { c: [number, number, number] } | { r: [number, number, number, number, number] };
const I: Record<string, Shape[]> = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  boxes: ['M21 8l-9-5-9 5v8l9 5 9-5z', 'M3.3 7.5L12 12l8.7-4.5', 'M12 12v9'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8', 'M10 20a2 2 0 0 0 4 0'],
  bag: ['M6 7h12l1 13H5z', 'M9 7a3 3 0 0 1 6 0'],
  truck: ['M3 6h11v10H3z', 'M14 9h4l3 3v4h-7', 'M5.5 18.5h3', 'M15.5 18.5h3'],
  file: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  user: [{ c: [12, 8, 4] }, 'M4 21a8 8 0 0 1 16 0'],
  pill: ['M10.5 20.5a4.95 4.95 0 0 1-7-7l10-10a4.95 4.95 0 0 1 7 7z', 'M8.5 8.5l7 7'],
  wifioff: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 5-1.3', 'M5 12.9a10 10 0 0 1 4-2.5', 'M2 8.8a15 15 0 0 1 4.3-2.7', 'M19 12.9a10 10 0 0 0-2.7-1.9', 'M22 8.8a15 15 0 0 0-9.5-3.7', { c: [12, 20, 0.8] }],
  store: ['M4 9l1.5-5h13L20 9', 'M4 9v11h16V9', 'M10 20v-6h4v6'],
};
export const Icon = ({ name, size = 24, color = '#000' }: { name: keyof typeof I | string; size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {(I[name] ?? I.dashboard).map((sh, i) => typeof sh === 'string' ? <Path key={i} d={sh} /> : 'c' in sh ? <Circle key={i} cx={sh.c[0]} cy={sh.c[1]} r={sh.c[2]} /> : <Rect key={i} x={sh.r[0]} y={sh.r[1]} width={sh.r[2]} height={sh.r[3]} rx={sh.r[4]} />)}
  </Svg>
);
