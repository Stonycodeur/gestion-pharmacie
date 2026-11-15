// Faux adaptateur mysql2 : simule un hébergeur qui ferme la connexion (« closed state ») à la 4e requête.
let connects = 0;
export async function connect() {
  connects++; let n = 0, closed = false; const id = connects;
  return {
    on() {}, destroy() { closed = true; }, async ping() {}, async end() {},
    async query(sql) {
      n++; if (closed || (id === 1 && n === 4)) { closed = true; throw new Error("Can't add new command when connection is in closed state"); }
      if (/connects/.test(sql)) return [[{ c: connects }]];
      return [/^\s*(INSERT|UPDATE)/i.test(sql) ? { affectedRows: 1, insertId: 7 } : [{ x: 1 }]];
    },
  };
}
