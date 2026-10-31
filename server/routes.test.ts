import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCatalogCache } from './catalog';
import { Env } from './db';
import { GOOGLE_JWKS_URL, resetGoogleKeyCache } from './google';
import { json, readJson, requireSameOrigin, runRoute } from './http';
import {
  deleteRating,
  deleteSessionRoute,
  Deps,
  getMe,
  getMyRatings,
  getStats,
  postSession,
  putNickname,
  putRating,
} from './routes';
import { createGoogleIssuer, fakeFetch, TEST_CLIENT_ID } from './testing/google-tokens';
import { createTestDatabase } from './testing/sqlite-d1';

const ORIGIN = 'https://mods.test';
const CATALOG_URL = 'https://catalogo.test/c.json';
const NOW = new Date('2026-10-30T12:00:00.000Z');

function request(
  method: string,
  path: string,
  {
    body,
    cookie,
    origin = ORIGIN,
    contentType = 'application/json',
  }: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    contentType?: string;
  } = {},
) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', contentType);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function setup() {
  resetGoogleKeyCache();
  resetCatalogCache();
  const issuer = await createGoogleIssuer();
  const db = createTestDatabase();
  const env: Env = { DB: db, GOOGLE_CLIENT_ID: TEST_CLIENT_ID, CATALOG_URL };
  let ownerId = '';
  const fetch = fakeFetch({
    [GOOGLE_JWKS_URL]: () => new Response(JSON.stringify({ keys: [issuer.jwk] })),
    [CATALOG_URL]: () =>
      new Response(
        JSON.stringify({
          mods: [
            { id: 'Painel', dono: { github: 'fulana' } },
            { id: 'Meu', dono: { site: ownerId } },
          ],
        }),
      ),
  });
  const deps: Deps = { now: () => NOW, fetchImpl: fetch.impl };

  async function login(sub = 'sub-ana') {
    const credential = await issuer.sign(issuer.validPayload(NOW, { sub }));
    const { response } = await postSession(
      request('POST', '/api/session', { body: { credential } }),
      env,
      deps,
    );
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const { user } = (await response.json()) as { user: { id: string } };
    return { cookie, userId: user.id };
  }

  return { env, deps, db, issuer, login, setOwner: (id: string) => (ownerId = id) };
}

const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('http', () => {
  it('json com no-store por padrão, e cabeçalho próprio quando dado', async () => {
    const plain = json({ a: 1 });
    expect(plain.headers.get('Cache-Control')).toBe('no-store');
    expect(plain.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(json({}, { headers: { 'Cache-Control': 'public' } }).headers.get('Cache-Control')).toBe(
      'public',
    );
  });

  it('origem diferente ou ausente é recusada', () => {
    expect(() => requireSameOrigin(request('POST', '/x', { origin: 'https://mal.com' }))).toThrow(
      'bad_origin',
    );
    expect(() => requireSameOrigin(request('POST', '/x', { origin: null }))).toThrow('bad_origin');
    expect(() => requireSameOrigin(request('POST', '/x'))).not.toThrow();
  });

  it('corpo precisa ser JSON pequeno e válido', async () => {
    await expect(
      readJson(
        request('POST', '/x', { body: 'a=1', contentType: 'application/x-www-form-urlencoded' }),
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(readJson(request('POST', '/x', { body: '{' }))).rejects.toMatchObject({
      status: 400,
      code: 'invalid_json',
    });
    await expect(
      readJson(request('POST', '/x', { body: { x: 'a'.repeat(9000) } })),
    ).rejects.toMatchObject({ status: 413 });
    expect(await readJson(request('POST', '/x', { body: { ok: true } }))).toEqual({ ok: true });
  });

  it('runRoute transforma erros e loga uma linha por requisição', async () => {
    const lines: string[] = [];
    const req = new Request(`${ORIGIN}/x`, { headers: { 'cf-ray': 'abc' } });
    const ok = await runRoute(
      'GET /x',
      req,
      async () => ({ response: json({}), userId: 'u1' }),
      (l) => lines.push(l),
    );
    expect(ok.status).toBe(200);
    const boom = await runRoute(
      'GET /x',
      req,
      async () => {
        throw new Error('db caiu em 10.0.0.1');
      },
      (l) => lines.push(l),
    );
    expect(boom.status).toBe(500);
    expect(await body(boom)).toEqual({ error: 'internal_error' });
    const weird = await runRoute(
      'GET /x',
      req,
      async () => {
        throw 'texto';
      },
      (l) => lines.push(l),
    );
    expect(weird.status).toBe(500);
    expect(lines.map((l) => JSON.parse(l))).toMatchObject([
      { route: 'GET /x', status: 200, user: 'u1', ray: 'abc' },
      { status: 500, user: null, error: 'Error: db caiu em 10.0.0.1' },
      { status: 500, error: 'texto' },
    ]);
  });

  it('runRoute usa console.log por padrão', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runRoute('GET /x', new Request(`${ORIGIN}/x`), async () => ({ response: json({}) }));
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('rotas', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('login, /me, apelido e sair', async () => {
    const { env, deps, login } = await setup();
    const anonymous = await getMe(request('GET', '/api/me'), env, deps);
    expect(await body(anonymous.response)).toEqual({ user: null, googleClientId: TEST_CLIENT_ID });

    const { cookie, userId } = await login();
    expect(cookie).toMatch(/^__Host-pbs_session=/);
    const me = await getMe(request('GET', '/api/me', { cookie }), env, deps);
    expect(await body(me.response)).toMatchObject({
      user: { id: userId, nickname: null, role: 'user' },
    });

    const renamed = await putNickname(
      request('PUT', '/api/me/nickname', { cookie, body: { nickname: 'Ana' } }),
      env,
      deps,
    );
    expect(await body(renamed.response)).toMatchObject({ user: { nickname: 'Ana' } });

    const out = await deleteSessionRoute(request('DELETE', '/api/session', { cookie }), env);
    expect(out.response.status).toBe(204);
    expect(out.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const after = await getMe(request('GET', '/api/me', { cookie }), env, deps);
    expect(await body(after.response)).toMatchObject({ user: null });
  });

  it('login de outra origem ou sem credencial é recusado', async () => {
    const { env, deps } = await setup();
    await expect(
      postSession(
        request('POST', '/api/session', { origin: 'https://mal.com', body: { credential: 'x' } }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      postSession(request('POST', '/api/session', { body: { credential: 7 } }), env, deps),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_token' });
    await expect(
      postSession(request('POST', '/api/session', { body: null }), env, deps),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      postSession(request('POST', '/api/session', { body: { credential: 'a.b.c' } }), env, deps),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('banido não entra nem aparece logado', async () => {
    const { env, deps, db, login } = await setup();
    const { cookie, userId } = await login();
    db.raw.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(userId);
    await expect(login()).rejects.toMatchObject({ status: 403, code: 'banned' });
    const me = await getMe(request('GET', '/api/me', { cookie }), env, deps);
    expect(await body(me.response)).toMatchObject({ user: null });
  });

  it('avaliar, ver as próprias notas, estatísticas e tirar a nota', async () => {
    const { env, deps, login } = await setup();
    const ana = await login('sub-ana');
    const bia = await login('sub-bia');
    await putRating(
      request('PUT', '/api/mods/Painel/rating', { cookie: ana.cookie, body: { stars: 5 } }),
      env,
      deps,
      'Painel',
    );
    const saved = await putRating(
      request('PUT', '/api/mods/Painel/rating', { cookie: bia.cookie, body: { stars: 4 } }),
      env,
      deps,
      'Painel',
    );
    expect(await body(saved.response)).toEqual({
      modId: 'Painel',
      stars: 4,
      stats: { count: 2, average: 4.5 },
    });

    const mine = await getMyRatings(
      request('GET', '/api/me/ratings', { cookie: ana.cookie }),
      env,
      deps,
    );
    expect(await body(mine.response)).toEqual({ ratings: { Painel: 5 } });

    const stats = await getStats(request('GET', '/api/stats'), env);
    expect(stats.response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60');
    expect(await body(stats.response)).toEqual({ mods: { Painel: { count: 2, average: 4.5 } } });

    const removed = await deleteRating(
      request('DELETE', '/api/mods/Painel/rating', { cookie: ana.cookie }),
      env,
      deps,
      'Painel',
    );
    expect(await body(removed.response)).toEqual({
      modId: 'Painel',
      stats: { count: 1, average: 4 },
    });
    expect(await body((await getStats(request('GET', '/api/stats'), env)).response)).toEqual({
      mods: { Painel: { count: 1, average: 4 } },
    });

    const last = await deleteRating(
      request('DELETE', '/api/mods/Painel/rating', { cookie: bia.cookie }),
      env,
      deps,
      'Painel',
    );
    expect(await body(last.response)).toEqual({ modId: 'Painel', stats: null });
  });

  it('avaliar exige login, origem do site, id válido e mod de outra pessoa', async () => {
    const { env, deps, login, setOwner } = await setup();
    const ana = await login();
    setOwner(ana.userId);
    const put = (opts: Parameters<typeof request>[2], id: unknown = 'Painel') =>
      putRating(request('PUT', '/api/mods/x/rating', opts), env, deps, id);
    await expect(put({ body: { stars: 3 } })).rejects.toMatchObject({ status: 401 });
    await expect(
      put({ cookie: ana.cookie, origin: 'https://mal.com', body: { stars: 3 } }),
    ).rejects.toMatchObject({ status: 403, code: 'bad_origin' });
    await expect(put({ cookie: ana.cookie, body: { stars: 3 } }, '../x')).rejects.toMatchObject({
      status: 404,
    });
    await expect(put({ cookie: ana.cookie, body: { stars: 3 } }, ['x'])).rejects.toMatchObject({
      status: 404,
    });
    await expect(put({ cookie: ana.cookie, body: { stars: 3 } }, 'Meu')).rejects.toMatchObject({
      status: 403,
      code: 'own_mod',
    });
    await expect(
      put({ cookie: ana.cookie, body: 'stars=3', contentType: 'text/plain' }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      deleteRating(request('DELETE', '/x', { cookie: ana.cookie }), env, deps, 'a b'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getMyRatings(request('GET', '/api/me/ratings'), env, deps)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('apelido inválido ou repetido', async () => {
    const { env, deps, login } = await setup();
    const ana = await login('sub-ana');
    const bia = await login('sub-bia');
    await putNickname(
      request('PUT', '/api/me/nickname', { cookie: ana.cookie, body: { nickname: 'Ana' } }),
      env,
      deps,
    );
    await expect(
      putNickname(
        request('PUT', '/api/me/nickname', { cookie: bia.cookie, body: { nickname: 'ana' } }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      putNickname(
        request('PUT', '/api/me/nickname', { cookie: bia.cookie, body: { nickname: 'x' } }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      putNickname(request('PUT', '/api/me/nickname', { cookie: bia.cookie, body: [] }), env, deps),
    ).rejects.toMatchObject({ status: 400 });
  });
});
