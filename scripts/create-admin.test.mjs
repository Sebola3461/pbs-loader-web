import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAdminSql,
  hashPassword,
  normalizePassword,
  normalizeUsername,
  uuidv7,
} from './create-admin.mjs';

test('normalizeUsername aplica as regras do servidor', () => {
  assert.deepEqual(normalizeUsername('  HatsuneMiku '), { username: 'HatsuneMiku', key: 'hatsunemiku' });
  assert.equal(normalizeUsername('ab'), null);
  assert.equal(normalizeUsername('-fulana'), null);
  assert.equal(normalizeUsername('a  b'), null);
  assert.equal(normalizeUsername('x'.repeat(25)), null);
});

test('normalizePassword conta pontos de código e recusa curta', () => {
  assert.equal(normalizePassword('abcd1234'), 'abcd1234');
  assert.equal(normalizePassword('curta12'), null);
  assert.equal(normalizePassword('𝟘'.repeat(130)), null);
  assert.equal(normalizePassword(42), null);
});

test('hashPassword produz o formato que o servidor lê', async () => {
  const hash = await hashPassword('abcd1234', 10_000);
  assert.match(hash, /^pbkdf2\$sha256\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  const [, , iterations, salt, digest] = hash.split('$');
  assert.equal(iterations, '10000');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('abcd1234'), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: 10_000 },
    key,
    256,
  );
  assert.equal(btoa(String.fromCharCode(...new Uint8Array(bits))), digest);
});

test('buildAdminSql escapa apóstrofos e traz transação', () => {
  const sql = buildAdminSql({ username: "Miku'O", key: "miku'o", passwordHash: 'pbkdf2$sha256$1$a$b' });
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /'Miku''O'/);
  assert.match(sql, /'miku''o'/);
  assert.match(sql, /'pbkdf2\$sha256\$1\$a\$b'/);
  assert.match(sql, /'admin', 'active'/);
});

test('uuidv7 segue RFC 9562', () => {
  const id = uuidv7(new Date('2026-10-31T15:00:00.000Z'));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
