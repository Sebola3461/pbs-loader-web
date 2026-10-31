import { catalogMods, DEFAULT_CATALOG_URL, MOD_ID } from './catalog';
import { Env } from './db';
import { publishToGithub, pullRequestState } from './github';
import { field, HttpError, json, noContent, readJson, requireSameOrigin, RouteResult } from './http';
import { hashPassword, iterationsFromEnv, normalizePassword, verifyPassword } from './password';
import { modStats, ratingStats, removeRating, setRating, userRatings } from './ratings';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  deleteSession,
  requireUser,
} from './sessions';
import { recordSubmission } from './submissions';
import {
  ipOf,
  LOGIN_LIMIT_PER_ACCOUNT,
  LOGIN_LIMIT_PER_IP,
  recordAttempt,
  REGISTER_LIMIT_PER_IP,
  throttleBudget,
} from './throttle';
import { verifyTurnstile } from './turnstile';
import {
  findUserByUsernameKey,
  normalizeUsername,
  publicUser,
  registerUser,
  renameUsername,
  User,
} from './users';

/** O que varia entre produção e teste: o relógio e o fetch para o Turnstile e o catálogo. */
export interface Deps {
  now: () => Date;
  fetchImpl: typeof fetch;
}

export const defaultDeps: Deps = { now: () => new Date(), fetchImpl: (...args) => fetch(...args) };

function modIdFrom(param: unknown): string {
  if (typeof param !== 'string' || !MOD_ID.test(param)) throw new HttpError(404, 'mod_not_found');
  return param;
}

/** GET /api/me: usuário logado (ou null) e a chave pública do Turnstile que o formulário usa. */
export async function getMe(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  const user = await currentUser(env.DB, request, deps.now());
  const active = user?.status === 'active' ? user : null;
  return {
    response: json({
      user: active ? publicUser(active) : null,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? '',
    }),
    userId: active?.id,
  };
}

/** POST /api/auth/register: cria a conta com username + senha e já entra com uma sessão. */
export async function postRegister(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const body = await readJson(request);
  const now = deps.now();
  const ip = ipOf(request);
  // Cadastro conta a cota sempre: conta boa ou ruim, o que trava é o volume de spam.
  await throttleBudget(env.DB, 'register-ip', ip, REGISTER_LIMIT_PER_IP, now);
  await verifyTurnstile(field(body, 'turnstileToken'), ip, env.TURNSTILE_SECRET_KEY, deps.fetchImpl);
  const { username, key } = normalizeUsername(field(body, 'username'));
  const password = normalizePassword(field(body, 'password'));
  const hash = await hashPassword(password, iterationsFromEnv(env.PBKDF2_ITERATIONS));
  await recordAttempt(env.DB, 'register-ip', ip, now);
  const user = await registerUser(env.DB, username, key, hash, now);
  const cookie = await createSession(env.DB, user.id, now);
  return {
    response: json({ user: publicUser(user) }, { status: 201, headers: { 'Set-Cookie': cookie } }),
    userId: user.id,
  };
}

function loginKey(raw: unknown): string {
  // No login não se valida formato: qualquer coisa vira chave de busca, e a resposta é sempre a mesma.
  return typeof raw === 'string' ? raw.normalize('NFKC').trim().toLowerCase() : '';
}

function passwordCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return normalizePassword(raw);
  } catch {
    // Senha fora do padrão é só senha errada: resposta única, sem dica do que falhou.
    return null;
  }
}

/** POST /api/auth/login: usuário + senha + Turnstile. Conta inexistente e senha errada dão o mesmo erro. */
export async function postLogin(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const body = await readJson(request);
  const now = deps.now();
  const ip = ipOf(request);
  const usernameKey = loginKey(field(body, 'username'));
  const candidate = passwordCandidate(field(body, 'password'));
  await throttleBudget(env.DB, 'login-account', usernameKey, LOGIN_LIMIT_PER_ACCOUNT, now);
  await throttleBudget(env.DB, 'login-ip', ip, LOGIN_LIMIT_PER_IP, now);
  await verifyTurnstile(field(body, 'turnstileToken'), ip, env.TURNSTILE_SECRET_KEY, deps.fetchImpl);
  const user = usernameKey ? await findUserByUsernameKey(env.DB, usernameKey) : null;
  const verified =
    user !== null &&
    candidate !== null &&
    (await verifyPassword(candidate, user.passwordHash));
  if (!verified || user === null) {
    await recordAttempt(env.DB, 'login-account', usernameKey || 'vazio', now);
    await recordAttempt(env.DB, 'login-ip', ip, now);
    throw new HttpError(401, 'invalid_credentials');
  }
  if (user.status !== 'active') throw new HttpError(403, 'banned');
  const cookie = await createSession(env.DB, user.id, now);
  return {
    response: json({ user: publicUser(user) }, { headers: { 'Set-Cookie': cookie } }),
    userId: user.id,
  };
}

/** DELETE /api/session: sair. Apaga a sessão no banco, não só o cookie. */
export async function deleteSessionRoute(request: Request, env: Env): Promise<RouteResult> {
  requireSameOrigin(request);
  await deleteSession(env.DB, request);
  return { response: noContent({ 'Set-Cookie': clearSessionCookie() }) };
}

/** PUT /api/me/username: o username é login e nome público; a troca fica no histórico. */
export async function putUsername(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user = await requireUser(env.DB, request, now);
  const updated = await renameUsername(env.DB, user, field(await readJson(request), 'username'), now);
  return { response: json({ user: publicUser(updated) }), userId: user.id };
}

/** PUT /api/me/password: troca de senha revoga todas as sessões e re-emite a do navegador atual. */
export async function putPassword(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user: User = await requireUser(env.DB, request, now);
  const body = await readJson(request);
  const current = passwordCandidate(field(body, 'currentPassword'));
  const stored = await findUserByUsernameKey(env.DB, loginKey(user.username));
  const currentOk =
    current !== null && stored !== null && (await verifyPassword(current, stored.passwordHash));
  if (!currentOk) throw new HttpError(400, 'wrong_password');
  const next = normalizePassword(field(body, 'newPassword'));
  const hash = await hashPassword(next, iterationsFromEnv(env.PBKDF2_ITERATIONS));
  // A sessão nova só nasce DEPOIS de apagar as velhas, senão o próprio DELETE a mataria.
  await env.DB.batch([
    env.DB
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(hash, now.toISOString(), user.id),
    env.DB
      .prepare(
        "INSERT INTO user_events (user_id, actor_id, operation, created_at) VALUES (?, ?, 'password_change', ?)",
      )
      .bind(user.id, user.id, now.toISOString()),
    // Quem copiou o cookie antigo fica fora: a sessão atual é recriada com um token novo.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  const cookie = await createSession(env.DB, user.id, now);
  return {
    response: json({ user: publicUser(user) }, { headers: { 'Set-Cookie': cookie } }),
    userId: user.id,
  };
}

/** GET /api/me/ratings: as notas do usuário logado, por mod. */
export async function getMyRatings(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  const user = await requireUser(env.DB, request, deps.now());
  return { response: json({ ratings: await userRatings(env.DB, user.id) }), userId: user.id };
}

/** PUT /api/mods/:id/rating com { stars: 1..5 } */
export async function putRating(
  request: Request,
  env: Env,
  deps: Deps,
  param: unknown,
): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user = await requireUser(env.DB, request, now);
  const modId = modIdFrom(param);
  const stars = field(await readJson(request), 'stars');
  const mods = await catalogMods(env.CATALOG_URL ?? DEFAULT_CATALOG_URL, {
    fetchImpl: deps.fetchImpl,
    now: now.getTime(),
  });
  const saved = await setRating(env.DB, user, modId, stars, mods, now);
  return {
    response: json({ modId, stars: saved, stats: await modStats(env.DB, modId) }),
    userId: user.id,
  };
}

/** DELETE /api/mods/:id/rating; devolve a contagem e a média que ficaram. */
export async function deleteRating(
  request: Request,
  env: Env,
  deps: Deps,
  param: unknown,
): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user = await requireUser(env.DB, request, now);
  const modId = modIdFrom(param);
  await removeRating(env.DB, user, modId, now);
  return {
    response: json({ modId, stats: await modStats(env.DB, modId) }),
    userId: user.id,
  };
}

/** POST /api/submissions: valida, confere a posse, grava pending e publica no repo do catálogo. */
export async function postSubmission(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user = await requireUser(env.DB, request, now);
  const body = await readJson(request);
  const mods = await catalogMods(env.CATALOG_URL ?? DEFAULT_CATALOG_URL, {
    fetchImpl: deps.fetchImpl,
    now: now.getTime(),
  });
  return recordSubmission(env.DB, user, body, mods, now, (row) =>
    publishToGithub(env.GITHUB_TOKEN, deps.fetchImpl, row),
  );
}

/** GET /api/me/submissions: os envios do usuário; os pendentes com PR conferem o estado no GitHub. */
export async function getMySubmissions(
  request: Request,
  env: Env,
  deps: Deps,
): Promise<RouteResult> {
  const user = await requireUser(env.DB, request, deps.now());
  const rows = await env.DB
    .prepare(
      'SELECT id, mod_id, operation, status, pr_number, created_at, updated_at FROM submissions WHERE user_id = ? ORDER BY created_at DESC',
    )
    .bind(user.id)
    .all<{
      id: string;
      mod_id: string;
      operation: string;
      status: string;
      pr_number: number | null;
      created_at: string;
      updated_at: string;
    }>();
  const now = deps.now().toISOString();
  const submissions = [];
  for (const row of rows.results) {
    let status = row.status;
    if (row.status === 'pending' && row.pr_number) {
      const state = await pullRequestState(env.GITHUB_TOKEN, deps.fetchImpl, row.pr_number);
      if (state === 'merged' || state === 'closed') {
        // O PR já decidiu: mergeou entra no catálogo, fechado sem merge foi recusado.
        status = state === 'merged' ? 'merged' : 'rejected';
        await env.DB
          .prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?')
          .bind(status, now, row.id)
          .run();
      }
    }
    submissions.push({
      id: row.id,
      modId: row.mod_id,
      operation: row.operation,
      status,
      prNumber: row.pr_number,
      createdAt: row.created_at,
    });
  }
  return { response: json({ submissions }), userId: user.id };
}

/**
 * GET /api/stats: contagem e média de cada mod avaliado. A borda pode guardar por 60 s; o navegador sempre
 * revalida, senão quem acabou de avaliar veria a média antiga do próprio cache.
 */
export async function getStats(_request: Request, env: Env): Promise<RouteResult> {
  return {
    response: json(
      { mods: await ratingStats(env.DB) },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' } },
    ),
  };
}
