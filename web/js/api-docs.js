const spec = await (await fetch('/api/v1/openapi.json')).json(); const out = document.getElementById('out');
const rows = Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops).map(([m, o]) => [m.toUpperCase(), p, o.summary]));
const t = document.createElement('table'); t.innerHTML = '<thead><tr><th>Méthode</th><th>Chemin</th><th>Accès</th></tr></thead>'; const tb = document.createElement('tbody');
for (const r of rows) { const tr = document.createElement('tr'); for (const c of r) { const td = document.createElement('td'); td.textContent = c; tr.append(td); } tb.append(tr); }
t.append(tb); const w = document.createElement('div'); w.className = 'tw'; w.append(t); out.append(w);
