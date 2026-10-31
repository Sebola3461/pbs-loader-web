import { CatalogEntry } from './catalog';
import { Database } from './db';
import { HttpError } from './http';
import { User } from './users';

/** Mudanças de nota por usuário por hora; mais que isso é abuso ou script. */
export const RATING_CHANGES_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

export interface ModStats {
  count: number;
  average: number;
}

function parseStars(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 5) {
    throw new HttpError(400, 'invalid_stars');
  }
  return raw;
}

/** Quem pode avaliar este mod: ele precisa estar publicado e não pode ser do próprio usuário. */
function checkCanRate(user: User, modId: string, mods: Map<string, CatalogEntry>): void {
  const mod = mods.get(modId);
  if (!mod) throw new HttpError(404, 'mod_not_found');
  if (mod.dono.site === user.id) throw new HttpError(403, 'own_mod');
}

async function checkRateLimit(db: Database, user: User, now: Date): Promise<void> {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM rating_events WHERE user_id = ? AND created_at > ?')
    .bind(user.id, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= RATING_CHANGES_PER_HOUR) throw new HttpError(429, 'too_many_changes');
}

/** Grava (ou troca) a nota. Repetir a mesma chamada dá o mesmo resultado; cada mudança vai para o histórico. */
export async function setRating(
  db: Database,
  user: User,
  modId: string,
  rawStars: unknown,
  mods: Map<string, CatalogEntry>,
  now: Date,
): Promise<number> {
  const stars = parseStars(rawStars);
  checkCanRate(user, modId, mods);
  const current = await db
    .prepare('SELECT stars FROM ratings WHERE user_id = ? AND mod_id = ?')
    .bind(user.id, modId)
    .first<{ stars: number }>();
  if (current?.stars === stars) return stars;
  await checkRateLimit(db, user, now);
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO ratings (user_id, mod_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, mod_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`,
      )
      .bind(user.id, modId, stars, at, at),
    db
      .prepare(
        "INSERT INTO rating_events (user_id, mod_id, operation, stars, created_at) VALUES (?, ?, 'set', ?, ?)",
      )
      .bind(user.id, modId, stars, at),
  ]);
  return stars;
}

/** Tira a nota. Sem nota, não faz nada (e não gera evento). */
export async function removeRating(
  db: Database,
  user: User,
  modId: string,
  now: Date,
): Promise<void> {
  const current = await db
    .prepare('SELECT stars FROM ratings WHERE user_id = ? AND mod_id = ?')
    .bind(user.id, modId)
    .first<{ stars: number }>();
  if (!current) return;
  await checkRateLimit(db, user, now);
  const at = now.toISOString();
  await db.batch([
    db.prepare('DELETE FROM ratings WHERE user_id = ? AND mod_id = ?').bind(user.id, modId),
    db
      .prepare(
        "INSERT INTO rating_events (user_id, mod_id, operation, stars, created_at) VALUES (?, ?, 'remove', NULL, ?)",
      )
      .bind(user.id, modId, at),
  ]);
}

export async function userRatings(db: Database, userId: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare('SELECT mod_id, stars FROM ratings WHERE user_id = ?')
    .bind(userId)
    .all<{ mod_id: string; stars: number }>();
  return Object.fromEntries(results.map((r) => [r.mod_id, r.stars]));
}

const roundAverage = (average: number) => Math.round(average * 100) / 100;

/** Contagem e média por mod. Calculado na hora: com o índice por mod_id, é barato nesta escala. */
export async function ratingStats(db: Database): Promise<Record<string, ModStats>> {
  const { results } = await db
    .prepare('SELECT mod_id, COUNT(*) AS count, AVG(stars) AS average FROM ratings GROUP BY mod_id')
    .all<{ mod_id: string; count: number; average: number }>();
  return Object.fromEntries(
    results.map((r) => [r.mod_id, { count: r.count, average: roundAverage(r.average) }]),
  );
}

/** Contagem e média de um mod só, ou null sem nenhuma nota. */
export async function modStats(db: Database, modId: string): Promise<ModStats | null> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count, AVG(stars) AS average FROM ratings WHERE mod_id = ?')
    .bind(modId)
    .first<{ count: number; average: number | null }>();
  return row && row.count > 0 && row.average !== null
    ? { count: row.count, average: roundAverage(row.average) }
    : null;
}
