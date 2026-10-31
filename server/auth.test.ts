import { beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from './http';
import { randomToken, sha256Hex, uuidv7 } from './ids';
import {
  DEFAULT_ITERATIONS,
  DUMMY_HASH,
  hashPassword,
  iterationsFromEnv,
  normalizePassword,
  verifyPassword,
} from './password';
import {
  LOGIN_LIMIT_PER_ACCOUNT,
  LOGIN_LIMIT_PER_IP,
  REGISTER_LIMIT_PER_IP,
  attemptWindow,
  recordAttempt,
  throttleBudget,
} from './throttle';
import { TURNSTILE_VERIFY_URL, verifyTurnstile } from './turnstile';
import { createSession, currentUser, deleteSession, requireUser, SESSION_COOKIE } from './sessions';
import {
  findUserByUsernameKey,
  normalizeUsername,
  publicUser,
  registerUser,
  renameUsername,
} from './users';
import { createTestDatabase } from './testing/sqlite-d1';
import { fakeFetch } from './testing/http';

const NOW = new Date('2026-10-30T12:00:00.000Z');
/** Hash falsa com cara de verdade: comprimento certo para o CHECK do banco e parseável pelo verificador. */
const FAKE_HASH =
  'pbkdf2$sha256$10000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}

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

describe('senha', () => {
  it('hash no formato auto-descritivo e verificação redonda', async () => {
    const hash = await hashPassword('abcd1234', 10_000);
    expect(hash).toMatch(/^pbkdf2\$sha256\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('abcd1234', hash)).toBe(true);
    expect(await verifyPassword('abcd12345', hash)).toBe(false);
  });

  it('a hash guarda as iterações que o login precisa repetir', async () => {
    expect(await verifyPassword('abcd1234', await hashPassword('abcd1234', 100_000))).toBe(true);
    expect(await verifyPassword('abcd1234', await hashPassword('abcd1234', 601_000))).toBe(true);
  });

  it('hash malformado em qualquer pedaço é recusado, não explode', async () => {
    const hash = await hashPassword('abcd1234', 10_000);
    for (const bad of [
      '',
      'md5$sha256$1$a$b',
      'pbkdf2$sha1$10000$a$a',
      'pbkdf2$sha256$0$a$a',
      'pbkdf2$sha256$não-numérico$a$a',
      'pbkdf2$sha256$20000000$a$a',
      'pbkdf2$sha256$10000$%%%$???',
      `${hash}$extra`,
    ])
      expect(await verifyPassword('abcd1234', bad)).toBe(false);
    // A genuína continua valendo depois de tantas recusas.
    expect(await verifyPassword('abcd1234', hash)).toBe(true);
  });

  it('hash fictícia parseia e falha, para o login gastar tempo de conta inexistente', async () => {
    expect(DUMMY_HASH.startsWith('pbkdf2$sha256$')).toBe(true);
    expect(await verifyPassword('qualquer-senha-aqui', DUMMY_HASH)).toBe(false);
  });

  it('normaliza NFKC e conta pontos de código, não unidades UTF-16', () => {
    expect(normalizePassword('abcdef\uFDFA')).toBe('abcdef\uFDFA'.normalize('NFKC'));
    // Emoji sem decomposição: 8 pontos de código ocupam 16 unidades UTF-16.
    const eightEmojis = '😀'.repeat(8);
    expect(Array.from(normalizePassword(eightEmojis)).length).toBe(8);
    // 7 pontos, ainda que 14 unidades UTF-16: recusado.
    expect(() => normalizePassword('😀'.repeat(7))).toThrow(HttpError);
    expect(normalizePassword('x'.repeat(8))).toBe('x'.repeat(8));
    expect(normalizePassword('x'.repeat(128))).toBe('x'.repeat(128));
    for (const bad of [null, 7, {}, 'x'.repeat(7), 'x'.repeat(129)]) {
      expect(() => normalizePassword(bad)).toThrow(HttpError);
    }
  });

  it('iterationsFromEnv aceita a faixa plausível e usa o padrão fora dela', () => {
    expect(iterationsFromEnv(undefined)).toBe(DEFAULT_ITERATIONS);
    expect(iterationsFromEnv('100000')).toBe(100_000);
    for (const bad of ['', 'abc', '9999', '10000001', '-1', '1.5']) {
      expect(iterationsFromEnv(bad)).toBe(DEFAULT_ITERATIONS);
    }
  });
});

describe('turnstile', () => {
  const ip = '203.0.113.7';

  it('token ausente ou longo demais não chega ao Cloudflare', async () => {
    const fetch = fakeFetch({});
    for (const token of [undefined, null, '', 'x'.repeat(2049)]) {
      await expectHttpError(
        verifyTurnstile(token, ip, 'segredo', fetch.impl),
        400,
        'captcha_required',
      );
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it('sem chave secreta configurada falha fechado com 503', async () => {
    const fetch = fakeFetch({});
    await expectHttpError(verifyTurnstile('tok', ip, undefined, fetch.impl), 503, 'captcha_unavailable');
    expect(fetch.calls).toHaveLength(0);
  });

  it('confirma com o Cloudflare e aceita o sucesso', async () => {
    const fetch = fakeFetch({ [TURNSTILE_VERIFY_URL]: () => new Response('{"success": true}') });
    await verifyTurnstile('tok', ip, 'segredo', fetch.impl);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].method).toBe('POST');
    const form = await fetch.calls[0].request.text();
    expect(form).toContain('secret=segredo');
    expect(form).toContain('response=tok');
    expect(form).toContain(`remoteip=${ip}`);
  });

  it('token rejeitado é 400; Cloudflare fora do ar e rede caída são 503', async () => {
    const refusing = fakeFetch({
      [TURNSTILE_VERIFY_URL]: () => new Response('{"success": false, "error-codes": ["bad"]}'),
    });
    await expectHttpError(verifyTurnstile('tok', ip, 'segredo', refusing.impl), 400, 'captcha_invalid');

    const down = fakeFetch({ [TURNSTILE_VERIFY_URL]: () => new Response('ops', { status: 500 }) });
    await expectHttpError(verifyTurnstile('tok', ip, 'segredo', down.impl), 503, 'captcha_unavailable');

    const dead = fakeFetch({});
    await expectHttpError(verifyTurnstile('tok', ip, 'segredo', dead.impl), 503, 'captcha_unavailable');
    expect(dead.calls).toHaveLength(1);
  });
});

describe('throttle', () => {
  let db: ReturnType<typeof createTestDatabase>;

  beforeEach(() => {
    db = createTestDatabase();
  });

  it('janela é o início da hora corrente', () => {
    expect(attemptWindow(NOW)).toBe('2026-10-30T12:00:00.000Z');
    expect(attemptWindow(new Date('2026-10-30T12:59:59.999Z'))).toBe('2026-10-30T12:00:00.000Z');
    expect(attemptWindow(new Date('2026-10-30T13:00:00.000Z'))).toBe('2026-10-30T13:00:00.000Z');
  });

  it('permite sob a cota, trava na cota e libera na hora seguinte', async () => {
    for (let i = 0; i < LOGIN_LIMIT_PER_ACCOUNT - 1; i++)
      await recordAttempt(db, 'login-account', 'fulana', NOW);
    await expect(
      throttleBudget(db, 'login-account', 'fulana', LOGIN_LIMIT_PER_ACCOUNT, NOW),
    ).resolves.toBeUndefined();
    await recordAttempt(db, 'login-account', 'fulana', NOW);
    await expectHttpError(
      throttleBudget(db, 'login-account', 'fulana', LOGIN_LIMIT_PER_ACCOUNT, NOW),
      429,
      'too_many_attempts',
    );
    // Hora seguinte, janela nova: liberado.
    await expect(
      throttleBudget(db, 'login-account', 'fulana', LOGIN_LIMIT_PER_ACCOUNT, later(HOUR)),
    ).resolves.toBeUndefined();
  });

  it('conta separada por tipo e por chave', async () => {
    for (let i = 0; i < REGISTER_LIMIT_PER_IP - 1; i++)
      await recordAttempt(db, 'register-ip', '203.0.113.7', NOW);
    // Mesmo IP, outro tipo (login): não herda a cota do cadastro.
    await expect(
      throttleBudget(db, 'login-ip', '203.0.113.7', LOGIN_LIMIT_PER_IP, NOW),
    ).resolves.toBeUndefined();
    // Mesmo tipo, outro IP: segue liberado.
    await expect(
      throttleBudget(db, 'register-ip', '203.0.113.8', REGISTER_LIMIT_PER_IP, NOW),
    ).resolves.toBeUndefined();
  });

  it('limpa janelas velhas ao registrar tentativa nova', async () => {
    await recordAttempt(db, 'login-ip', '203.0.113.7', NOW);
    await recordAttempt(db, 'login-ip', '203.0.113.7', later(3 * HOUR));
    const rows = db.raw.prepare('SELECT COUNT(*) n FROM auth_attempts').get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('usuários', () => {
  it('cadastro cria o usuário e registra a criação', async () => {
    const db = createTestDatabase();
    const hash = await hashPassword('abcd1234', 10_000);
    const user = await registerUser(db, 'Fulana', 'fulana', hash, NOW);
    expect(user).toMatchObject({ username: 'Fulana', role: 'user', status: 'active' });
    expect(publicUser(user)).toEqual({ id: user.id, username: 'Fulana', role: 'user' });
    const events = db.raw.prepare('SELECT user_id, actor_id, operation FROM user_events').all();
    expect(events).toEqual([{ user_id: user.id, actor_id: user.id, operation: 'create' }]);
  });

  it('mesmo nome, com outra caixa, dá 409 e não grava nada duplicado', async () => {
    const db = createTestDatabase();
    const hash = await hashPassword('abcd1234', 10_000);
    await registerUser(db, 'Fulana', 'fulana', hash, NOW);
    await expectHttpError(registerUser(db, 'FULANA', 'fulana', hash, NOW), 409, 'username_taken');
    expect((db.raw.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(1);
    expect((db.raw.prepare('SELECT COUNT(*) n FROM user_events').get() as { n: number }).n).toBe(1);
  });

  it('busca pela chave em minúsculas traz a hash junto', async () => {
    const db = createTestDatabase();
    const hash = await hashPassword('abcd1234', 10_000);
    const created = await registerUser(db, 'Fulana', 'fulana', hash, NOW);
    const found = await findUserByUsernameKey(db, 'fulana');
    expect(found).toMatchObject({ id: created.id, username: 'Fulana', passwordHash: hash });
    expect(await findUserByUsernameKey(db, 'ninguem')).toBeNull();
  });

  it('valida o username', () => {
    expect(normalizeUsername('  Fulana_01 ')).toEqual({ username: 'Fulana_01', key: 'fulana_01' });
    expect(normalizeUsername('João Ônibus')).toEqual({
      username: 'João Ônibus',
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
      expect(() => normalizeUsername(bad)).toThrow(HttpError);
    }
  });

  it('troca de username fica no histórico; nome igual não grava nada', async () => {
    const db = createTestDatabase();
    const user = await registerUser(db, 'Fulana', 'fulana', FAKE_HASH, NOW);
    const renamed = await renameUsername(db, user, 'Fulana Silva', later(DAY));
    expect(renamed.username).toBe('Fulana Silva');
    await renameUsername(db, renamed, 'Fulana Silva', later(DAY));
    const events = db.raw
      .prepare("SELECT detail FROM user_events WHERE operation = 'rename' ORDER BY id")
      .all();
    expect(events).toEqual([
      { detail: JSON.stringify({ from: 'Fulana', to: 'Fulana Silva' }) },
    ]);
  });

  it('username já usado, mesmo com outra caixa, dá 409 e não grava evento', async () => {
    const db = createTestDatabase();
    const a = await registerUser(db, 'Fulana', 'fulana', FAKE_HASH, NOW);
    const b = await registerUser(db, 'Beltrana', 'beltrana', FAKE_HASH, NOW);
    await expectHttpError(renameUsername(db, b, 'FULANA', NOW), 409, 'username_taken');
    expect(
      (db.raw.prepare("SELECT COUNT(*) n FROM user_events WHERE operation = 'rename'").get() as { n: number })
        .n,
    ).toBe(0);
    expect(a.username).toBe('Fulana');
  });
});

describe('sessões', () => {
  const withCookie = (cookie: string) =>
    new Request('https://site.test/', { headers: { Cookie: cookie.split(';')[0] } });

  const newUser = async () => {
    const db = createTestDatabase();
    const user = await registerUser(db, 'Fulana', 'fulana', FAKE_HASH, NOW);
    return { db, user };
  };

  it('cria a sessão com cookie seguro e guarda só o hash do token', async () => {
    const { db, user } = await newUser();
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
    const { db } = await newUser();
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
    const { db, user } = await newUser();
    const cookie = await createSession(db, user.id, NOW);
    expect(await currentUser(db, withCookie(cookie), later(29 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(58 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(87 * DAY))).not.toBeNull();
    expect(await currentUser(db, withCookie(cookie), later(90 * DAY))).toBeNull();

    const idle = await createSession(db, user.id, NOW);
    expect(await currentUser(db, withCookie(idle), later(31 * DAY))).toBeNull();
  });

  it('só regrava o último uso uma vez por dia', async () => {
    const { db, user } = await newUser();
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
    const { db, user } = await newUser();
    const cookie = await createSession(db, user.id, NOW);
    db.raw.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(user.id);
    await expectHttpError(requireUser(db, withCookie(cookie), NOW), 403, 'banned');
  });

  it('sair apaga a sessão no banco; criar sessão limpa as vencidas', async () => {
    const { db, user } = await newUser();
    const cookie = await createSession(db, user.id, NOW);
    await deleteSession(db, withCookie(cookie));
    expect(await currentUser(db, withCookie(cookie), NOW)).toBeNull();
    await deleteSession(db, new Request('https://site.test/'));

    await createSession(db, user.id, NOW);
    await createSession(db, user.id, later(91 * DAY));
    expect((db.raw.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(1);
  });
});
