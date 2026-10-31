import { Database } from './db';
import { HttpError } from './http';

/**
 * Trava de força bruta por janela de uma hora, no banco (as isolas do Workers não compartilham memória).
 * Separado por conta e por IP: credential stuffing distribui IPs, e um IP compartilhado (NAT) não pode derrubar
 * todo mundo que passa por ele — por isso limites diferentes.
 */
export const LOGIN_LIMIT_PER_ACCOUNT = 10;
export const LOGIN_LIMIT_PER_IP = 30;
export const REGISTER_LIMIT_PER_IP = 5;
/** Janelas velhas saem do banco junto com o uso, como as sessões vencidas. */
const KEEP_WINDOWS_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type AttemptKind = 'login-account' | 'login-ip' | 'register-ip';

export function attemptWindow(now: Date): string {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

function cleanup(db: Database, now: Date) {
  return db
    .prepare('DELETE FROM auth_attempts WHERE window <= ?')
    .bind(new Date(now.getTime() - KEEP_WINDOWS_MS).toISOString());
}

/** Lança 429 quando a janela atual já gastou a cota. */
export async function throttleBudget(
  db: Database,
  kind: AttemptKind,
  key: string,
  limit: number,
  now: Date,
): Promise<void> {
  const row = await db
    .prepare('SELECT attempts FROM auth_attempts WHERE kind = ? AND key = ? AND window = ?')
    .bind(kind, key, attemptWindow(now))
    .first<{ attempts: number }>();
  if (row && row.attempts >= limit) throw new HttpError(429, 'too_many_attempts');
}

/** Soma uma tentativa na janela atual e aproveita para limpar as janelas velhas. */
export async function recordAttempt(
  db: Database,
  kind: AttemptKind,
  key: string,
  now: Date,
): Promise<void> {
  const window = attemptWindow(now);
  await db.batch([
    cleanup(db, now),
    db
      .prepare(
        `INSERT INTO auth_attempts (kind, key, window, attempts) VALUES (?, ?, ?, 1)
         ON CONFLICT (kind, key, window) DO UPDATE SET attempts = attempts + 1`,
      )
      .bind(kind, key, window),
  ]);
}

/** IP que a Cloudflare garante no cabeçalho; sem ele (testes locais) uma chave única evita travar todos de uma vez. */
export function ipOf(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
