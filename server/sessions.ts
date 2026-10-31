import { Database } from './db';
import { HttpError } from './http';
import { randomToken, sha256Hex } from './ids';
import { User } from './users';

export const SESSION_COOKIE = '__Host-pbs_session';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Sem uso por 30 dias, a sessão cai; com uso, dura no máximo 90 dias. */
const IDLE_MS = 30 * DAY_MS;
const ABSOLUTE_MS = 90 * DAY_MS;
// last_seen_at só é regravado uma vez por dia, para não escrever no banco a cada requisição.
const TOUCH_MS = DAY_MS;

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const clearSessionCookie = () => sessionCookie('', 0);

function tokenFrom(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}

/** Cria a sessão e devolve o Set-Cookie. Aproveita para apagar as sessões vencidas de todo mundo. */
export async function createSession(db: Database, userId: string, now: Date): Promise<string> {
  const token = randomToken();
  const at = now.toISOString();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(at),
    db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        await sha256Hex(token),
        userId,
        at,
        at,
        new Date(now.getTime() + ABSOLUTE_MS).toISOString(),
      ),
  ]);
  return sessionCookie(token, IDLE_MS / 1000);
}

interface SessionRow extends User {
  token_hash: string;
  last_seen_at: string;
}

/**
 * Usuário da sessão do cookie, ou null se não houver sessão válida. O estado do usuário vem do banco a cada
 * requisição, então banir vale na hora.
 */
export async function currentUser(db: Database, request: Request, now: Date): Promise<User | null> {
  const token = tokenFrom(request);
  if (!token) return null;
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.last_seen_at, u.id, u.nickname, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ?`,
    )
    .bind(await sha256Hex(token), nowIso, new Date(now.getTime() - IDLE_MS).toISOString())
    .first<SessionRow>();
  if (!row) return null;
  if (row.last_seen_at <= new Date(now.getTime() - TOUCH_MS).toISOString()) {
    await db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .bind(nowIso, row.token_hash)
      .run();
  }
  return { id: row.id, nickname: row.nickname, role: row.role, status: row.status };
}

/** Usuário logado e ativo, ou erro: 401 sem sessão, 403 banido. */
export async function requireUser(db: Database, request: Request, now: Date): Promise<User> {
  const user = await currentUser(db, request, now);
  if (!user) throw new HttpError(401, 'login_required');
  if (user.status !== 'active') throw new HttpError(403, 'banned');
  return user;
}

export async function deleteSession(db: Database, request: Request): Promise<void> {
  const token = tokenFrom(request);
  if (token)
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
}
