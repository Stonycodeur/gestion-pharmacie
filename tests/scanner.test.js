import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { scanBuiltin } = await import('../server/scanner.js');
const png = (extra = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('xxxxxxxxxxxxIEND\xaeB`\x82'), Buffer.from(extra)]);
test('antivirus intégré : fichiers sains acceptés', () => {
  assert.equal(scanBuiltin(png(), 'image/png').infected, false);
  assert.equal(scanBuiltin(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'), 'application/pdf').infected, false);
});
test('antivirus intégré : menaces détectées', () => {
  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  assert.ok(scanBuiltin(Buffer.concat([png(), Buffer.from(eicar)]), 'image/png').infected);
  assert.ok(scanBuiltin(png('<?php system($_GET[1]); ?>' + ' '.repeat(20)), 'image/png').infected);
  assert.ok(scanBuiltin(Buffer.from('MZ\x90\x00 programme'), 'image/png').infected);
  assert.ok(scanBuiltin(Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'), 'application/pdf').infected);
  assert.ok(scanBuiltin(png('A'.repeat(40)), 'image/png').infected, 'données cachées après IEND');
});
