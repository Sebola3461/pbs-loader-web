import { Database, isUniqueViolation } from './db';
import { HttpError } from './http';
import { uuidv7 } from './ids';

export type Role = 'user' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'banned';

export interface User {
  id: string;
  nickname: string | null;
  role: Role;
  status: UserStatus;
}

/** O que o site mostra do usuário logado. O "sub" do Google nunca sai do servidor. */
export function publicUser(user: User) {
  return { id: user.id, nickname: user.nickname, role: user.role };
}

const NICKNAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}_.\- ]{1,22})[\p{L}\p{N}]$/u;

/**
 * Apelido público, já que o nome do perfil do Google é o nome real da pessoa: de 3 a 24 letras, números, espaço,
 * "_", "." ou "-", começando e terminando com letra ou número e sem espaço repetido.
 */
export function normalizeNickname(raw: unknown): { nickname: string; key: string } {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_nickname');
  const nickname = raw.normalize('NFKC').trim();
  if (!NICKNAME.test(nickname) || nickname.includes('  ')) {
    throw new HttpError(400, 'invalid_nickname');
  }
  return { nickname, key: nickname.toLowerCase() };
}

const SELECT_USER = 'SELECT id, nickname, role, status FROM users';

/** Primeiro login cria o usuário (sem apelido) e registra a criação no histórico, na mesma transação. */
export async function findOrCreateUser(db: Database, googleSub: string, now: Date): Promise<User> {
  const existing = await db
    .prepare(`${SELECT_USER} WHERE google_sub = ?`)
    .bind(googleSub)
    .first<User>();
  if (existing) return existing;

  const id = uuidv7(now);
  const at = now.toISOString();
  try {
    await db.batch([
      db
        .prepare('INSERT INTO users (id, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(id, googleSub, at, at),
      db
        .prepare(
          "INSERT INTO user_events (user_id, actor_id, operation, created_at) VALUES (?, ?, 'create', ?)",
        )
        .bind(id, id, at),
    ]);
  } catch (error) {
    // Dois logins simultâneos da mesma conta: o outro criou primeiro.
    if (!isUniqueViolation(error, 'users.google_sub')) throw error;
  }
  const created = await db
    .prepare(`${SELECT_USER} WHERE google_sub = ?`)
    .bind(googleSub)
    .first<User>();
  if (!created) throw new Error('usuário sumiu logo depois de criado');
  return created;
}

export async function setNickname(
  db: Database,
  user: User,
  raw: unknown,
  now: Date,
): Promise<User> {
  const { nickname, key } = normalizeNickname(raw);
  if (nickname === user.nickname) return user;
  const at = now.toISOString();
  try {
    await db.batch([
      db
        .prepare('UPDATE users SET nickname = ?, nickname_key = ?, updated_at = ? WHERE id = ?')
        .bind(nickname, key, at, user.id),
      db
        .prepare(
          "INSERT INTO user_events (user_id, actor_id, operation, detail, created_at) VALUES (?, ?, 'rename', ?, ?)",
        )
        .bind(user.id, user.id, JSON.stringify({ from: user.nickname, to: nickname }), at),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, 'users.nickname_key')) throw new HttpError(409, 'nickname_taken');
    throw error;
  }
  return { ...user, nickname };
}
