import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCatalogCache } from './catalog';
import { Env } from './db';
import { json, readJson, requireSameOrigin, runRoute } from './http';
import {
  deleteRating,
  deleteSessionRoute,
  Deps,
  getMe,
  getMyRatings,
  getStats,
  postLogin,
  postRegister,
  putPassword,
  putRating,
  putUsername,
} from './routes';
import { TURNSTILE_VERIFY_URL } from './turnstile';
import { fakeFetch } from './testing/http';
import { createTestDatabase } from './testing/sqlite-d1';

const ORIGIN = 'https://mods.test';
const CATALOG_URL = 'https://catalogo.test/c.json';
const NOW = new Date('2026-10-30T12:00:00.000Z');
const SITE_KEY = 'chave-publica-do-turnstile';
const SECRET = 'chave-secreta-do-turnstile';
const SENHA = 'senha-forte-1';

function request(
  method: string,
  path: string,
  {
    body,
    cookie,
    origin = ORIGIN,
    contentType = 'application/json',
    ip = '203.0.113.1',
  }: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    contentType?: string;
    ip?: string | null;
  } = {},
) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (ip) headers.set('CF-Connecting-IP', ip);
  if (body !== undefined) headers.set('Content-Type', contentType);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function setup() {
  resetCatalogCache();
  const db = createTestDatabase();
  const env: Env = {
    DB: db,
    CATALOG_URL,
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
    // Itens baixos só nos testes: 600 mil iterações de verdade deixam a suíte lenta demais.
    PBKDF2_ITERATIONS: '10000',
  };
  let ownerId = '';
  let registrations = 0;
  const fetch = fakeFetch({
    [TURNSTILE_VERIFY_URL]: () => new Response('{"success": true}'),
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

  /** Cadastro com IP próprio por conta, para o throttle de cadastro não atrapalhar os testes. */
  async function register(username = 'Ana', password = SENHA, ip?: string) {
    const usedIp = ip ?? `203.0.113.${++registrations}`;
    const { response } = await postRegister(
      request('POST', '/api/auth/register', {
        body: { username, password, turnstileToken: 'tok' },
        ip: usedIp,
      }),
      env,
      deps,
    );
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const { user } = (await response.json()) as { user: { id: string; username: string } };
    return { cookie, userId: user.id, username: user.username };
  }

  async function login(username = 'Ana', password = SENHA, ip = '203.0.113.99') {
    const { response } = await postLogin(
      request('POST', '/api/auth/login', {
        body: { username, password, turnstileToken: 'tok' },
        ip,
      }),
      env,
      deps,
    );
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const { user } = (await response.json()) as { user: { id: string; username: string } };
    return { cookie, userId: user.id };
  }

  return { env, deps, db, fetch, register, login, setOwner: (id: string) => (ownerId = id) };
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

  it('cadastro, /me, troca de nome e sair', async () => {
    const { env, deps, register } = await setup();
    const anonymous = await getMe(request('GET', '/api/me'), env, deps);
    expect(await body(anonymous.response)).toEqual({ user: null, turnstileSiteKey: SITE_KEY });

    const { cookie, userId } = await register('Ana');
    expect(cookie).toMatch(/^__Host-pbs_session=/);
    const me = await getMe(request('GET', '/api/me', { cookie }), env, deps);
    expect(await body(me.response)).toMatchObject({
      user: { id: userId, username: 'Ana', role: 'user' },
    });

    const renamed = await putUsername(
      request('PUT', '/api/me/username', { cookie, body: { username: 'Ana Silva' } }),
      env,
      deps,
    );
    expect(await body(renamed.response)).toMatchObject({ user: { username: 'Ana Silva' } });

    const out = await deleteSessionRoute(request('DELETE', '/api/session', { cookie }), env);
    expect(out.response.status).toBe(204);
    expect(out.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const after = await getMe(request('GET', '/api/me', { cookie }), env, deps);
    expect(await body(after.response)).toMatchObject({ user: null });
  });

  it('cadastro exige origem própria, captcha, nome e senha decentes', async () => {
    const { env, deps, register } = await setup();
    await expect(
      postRegister(
        request('POST', '/api/auth/register', {
          origin: 'https://mal.com',
          body: { username: 'Ana', password: SENHA, turnstileToken: 'tok' },
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'bad_origin' });
    await expect(
      postRegister(
        request('POST', '/api/auth/register', {
          body: { username: 'Ana', password: SENHA, turnstileToken: '  ' },
          ip: '203.0.113.50',
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'captcha_required' });
    await expect(
      postRegister(
        request('POST', '/api/auth/register', {
          body: { username: 'x', password: SENHA, turnstileToken: 'tok' },
          ip: '203.0.113.51',
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_username' });
    await expect(
      postRegister(
        request('POST', '/api/auth/register', {
          body: { username: 'Curta', password: 'curta12', turnstileToken: 'tok' },
          ip: '203.0.113.52',
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_password' });
    await register('Ana');
    await expect(
      postRegister(
        request('POST', '/api/auth/register', {
          body: { username: 'ana', password: SENHA, turnstileToken: 'tok' },
          ip: '203.0.113.53',
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'username_taken' });
    await expect(
      postRegister(
        request('POST', '/api/auth/register', { body: null, ip: '203.0.113.54' }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('login: conta inexistente e senha errada dão o mesmo erro; Turnstile vencido dá 400', async () => {
    const { env, deps, fetch, register } = await setup();
    await register('Ana');
    const wrong = await postLogin(
      request('POST', '/api/auth/login', {
        body: { username: 'Ana', password: 'senha-errada', turnstileToken: 'tok' },
      }),
      env,
      deps,
    ).catch((e) => e);
    const unknown = await postLogin(
      request('POST', '/api/auth/login', {
        body: { username: 'Ninguem', password: 'senha-errada', turnstileToken: 'tok' },
      }),
      env,
      deps,
    ).catch((e) => e);
    expect(wrong).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(unknown).toMatchObject({ status: 401, code: 'invalid_credentials' });
    // O Turnstile foi chamado por todas as tentativas (cadastro + 2 logins).
    expect(fetch.calls.filter((call) => call.url === TURNSTILE_VERIFY_URL)).toHaveLength(3);

    const captchaOff = fakeFetch({ [TURNSTILE_VERIFY_URL]: () => new Response('{"success":false}') });
    await expect(
      postLogin(
        request('POST', '/api/auth/login', {
          body: { username: 'Ana', password: SENHA, turnstileToken: 'tok' },
        }),
        { ...env, TURNSTILE_SECRET_KEY: SECRET },
        { now: () => NOW, fetchImpl: captchaOff.impl },
      ),
    ).rejects.toMatchObject({ status: 400, code: 'captcha_invalid' });
    expect(fetch.calls.every((call) => call.url === TURNSTILE_VERIFY_URL || call.url === CATALOG_URL))
      .toBe(true);
  });

  it('banido não entra e a sessão dele morre na hora', async () => {
    const { env, deps, db, register } = await setup();
    const ana = await register('Ana');
    db.raw.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(ana.userId);
    await expect(
      postLogin(
        request('POST', '/api/auth/login', {
          body: { username: 'Ana', password: SENHA, turnstileToken: 'tok' },
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'banned' });
    const me = await getMe(request('GET', '/api/me', { cookie: ana.cookie }), env, deps);
    expect(await body(me.response)).toMatchObject({ user: null });
  });

  it('força bruta na mesma conta trava na 11ª tentativa', async () => {
    const { env, deps, register } = await setup();
    await register('Ana');
    const attempt = () =>
      postLogin(
        request('POST', '/api/auth/login', {
          body: { username: 'Ana', password: 'errada-de-verdade', turnstileToken: 'tok' },
        }),
        env,
        deps,
      );
    for (let i = 0; i < 10; i++) await expect(attempt()).rejects.toMatchObject({ status: 401 });
    await expect(attempt()).rejects.toMatchObject({ status: 429, code: 'too_many_attempts' });
    // Outra conta, outro limite: não herda a trava.
    await register('Bia');
    await expect(
      postLogin(
        request('POST', '/api/auth/login', {
          body: { username: 'Bia', password: SENHA, turnstileToken: 'tok' },
        }),
        env,
        deps,
      ),
    ).resolves.toMatchObject({ response: expect.any(Response) });
  });

  it('troca de senha: atual errada dá 400; certa revoga as sessões antigas', async () => {
    const { env, deps, register } = await setup();
    const ana = await register('Ana');
    await expect(
      putPassword(
        request('PUT', '/api/me/password', {
          cookie: ana.cookie,
          body: { currentPassword: 'errada-total', newPassword: 'nova-forte-99' },
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'wrong_password' });
    await expect(
      putPassword(
        request('PUT', '/api/me/password', {
          cookie: ana.cookie,
          body: { currentPassword: SENHA, newPassword: 'curta' },
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_password' });

    const changed = await putPassword(
      request('PUT', '/api/me/password', {
        cookie: ana.cookie,
        body: { currentPassword: SENHA, newPassword: 'nova-forte-99' },
      }),
      env,
      deps,
    );
    const newCookie = changed.response.headers.get('Set-Cookie')!.split(';')[0];
    expect(newCookie).toMatch(/^__Host-pbs_session=/);
    // A sessão antiga morreu; a nova está viva.
    const oldMe = await getMe(request('GET', '/api/me', { cookie: ana.cookie }), env, deps);
    expect(await body(oldMe.response)).toMatchObject({ user: null });
    const newMe = await getMe(request('GET', '/api/me', { cookie: newCookie }), env, deps);
    expect(await body(newMe.response)).toMatchObject({ user: { username: 'Ana' } });
    // Evento registrado.
    // (o histórico é conferido em auth.test.ts)
  });

  it('login com a senha antiga depois da troca falha; com a nova funciona', async () => {
    const { env, deps, register } = await setup();
    const ana = await register('Ana');
    await putPassword(
      request('PUT', '/api/me/password', {
        cookie: ana.cookie,
        body: { currentPassword: SENHA, newPassword: 'nova-forte-99' },
      }),
      env,
      deps,
    );
    await expect(
      postLogin(
        request('POST', '/api/auth/login', {
          body: { username: 'ana', password: SENHA, turnstileToken: 'tok' },
        }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    const ok = await postLogin(
      request('POST', '/api/auth/login', {
        body: { username: 'ana', password: 'nova-forte-99', turnstileToken: 'tok' },
      }),
      env,
      deps,
    );
    expect(ok.response.status).toBe(200);
  });

  it('avaliar, ver as próprias notas, estatísticas e tirar a nota', async () => {
    const { env, deps, register } = await setup();
    const ana = await register('Ana');
    const bia = await register('Bia');
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
    const { env, deps, register, setOwner } = await setup();
    const ana = await register('Ana');
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

  it('username inválido, repetido ou igual ao atual', async () => {
    const { env, deps, register } = await setup();
    const ana = await register('Ana');
    const bia = await register('Bia');
    await putUsername(
      request('PUT', '/api/me/username', { cookie: ana.cookie, body: { username: 'Ana Silva' } }),
      env,
      deps,
    );
    await expect(
      putUsername(
        request('PUT', '/api/me/username', { cookie: bia.cookie, body: { username: 'ana silva' } }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      putUsername(
        request('PUT', '/api/me/username', { cookie: bia.cookie, body: { username: 'x' } }),
        env,
        deps,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      putUsername(request('PUT', '/api/me/username', { cookie: bia.cookie, body: [] }), env, deps),
    ).rejects.toMatchObject({ status: 400 });
    // Mesmo nome, sem mudança: 200 e nada gravado.
    await expect(
      putUsername(
        request('PUT', '/api/me/username', { cookie: bia.cookie, body: { username: 'Bia' } }),
        env,
        deps,
      ),
    ).resolves.toMatchObject({ response: expect.any(Response) });
  });
});
