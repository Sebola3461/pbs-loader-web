import { Database, isUniqueViolation } from './db';
import { HttpError } from './http';
import { uuidv7 } from './ids';

export type Role = 'user' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'banned';

export interface User {
  id: string;
  username: string;
  role: Role;
  status: UserStatus;
}

/** O que o site mostra do usuário logado. A hash da senha nunca sai do servidor. */
export function publicUser(user: User) {
  return { id: user.id, username: user.username, role: user.role };
}

const USERNAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}_.\- ]{1,22})[\p{L}\p{N}]$/u;

/**
 * O username é login e nome público ao mesmo tempo: de 3 a 24 letras, números, espaço, "_", "." ou "-",
 * começando e terminando com letra ou número e sem espaço repetido.
 */
export function normalizeUsername(raw: unknown): { username: string; key: string } {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_username');
  const username = raw.normalize('NFKC').trim();
  if (!USERNAME.test(username) || username.includes('  ')) {
    throw new HttpError(400, 'invalid_username');
  }
  return { username, key: username.toLowerCase() };
}

const SELECT_USER_WITH_HASH = 'SELECT id, username, role, status, password_hash FROM users';

/** Cadastro cria o usuário com a hash da senha e registra a criação no histórico, na mesma transação. */
export async function registerUser(
  db: Database,
  username: string,
  usernameKey: string,
  passwordHash: string,
  now: Date,
): Promise<User> {
  const id = uuidv7(now);
  const at = now.toISOString();
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO users (id, username, username_key, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(id, username, usernameKey, passwordHash, at, at),
      db
        .prepare(
          "INSERT INTO user_events (user_id, actor_id, operation, created_at) VALUES (?, ?, 'create', ?)",
        )
        .bind(id, id, at),
    ]);
  } catch (error) {
    // Cadastro simultâneo com o mesmo nome: o outro ganhou.
    if (isUniqueViolation(error, 'users.username_key')) throw new HttpError(409, 'username_taken');
    throw error;
  }
  return { id, username, role: 'user', status: 'active' };
}

export async function findUserByUsernameKey(
  db: Database,
  usernameKey: string,
): Promise<(User & { passwordHash: string }) | null> {
  const row = await db
    .prepare(`${SELECT_USER_WITH_HASH} WHERE username_key = ?`)
    .bind(usernameKey)
    .first<{ id: string; username: string; role: Role; status: UserStatus; password_hash: string }>();
  if (!row)
    return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
  };
}

/** Troca do username: continua sendo um evento com antes/depois, e conflito com outro nome dá 409. */
export async function renameUsername(
  db: Database,
  user: User,
  raw: unknown,
  now: Date,
): Promise<User> {
  const { username, key } = normalizeUsername(raw);
  if (username === user.username) return user;
  const at = now.toISOString();
  try {
    await db.batch([
      db
        .prepare('UPDATE users SET username = ?, username_key = ?, updated_at = ? WHERE id = ?')
        .bind(username, key, at, user.id),
      db
        .prepare(
          "INSERT INTO user_events (user_id, actor_id, operation, detail, created_at) VALUES (?, ?, 'rename', ?, ?)",
        )
        .bind(user.id, user.id, JSON.stringify({ from: user.username, to: username }), at),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, 'users.username_key')) throw new HttpError(409, 'username_taken');
    throw error;
  }
  return { ...user, username };
}
