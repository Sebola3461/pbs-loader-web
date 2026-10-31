import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogEntry, DEFAULT_CATALOG_URL, resetCatalogCache } from './catalog';
import { Database, Statement } from './db';
import { Env } from './db';
import { createSession } from './sessions';
import { recordSubmission } from './submissions';
import { expectHttpError, FAKE_HASH } from './testing/fixtures';
import { fakeFetch } from './testing/http';
import { createTestDatabase } from './testing/sqlite-d1';
import { registerUser, User } from './users';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const SITE = 'https://mods.example';

const validMod = (overrides: Record<string, unknown> = {}) => ({
  id: 'Novo',
  nome: 'Mod Novo',
  tipo: 'plugin',
  descricao: 'Descrição do mod novo.',
  versoesDoJogo: ['307'],
  dependencias: [],
  origem: 'github',
  repo: 'ana/mod-novo',
  tag: 'Novo-v',
  arquivo: 'Novo.dll',
  pagina: null,
  capa: null,
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  operation: 'publish',
  modId: 'Novo',
  idempotencyKey: 'chave-0001',
  mod: validMod(),
  ...overrides,
});

const publish = (modId: string, n: number) =>
  body({ modId, idempotencyKey: `chave-${String(n).padStart(4, '0')}`, mod: validMod({ id: modId }) });

async function setup() {
  const db = createTestDatabase();
  const ana = await registerUser(db, 'Ana', 'ana', FAKE_HASH, NOW);
  const bia = await registerUser(db, 'Bia', 'bia', FAKE_HASH, NOW);
  // O domínio recebe o principal como veio da sessão; o papel de moderator é dado aqui, fora do banco.
  const moderador: User = {
    ...(await registerUser(db, 'Mod', 'mod', FAKE_HASH, NOW)),
    role: 'moderator',
  };
  const mods = new Map<string, CatalogEntry>([
    ['Painel', { id: 'Painel', dono: { github: 'fulana' } }],
    ['Mapa', { id: 'Mapa', dono: { site: bia.id } }],
  ]);
  return { db, ana, bia, moderador, mods };
}

/** Sessão real para exercitar as rotas: o cookie leva o token, o banco guarda só o hash. */
async function cookieFor(db: Awaited<ReturnType<typeof createTestDatabase>>, user: User) {
  const cookie = await createSession(db, user.id, NOW);
  return cookie.split(';')[0].split('=').slice(1).join('=');
}

const post = (url: string, payload: unknown, token: string) =>
  new Request(`${SITE}${url}`, {
    method: 'POST',
    headers: {
      Origin: SITE,
      Cookie: `__Host-pbs_session=${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

describe('submissões', () => {
  beforeEach(() => resetCatalogCache());

  it('publica um mod novo: pending, com dono e autor vindos do servidor', async () => {
    const { db, ana, mods } = await setup();
    const result = await recordSubmission(
      db,
      ana,
      body({ mod: validMod({ dependencias: ['Painel'], pagina: 'https://exemplo.com/wiki', capa: 'covers/Novo.webp' }) }),
      mods,
      NOW,
    );
    expect(result.response.status).toBe(201);
    const row = db.raw
      .prepare('SELECT mod_id, operation, status, payload FROM submissions')
      .get() as { mod_id: string; operation: string; status: string; payload: string };
    expect(row).toMatchObject({ mod_id: 'Novo', operation: 'publish', status: 'pending' });
    const payload = JSON.parse(row.payload);
    expect(payload).toMatchObject({
      id: 'Novo',
      autor: 'Ana',
      dono: { site: ana.id },
      dependencias: ['Painel'],
      pagina: 'https://exemplo.com/wiki',
      capa: 'covers/Novo.webp',
      confiavel: false,
      criadoEm: null,
      atualizadoEm: null,
    });
  });

  it('recusa publicar id que já existe no catálogo', async () => {
    const { db, ana, mods } = await setup();
    await expectHttpError(
      recordSubmission(db, ana, body({ modId: 'Painel', mod: validMod({ id: 'Painel' }) }), mods, NOW),
      409,
      'mod_exists',
    );
  });

  it('editar e remover exigem ser o dono; id de GitHub não pertence a ninguém do site', async () => {
    const { db, ana, bia, mods } = await setup();
    const edit = (user: User, modId: string, key: string) =>
      recordSubmission(
        db,
        user,
        body({ operation: 'edit', modId, idempotencyKey: key, mod: validMod({ id: modId }) }),
        mods,
        NOW,
      );
    await expectHttpError(edit(ana, 'Mapa', 'chave-edit1'), 403, 'not_owner');
    await expectHttpError(edit(ana, 'Painel', 'chave-edit2'), 403, 'not_owner');
    expect((await edit(bia, 'Mapa', 'chave-edit3')).response.status).toBe(201);
    await expectHttpError(edit(bia, 'Sumiu', 'chave-edit4'), 404, 'mod_not_found');
  });

  it('ocultar é papel de moderator ou admin', async () => {
    const { db, ana, moderador, mods } = await setup();
    await expectHttpError(
      recordSubmission(db, ana, body({ operation: 'hide', modId: 'Mapa' }), mods, NOW),
      403,
      'forbidden',
    );
    const result = await recordSubmission(
      db,
      moderador,
      body({ operation: 'hide', modId: 'Mapa' }),
      mods,
      NOW,
    );
    expect(result.response.status).toBe(201);
    expect(db.raw.prepare('SELECT payload FROM submissions').get()).toEqual({ payload: null });
  });

  it('reenvio com a mesma chave devolve a submissão original; chave reusada com outro payload dá 409', async () => {
    const { db, ana, mods } = await setup();
    const first = await recordSubmission(db, ana, body(), mods, NOW);
    const again = await recordSubmission(db, ana, body(), mods, later(1000));
    expect(again.response.status).toBe(200);
    const firstBody = (await first.response.json()) as { submission: { id: string } };
    const againBody = (await again.response.json()) as { submission: { id: string } };
    expect(againBody.submission.id).toBe(firstBody.submission.id);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toEqual({ n: 1 });
    await expectHttpError(
      recordSubmission(db, ana, body({ mod: validMod({ nome: 'Outro nome' }) }), mods, later(2000)),
      409,
      'idempotency_conflict',
    );
  });

  it('limite de 5 envios em 24 horas; fora da janela a conta recomeça', async () => {
    const { db, ana, mods } = await setup();
    for (let n = 1; n <= 5; n++) {
      expect((await recordSubmission(db, ana, publish(`Mod${n}`, n), mods, NOW)).response.status).toBe(201);
    }
    await expectHttpError(recordSubmission(db, ana, publish('Mod6', 6), mods, NOW), 429, 'submission_limit');
    db.raw
      .prepare('UPDATE submissions SET created_at = ? WHERE mod_id = ?')
      .run(new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(), 'Mod1');
    expect((await recordSubmission(db, ana, publish('Mod6', 6), mods, NOW)).response.status).toBe(201);
  });

  it('recusa payload inválido: tipo desconhecido, origem sem campos, id divergente, url insegura', async () => {
    const { db, ana, mods } = await setup();
    await expectHttpError(
      recordSubmission(db, ana, body({ mod: validMod({ tipo: 'naves' }) }), mods, NOW),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(
        db,
        ana,
        body({ mod: validMod({ origem: 'externa', url: 'http://exemplo.com/mod.zip' }) }),
        mods,
        NOW,
      ),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(db, ana, body({ mod: validMod({ versoesDoJogo: [] }) }), mods, NOW),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(db, ana, body({ modId: 'Outro', mod: validMod() }), mods, NOW),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(
        db,
        ana,
        body({ mod: validMod({ origem: 'github', repo: 'sem-barra' }) }),
        mods,
        NOW,
      ),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(
        db,
        ana,
        body({ mod: validMod({ dependencias: ['tem espaço'] }) }),
        mods,
        NOW,
      ),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(
        db,
        ana,
        body({ mod: validMod({ pagina: 'não é url' }) }),
        mods,
        NOW,
      ),
      400,
      'invalid_payload',
    );
    await expectHttpError(
      recordSubmission(
        db,
        ana,
        body({ mod: validMod({ capa: 'http://exemplo.com/capa.webp' }) }),
        mods,
        NOW,
      ),
      400,
      'invalid_payload',
    );
  });

  it('publica por link externo com url https', async () => {
    const { db, ana, mods } = await setup();
    const result = await recordSubmission(
      db,
      ana,
      body({
        modId: 'Externo',
        idempotencyKey: 'chave-ext1',
        mod: validMod({ id: 'Externo', origem: 'externa', url: 'https://exemplo.com/mod.zip' }),
      }),
      mods,
      NOW,
    );
    expect(result.response.status).toBe(201);
    const row = db.raw.prepare('SELECT payload FROM submissions').get() as { payload: string };
    expect(JSON.parse(row.payload)).toMatchObject({
      origem: 'externa',
      url: 'https://exemplo.com/mod.zip',
    });
  });

  it('envio gêmeo entre o SELECT e o INSERT: o primeiro vence e o replay decide', async () => {
    const { db, ana, mods } = await setup();
    // O "outro envio" já gravou a mesma chave; o proxy esconde a linha na primeira busca de replay,
    // como na corrida real entre dois envios simultâneos.
    await recordSubmission(db, ana, body(), mods, NOW);
    const maskOnce = (database: Database): Database => {
      let hidden = 1;
      return {
        prepare(sql: string) {
          const real = database.prepare(sql);
          if (!sql.includes('SELECT * FROM submissions WHERE user_id = ? AND idempotency_key = ?') || hidden === 0) {
            return real;
          }
          hidden--;
          const miss: Statement = {
            bind: () => miss,
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => undefined,
          };
          return miss;
        },
        batch: (statements) => database.batch(statements),
      };
    };
    const replayed = await recordSubmission(maskOnce(db), ana, body(), mods, NOW);
    expect(replayed.response.status).toBe(200);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toEqual({ n: 1 });

    // Fase 2: o gêmeo gravou a mesma chave com outro payload; o reenvio vira conflito em vez de segunda linha.
    db.raw.prepare(`UPDATE submissions SET payload = '{"id":"Novo"}' WHERE mod_id = 'Novo'`).run();
    await expectHttpError(
      recordSubmission(maskOnce(db), ana, body(), mods, NOW),
      409,
      'idempotency_conflict',
    );
  });

  it('operações inválidas e chaves curtas não chegam ao banco', async () => {
    const { db, ana, mods } = await setup();
    await expectHttpError(
      recordSubmission(db, ana, body({ operation: 'replace' }), mods, NOW),
      400,
      'invalid_operation',
    );
    await expectHttpError(
      recordSubmission(db, ana, body({ idempotencyKey: 'curta' }), mods, NOW),
      400,
      'invalid_idempotency_key',
    );
    await expectHttpError(
      recordSubmission(db, ana, body({ modId: 'tem espaço' }), mods, NOW),
      400,
      'invalid_mod_id',
    );
  });

  it('o banco recusa dado inválido mesmo se o código deixar passar', async () => {
    const { db, ana } = await setup();
    const insert = (sql: string, ...values: (string | number | null)[]) => () =>
      db.raw.prepare(sql).run(...values);
    expect(
      insert(
        `INSERT INTO submissions (id, user_id, mod_id, operation, idempotency_key, status, created_at, updated_at)
         VALUES ('01928c3e-7b2a-7c4d-8e9f-111111111111', ?, 'Mod', 'publish', 'chave-0001', 'pending', 'x', 'x')`,
        ana.id,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(
      insert(
        `INSERT INTO submissions (id, user_id, mod_id, operation, payload, idempotency_key, status, error_code, created_at, updated_at)
         VALUES ('01928c3e-7b2a-7c4d-8e9f-222222222222', ?, 'Mod', 'publish', 'não é json', 'chave-0002', 'pending', NULL, 'x', 'x')`,
        ana.id,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(
      insert(
        `INSERT INTO submissions (id, user_id, mod_id, operation, payload, idempotency_key, status, error_code, created_at, updated_at)
         VALUES ('01928c3e-7b2a-7c4d-8e9f-333333333333', ?, 'Mod', 'remove', NULL, 'chave-0003', 'failed', NULL, 'x', 'x')`,
        ana.id,
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rota completa: sessão + catálogo do GitHub Pages + envio; catálogo fora do ar falha fechado', async () => {
    const { db, ana } = await setup();
    const token = await cookieFor(db, ana);
    const env = { DB: db } as Env;
    const request = post('/api/submissions', body(), token);
    const { postSubmission } = await import('./routes');

    const fetcher = fakeFetch({
      [DEFAULT_CATALOG_URL]: () =>
        new Response(JSON.stringify({ mods: [{ id: 'Painel', dono: { github: 'fulana' } }] })),
    });
    const ok = await postSubmission(request, env, { now: () => NOW, fetchImpl: fetcher.impl });
    expect(ok.response.status).toBe(201);

    resetCatalogCache();
    const offline = post('/api/submissions', body({ idempotencyKey: 'chave-0002' }), token);
    await expectHttpError(
      postSubmission(offline, env, { now: () => NOW, fetchImpl: fakeFetch({}).impl }),
      503,
      'catalog_unavailable',
    );
  });
});
