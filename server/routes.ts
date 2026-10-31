import { catalogMods, DEFAULT_CATALOG_URL } from './catalog';
import { Env } from './db';
import { verifyGoogleIdToken } from './google';
import { HttpError, json, noContent, readJson, requireSameOrigin, RouteResult } from './http';
import { modStats, ratingStats, removeRating, setRating, userRatings } from './ratings';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  deleteSession,
  requireUser,
} from './sessions';
import { findOrCreateUser, publicUser, setNickname } from './users';

/** O que varia entre produção e teste: o relógio e o fetch para o Google e o catálogo. */
export interface Deps {
  now: () => Date;
  fetchImpl: typeof fetch;
}

export const defaultDeps: Deps = { now: () => new Date(), fetchImpl: (...args) => fetch(...args) };

const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

function field(body: unknown, name: string): unknown {
  return body !== null && typeof body === 'object'
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

function modIdFrom(param: unknown): string {
  if (typeof param !== 'string' || !MOD_ID.test(param)) throw new HttpError(404, 'mod_not_found');
  return param;
}

/** GET /api/me: usuário logado (ou null) e o client ID do Google que o botão de login usa. */
export async function getMe(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  const user = await currentUser(env.DB, request, deps.now());
  const active = user?.status === 'active' ? user : null;
  return {
    response: json({
      user: active ? publicUser(active) : null,
      googleClientId: env.GOOGLE_CLIENT_ID,
    }),
    userId: active?.id,
  };
}

/** POST /api/session: troca o ID token do Google por uma sessão. */
export async function postSession(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const credential = field(await readJson(request), 'credential');
  if (typeof credential !== 'string' || credential.length > 4096)
    throw new HttpError(400, 'invalid_token');
  const now = deps.now();
  const { sub } = await verifyGoogleIdToken(credential, {
    clientId: env.GOOGLE_CLIENT_ID,
    now,
    fetchImpl: deps.fetchImpl,
  });
  const user = await findOrCreateUser(env.DB, sub, now);
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

/** PUT /api/me/nickname */
export async function putNickname(request: Request, env: Env, deps: Deps): Promise<RouteResult> {
  requireSameOrigin(request);
  const now = deps.now();
  const user = await requireUser(env.DB, request, now);
  const updated = await setNickname(env.DB, user, field(await readJson(request), 'nickname'), now);
  return { response: json({ user: publicUser(updated) }), userId: user.id };
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
