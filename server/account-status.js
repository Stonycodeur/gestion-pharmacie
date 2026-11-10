// Statut effectif d'un compte : une suspension temporaire expire d'elle-même (réactivation au premier accès après l'échéance).
import { run } from './db.js';
import { nowSql } from './util.js';
export function reviveExpired(u) {
  if (u && u.status === 'suspended' && u.suspended_until && u.suspended_until <= nowSql()) {
    run("UPDATE users SET status='active', suspended_until=NULL, status_reason=NULL, updated_at=datetime('now') WHERE id=?", u.id); u.status = 'active'; return true;
  }
  return false;
}
