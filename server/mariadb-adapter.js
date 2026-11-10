// Adaptateur mysql2 utilisé par le thread de travail (remplaçable en test).
export async function connect(cfg) {
  let mysql;
  try { mysql = (await import('mysql2/promise')).default; }
  catch { throw new Error("Le paquet « mysql2 » est requis pour DB_DRIVER=mariadb : npm install mysql2"); }
  const base = { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, multipleStatements: true, dateStrings: true, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false, timezone: 'Z', charset: 'utf8mb4', ssl: cfg.ssl ? { rejectUnauthorized: cfg.sslRejectUnauthorized !== false } : undefined };
  const conn = await mysql.createConnection(base);
  await conn.query("SET time_zone='+00:00', sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT'");
  return conn;
}
