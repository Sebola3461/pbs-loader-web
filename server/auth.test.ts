import { beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_JWKS_URL, resetGoogleKeyCache, verifyGoogleIdToken } from './google';
import { HttpError } from './http';
import { randomToken, sha256Hex, uuidv7 } from './ids';
import { createSession, currentUser, deleteSession, requireUser, SESSION_COOKIE } from './sessions';
import { createGoogleIssuer, fakeFetch, TEST_CLIENT_ID } from './testing/google-tokens';
import { createTestDatabase } from './testing/sqlite-d1';
import { findOrCreateUser, normalizeNickname, publicUser, setNickname } from './users';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}

const jwksResponse =
  (keys: unknown[], cacheControl = 'public, max-age=600') =>
  () =>
    new Response(JSON.stringify({ keys }), { headers: { 'Cache-Control': cacheControl } });

describe('ids', () => {
  it('uuidv7 tem versão 7, variante RFC e começa pelo tempo', () => {
    const a = uuidv7(NOW);
    const b = uuidv7(later(1000));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13)).toBe(uuidv7(NOW).slice(0, 13));
  });

  it('token aleatório em base64url e sha256 em hex', async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('verifyGoogleIdToken', () => {
  beforeEach(() => resetGoogleKeyCache());

  it('aceita token válido e reaproveita as chaves em cache', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: jwksResponse([issuer.jwk]) });
    const token = await issuer.sign(issuer.validPayload(NOW));
    const options = { clientId: TEST_CLIENT_ID, now: NOW, fetchImpl: fetch.impl };
    expect(await verifyGoogleIdToken(token, options)).toEqual({ sub: '1234567890' });
    await verifyGoogleIdToken(token, options);
    expect(fetch.calls).toHaveLength(1);
  });

  it('busca as chaves de novo quando o cache vence ou aparece uma chave nova', async () => {
    const old = await createGoogleIssuer('velha');
    const fresh = await createGoogleIssuer('nova');
    let keys = [old.jwk];
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: () => jwksResponse(keys, 'max-age=60')() });
    await verifyGoogleIdToken(await old.sign(old.validPayload(NOW)), {
      clientId: TEST_CLIENT_ID,
      now: NOW,
      fetchImpl: fetch.impl,
    });
    keys = [old.jwk, fresh.jwk];
    await verifyGoogleIdToken(await fresh.sign(fresh.validPayload(NOW)), {
      clientId: TEST_CLIENT_ID,
      now: NOW,
      fetchImpl: fetch.impl,
    });
    expect(fetch.calls).toHaveLength(2);
    await verifyGoogleIdToken(await old.sign(old.validPayload(later(61_000))), {
      clientId: TEST_CLIENT_ID,
      now: later(61_000),
      fetchImpl: fetch.impl,
    });
    expect(fetch.calls).toHaveLength(3);
  });

  it('sem Cache-Control usa uma hora de cache', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: jwksResponse([issuer.jwk], '') });
    const options = (now: Date) => ({ clientId: TEST_CLIENT_ID, now, fetchImpl: fetch.impl });
    await verifyGoogleIdToken(await issuer.sign(issuer.validPayload(NOW)), options(NOW));
    const at = later(59 * 60 * 1000);
    await verifyGoogleIdToken(await issuer.sign(issuer.validPayload(at)), options(at));
    expect(fetch.calls).toHaveLength(1);
  });

  it('recusa assinatura de outra chave, kid desconhecido e algoritmo trocado', async () => {
    const google = await createGoogleIssuer();
    const attacker = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: jwksResponse([google.jwk]) });
    const options = { clientId: TEST_CLIENT_ID, now: NOW, fetchImpl: fetch.impl };
    await expectHttpError(
      verifyGoogleIdToken(await attacker.sign(attacker.validPayload(NOW)), options),
      401,
      'invalid_token',
    );
    await expectHttpError(
      verifyGoogleIdToken(await google.sign(google.validPayload(NOW), { kid: 'outra' }), options),
      401,
      'invalid_token',
    );
    await expectHttpError(
      verifyGoogleIdToken(await google.sign(google.validPayload(NOW), { alg: 'HS256' }), options),
      401,
      'invalid_token',
    );
  });

  it('recusa emissor, audiência, validade e sub errados', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: jwksResponse([issuer.jwk]) });
    const options = { clientId: TEST_CLIENT_ID, now: NOW, fetchImpl: fetch.impl };
    const s = NOW.getTime() / 1000;
    for (const overrides of [
      { iss: 'https://mal.com' },
      { aud: 'outro-cliente' },
      { exp: s - 120 },
      { exp: 'amanhã' },
      { iat: s + 600 },
      { sub: '' },
      { sub: 'x'.repeat(256) },
      { sub: 42 },
    ]) {
      const token = await issuer.sign(issuer.validPayload(NOW, overrides));
      await expectHttpError(verifyGoogleIdToken(token, options), 401, 'invalid_token');
    }
    const token = await issuer.sign(issuer.validPayload(NOW));
    await expectHttpError(
      verifyGoogleIdToken(token, { ...options, clientId: '' }),
      401,
      'invalid_token',
    );
  });

  it('recusa token malformado sem consultar o Google', async () => {
    const fetch = fakeFetch({});
    const options = { clientId: TEST_CLIENT_ID, now: NOW, fetchImpl: fetch.impl };
    for (const token of ['', 'a.b', 'a.b.c.d', '!!!.@@@.###', `${btoa('{"alg":"RS256"}')}.e30.x`]) {
      await expectHttpError(verifyGoogleIdToken(token, options), 401, 'invalid_token');
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it('assinatura que não é base64 válido é recusada', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: jwksResponse([issuer.jwk]) });
    const [head, body] = (await issuer.sign(issuer.validPayload(NOW))).split('.');
    await expectHttpError(
      verifyGoogleIdToken(`${head}.${body}.@@@`, {
        clientId: TEST_CLIENT_ID,
        now: NOW,
        fetchImpl: fetch.impl,
      }),
      401,
      'invalid_token',
    );
  });

  it('Google fora do ar vira 503, não 401', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: () => new Response('', { status: 500 }) });
    await expectHttpError(
      verifyGoogleIdToken(await issuer.sign(issuer.validPayload(NOW)), {
        clientId: TEST_CLIENT_ID,
        now: NOW,
        fetchImpl: fetch.impl,
      }),
      503,
      'google_unavailable',
    );
  });

  it('JWKS sem a lista de chaves', async () => {
    const issuer = await createGoogleIssuer();
    const fetch = fakeFetch({ [GOOGLE_JWKS_URL]: () => new Response('{}') });
    await expectHttpError(
      verifyGoogleIdToken(await issuer.sign(issuer.validPayload(NOW)), {
        clientId: TEST_CLIENT_ID,
        now: NOW,
        fetchImpl: fetch.impl,
      }),
      401,
      'invalid_token',
    );
  });
});

describe('usuários', () => {
  it('primeiro login cria o usuário e registra a criação; o segundo reaproveita', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    expect(user).toMatchObject({ nickname: null, role: 'user', status: 'active' });
    expect((await findOrCreateUser(db, 'sub-1', later(DAY))).id).toBe(user.id);
    const events = db.raw.prepare('SELECT user_id, actor_id, operation FROM user_events').all();
    expect(events).toEqual([{ user_id: user.id, actor_id: user.id, operation: 'create' }]);
    expect(publicUser(user)).toEqual({ id: user.id, nickname: null, role: 'user' });
  });

  it('dois logins simultâneos da mesma conta criam um usuário só', async () => {
    const db = createTestDatabase();
    const [a, b] = await Promise.all([
      findOrCreateUser(db, 'sub-1', NOW),
      findOrCreateUser(db, 'sub-1', NOW),
    ]);
    expect(a.id).toBe(b.id);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
  });

  it('valida o apelido', () => {
    expect(normalizeNickname('  Fulana_01 ')).toEqual({ nickname: 'Fulana_01', key: 'fulana_01' });
    expect(normalizeNickname('João Ônibus')).toEqual({
      nickname: 'João Ônibus',
      key: 'joão ônibus',
    });
    for (const bad of [
      null,
      7,
      'ab',
      'x'.repeat(25),
      '-fulana',
      'fulana.',
      'a  b',
      'fu<la>na',
      'a\nbc',
    ]) {
      expect(() => normalizeNickname(bad)).toThrow(HttpError);
    }
  });

  it('troca de apelido fica no histórico; apelido igual não grava nada', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const named = await setNickname(db, user, 'Fulana', NOW);
    expect(named.nickname).toBe('Fulana');
    await setNickname(db, named, 'Fulana', NOW);
    await setNickname(db, named, 'Fulana Silva', later(DAY));
    const events = db.raw
      .prepare("SELECT detail FROM user_events WHERE operation = 'rename' ORDER BY id")
      .all();
    expect(events).toEqual([
      { detail: JSON.stringify({ from: null, to: 'Fulana' }) },
      { detail: JSON.stringify({ from: 'Fulana', to: 'Fulana Silva' }) },
    ]);
  });

  it('apelido já usado, mesmo com outra caixa, dá 409 e não grava evento', async () => {
    const db = createTestDatabase();
    await setNickname(db, await findOrCreateUser(db, 'sub-1', NOW), 'Fulana', NOW);
    const other = await findOrCreateUser(db, 'sub-2', NOW);
    await expectHttpError(setNickname(db, other, 'FULANA', NOW), 409, 'nickname_taken');
    expect(
      db.raw.prepare("SELECT COUNT(*) n FROM user_events WHERE operation = 'rename'").get(),
    ).toEqual({ n: 1 });
  });
});

describe('sessões', () => {
  const withCookie = (cookie: string) =>
    new Request('https://site.test/', { headers: { Cookie: cookie.split(';')[0] } });

  it('cria a sessão com cookie seguro e guarda só o hash do token', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const cookie = await createSession(db, user.id, NOW);
    expect(cookie).toMatch(
      new RegExp(
        `^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$`,
      ),
    );
    const token = cookie.split(';')[0].split('=')[1];
    const row = db.raw.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    expect(row.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(db.raw.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    expect(await currentUser(db, withCookie(cookie), NOW)).toMatchObject({ id: user.id });
  });

  it('sem cookie, cookie vazio ou token desconhecido não há usuário', async () => {
    const db = createTestDatabase();
    expect(await currentUser(db, new Request('https://site.test/'), NOW)).toBeNull();
    expect(await currentUser(db, withCookie(`${SESSION_COOKIE}=`), NOW)).toBeNull();
    expect(await currentUser(db, withCookie(`outro=1; ${SESSION_COOKIE}=nada`), NOW)).toBeNull();
    await expectHttpError(
      requireUser(db, new Request('https://site.test/'), NOW),
      401,
      'login_required',
    );
  });

  it('cai depois de 30 dias parado e de 90 dias no total', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const cookie = await createSession(db, user.id, NOW);
    expect(await currentUser(db, withCookie(cookie), later(29 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(58 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(87 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(90 * DAY))).toBeNull();

    const idle = await createSession(db, user.id, NOW);
    expect(await currentUser(db, withCookie(idle), later(31 * DAY))).toBeNull();
  });

  it('só regrava o último uso uma vez por dia', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const cookie = await createSession(db, user.id, NOW);
    const lastSeen = () =>
      (db.raw.prepare('SELECT last_seen_at FROM sessions').get() as { last_seen_at: string })
        .last_seen_at;
    await currentUser(db, withCookie(cookie), later(60_000));
    expect(lastSeen()).toBe(NOW.toISOString());
    await currentUser(db, withCookie(cookie), later(DAY + 1));
    expect(lastSeen()).toBe(later(DAY + 1).toISOString());
  });

  it('banido recebe 403 na hora, mesmo com sessão', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const cookie = await createSession(db, user.id, NOW);
    db.raw.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(user.id);
    await expectHttpError(requireUser(db, withCookie(cookie), NOW), 403, 'banned');
  });

  it('sair apaga a sessão no banco; criar sessão limpa as vencidas', async () => {
    const db = createTestDatabase();
    const user = await findOrCreateUser(db, 'sub-1', NOW);
    const cookie = await createSession(db, user.id, NOW);
    await deleteSession(db, withCookie(cookie));
    expect(await currentUser(db, withCookie(cookie), NOW)).toBeNull();
    await deleteSession(db, new Request('https://site.test/'));

    await createSession(db, user.id, NOW);
    await createSession(db, user.id, later(91 * DAY));
    expect(db.raw.prepare('SELECT COUNT(*) n FROM sessions').get()).toEqual({ n: 1 });
  });
});
