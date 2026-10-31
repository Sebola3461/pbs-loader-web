#!/usr/bin/env node
/**
 * Cria o SQL de bootstrap do admin, sem guardar segredo nenhum no repositório.
 *
 * Uso:
 *   node scripts/create-admin.mjs [--username HatsuneMiku]
 *
 * O script pede a senha duas vezes no terminal, gera o hash PBKDF2 (mesmo formato do servidor) e imprime
 * os comandos `wrangler d1 execute` prontos, para --local e --remote. Nada é enviado a lugar nenhum.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFileSync } from 'node:fs';

const DEFAULT_USERNAME = 'HatsuneMiku';
/** Mesmo valor de PBKDF2_ITERATIONS em produção (wrangler.toml): 600k estoura a CPU do plano free,
 *  e cada login do admin pagaria esse preço. O formato da hash guarda as iterações usadas. */
const DEFAULT_ITERATIONS = 100_000;

/** Mesmas regras do servidor (server/users.ts): NFKC, 3 a 24 pontos, sem espaço duplo. */
export function normalizeUsername(raw) {
  const username = String(raw).normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}_.\- ]{1,22})[\p{L}\p{N}]$/u.test(username)) return null;
  if (username.includes('  ')) return null;
  return { username, key: username.toLowerCase() };
}

/** Senha idêntica à do servidor (server/password.ts): 8 a 128 pontos de código. */
export function normalizePassword(raw) {
  if (typeof raw !== 'string') return null;
  const password = raw.normalize('NFKC');
  const chars = Array.from(password).length;
  return chars >= 8 && chars <= 128 ? password : null;
}

/** PBKDF2-SHA256, formato "pbkdf2$sha256$<iterações>$<salt>$<hash>" — o mesmo que o servidor lê. */
export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

/** UUIDv7 com o mesmo formato do servidor (server/ids.ts). */
export function uuidv7(now) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = now.getTime();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** INSERT do admin + o evento de criação. Sem BEGIN/COMMIT: o D1 rejeita transação explícita no execute. */
export function buildAdminSql({ username, key, passwordHash, now = new Date(), id = uuidv7(now) }) {
  const at = now.toISOString();
  return [
    `INSERT INTO users (id, username, username_key, password_hash, role, status, created_at, updated_at)
     VALUES (${sqlLiteral(id)}, ${sqlLiteral(username)}, ${sqlLiteral(key)}, ${sqlLiteral(passwordHash)}, 'admin', 'active', ${sqlLiteral(at)}, ${sqlLiteral(at)});`,
    `INSERT INTO user_events (user_id, actor_id, operation, created_at)
     VALUES (${sqlLiteral(id)}, ${sqlLiteral(id)}, 'create', ${sqlLiteral(at)});`,
  ].join('\n');
}

async function askPassword(rl) {
  for (;;) {
    const first = await rl.question('Senha do admin (8 a 128 caracteres): ');
    const second = await rl.question('Repita a senha: ');
    if (first !== second) {
      console.error('As duas entradas diferem. Tente de novo.');
      continue;
    }
    const normalized = normalizePassword(first);
    if (normalized === null) {
      console.error('A senha precisa de 8 a 128 caracteres.');
      continue;
    }
    return normalized;
  }
}

function usernameFrom(argv) {
  const index = argv.indexOf('--username');
  const value = index >= 0 ? argv[index + 1] : undefined;
  const candidate = value ?? DEFAULT_USERNAME;
  return normalizeUsername(candidate) ?? (() => {
    console.error(`Username inválido: ${candidate}`);
    process.exit(1);
  })();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const { username, key } = usernameFrom(process.argv.slice(2));
  const rl = createInterface({ input: stdin, output: stdout });
  const password = await askPassword(rl);
  rl.close();
  const passwordHash = await hashPassword(password);
  const sql = buildAdminSql({ username, key, passwordHash });
  // O SQL vai para arquivo: colado inline, o PowerShell interpola $sha256 como variável inexistente
  // e o comando morre antes de tocar no banco — o admin nunca era criado.
  const outFile = 'admin-bootstrap.sql';
  writeFileSync(outFile, sql + '\n', 'utf8');
  console.log(`\nSQL gravado em ${outFile} (não versionado; contém só a hash, nunca a senha).`);
  console.log('Rode UMA das linhas abaixo, exatamente como está:');
  console.log('Local (desenvolvimento):');
  console.log(`npx wrangler d1 execute pbs-loader-web --local --file ${outFile}`);
  console.log('Remoto (produção):');
  console.log(`npx wrangler d1 execute pbs-loader-web --remote --file ${outFile}`);
  console.log('\nA senha não aparece em lugar nenhum — só a hash dela.');
}

export const __testOnly = { sqlLiteral };
