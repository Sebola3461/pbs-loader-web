import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogEntry, catalogMods, resetCatalogCache } from './catalog';
import { HttpError } from './http';
import {
  RATING_CHANGES_PER_HOUR,
  ratingStats,
  removeRating,
  setRating,
  userRatings,
} from './ratings';
import { fakeFetch } from './testing/http';
import { createTestDatabase } from './testing/sqlite-d1';
import { registerUser, User } from './users';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}

/** Hash falsa com comprimento válido para o CHECK do banco; nunca é verificada nestes testes. */
const FAKE_HASH =
  'pbkdf2$sha256$10000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

async function setup() {
  const db = createTestDatabase();
  const ana = (await registerUser(db, 'Ana', 'ana', FAKE_HASH, NOW)) as User;
  const bia = (await registerUser(db, 'Bia', 'bia', FAKE_HASH, NOW)) as User;
  const mods = new Map<string, CatalogEntry>([
    ['Painel', { id: 'Painel', dono: { github: 'fulana' }, capa: null }],
    ['Mapa', { id: 'Mapa', dono: { site: bia.id }, capa: null }],
  ]);
  const events = () =>
    db.raw.prepare('SELECT user_id, mod_id, operation, stars FROM rating_events ORDER BY id').all();
  return { db, ana, bia, mods, events };
}

describe('avaliações', () => {
  it('grava, troca e repete a nota; cada mudança vira evento', async () => {
    const { db, ana, mods, events } = await setup();
    expect(await setRating(db, ana, 'Painel', 4, mods, NOW)).toBe(4);
    await setRating(db, ana, 'Painel', 4, mods, NOW);
    await setRating(db, ana, 'Painel', 2, mods, later(1000));
    expect(await userRatings(db, ana.id)).toEqual({ Painel: 2 });
    expect(events()).toEqual([
      { user_id: ana.id, mod_id: 'Painel', operation: 'set', stars: 4 },
      { user_id: ana.id, mod_id: 'Painel', operation: 'set', stars: 2 },
    ]);
    const row = db.raw.prepare('SELECT created_at, updated_at FROM ratings').get();
    expect(row).toEqual({ created_at: NOW.toISOString(), updated_at: later(1000).toISOString() });
  });

  it('recusa nota fora de 1..5 ou que não é inteiro', async () => {
    const { db, ana, mods } = await setup();
    for (const stars of [0, 6, 2.5, '4', null, undefined]) {
      await expectHttpError(setRating(db, ana, 'Painel', stars, mods, NOW), 400, 'invalid_stars');
    }
  });

  it('mod fora do catálogo dá 404; o próprio mod dá 403', async () => {
    const { db, ana, bia, mods } = await setup();
    await expectHttpError(setRating(db, ana, 'Sumiu', 3, mods, NOW), 404, 'mod_not_found');
    await expectHttpError(setRating(db, bia, 'Mapa', 5, mods, NOW), 403, 'own_mod');
    expect(await setRating(db, ana, 'Mapa', 5, mods, NOW)).toBe(5);
  });

  it('o banco recusa dado inválido mesmo se o código deixar passar', async () => {
    const { db, ana } = await setup();
    const insert =
      (sql: string, ...values: (string | number)[]) =>
      () =>
        db.raw.prepare(sql).run(...values);
    expect(
      insert(
        "INSERT INTO ratings (user_id, mod_id, stars, created_at, updated_at) VALUES (?, 'Mod', 9, 'x', 'x')",
        ana.id,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(
      insert(
        "INSERT INTO rating_events (user_id, mod_id, operation, stars, created_at) VALUES (?, 'Mod', 'remove', 3, 'x')",
        ana.id,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(
      insert(
        "INSERT INTO ratings (user_id, mod_id, stars, created_at, updated_at) VALUES ('ninguem', 'Mod', 3, 'x', 'x')",
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(
      insert(
        "INSERT INTO users (id, username, username_key, password_hash, created_at, updated_at) VALUES ('curto', 'ab', 'ab', 'x', 'x', 'x')",
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('tirar a nota grava evento; tirar sem nota não faz nada', async () => {
    const { db, ana, mods, events } = await setup();
    await removeRating(db, ana, 'Painel', NOW);
    expect(events()).toEqual([]);
    await setRating(db, ana, 'Painel', 5, mods, NOW);
    await removeRating(db, ana, 'Painel', NOW);
    expect(await userRatings(db, ana.id)).toEqual({});
    expect(events()).toEqual([
      { user_id: ana.id, mod_id: 'Painel', operation: 'set', stars: 5 },
      { user_id: ana.id, mod_id: 'Painel', operation: 'remove', stars: null },
    ]);
  });

  it('limita as mudanças por hora e libera depois', async () => {
    const { db, ana, mods } = await setup();
    for (let i = 0; i < RATING_CHANGES_PER_HOUR; i++) {
      await setRating(db, ana, 'Painel', (i % 5) + 1, mods, later(i));
    }
    await expectHttpError(
      setRating(db, ana, 'Painel', 1, mods, later(1000)),
      429,
      'too_many_changes',
    );
    await expectHttpError(removeRating(db, ana, 'Painel', later(1000)), 429, 'too_many_changes');
    expect(await setRating(db, ana, 'Painel', 3, mods, later(60 * 60 * 1000 + 100))).toBe(3);
  });

  it('estatísticas com contagem e média arredondada', async () => {
    const { db, ana, bia, mods } = await setup();
    const caio = (await registerUser(db, 'Caio', 'caio', FAKE_HASH, NOW)) as User;
    await setRating(db, ana, 'Painel', 5, mods, NOW);
    await setRating(db, bia, 'Painel', 4, mods, NOW);
    await setRating(db, caio, 'Painel', 4, mods, NOW);
    await setRating(db, ana, 'Mapa', 2, mods, NOW);
    expect(await ratingStats(db)).toEqual({
      Painel: { count: 3, average: 4.33 },
      Mapa: { count: 1, average: 2 },
    });
  });
});

describe('catálogo no servidor', () => {
  const URL_CATALOG = 'https://catalogo.test/c.json';
  beforeEach(() => resetCatalogCache());

  it('lê e guarda por 5 minutos', async () => {
    const fetch = fakeFetch({
      [URL_CATALOG]: () =>
        new Response(JSON.stringify({ mods: [{ id: 'A', dono: { github: 'x' } }] })),
    });
    const mods = await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 0 });
    expect([...mods.keys()]).toEqual(['A']);
    await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 4 * 60 * 1000 });
    expect(fetch.calls).toHaveLength(1);
    await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 6 * 60 * 1000 });
    expect(fetch.calls).toHaveLength(2);
  });

  it('com o catálogo fora do ar, usa a última cópia; sem cópia, 503', async () => {
    let up = true;
    const fetch = fakeFetch({
      [URL_CATALOG]: () =>
        up
          ? new Response(JSON.stringify({ mods: [{ id: 'A', dono: {} }] }))
          : new Response('', { status: 502 }),
    });
    await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 0 });
    up = false;
    expect([
      ...(await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 10 * 60 * 1000 })).keys(),
    ]).toEqual(['A']);
    resetCatalogCache();
    await expectHttpError(
      catalogMods(URL_CATALOG, { fetchImpl: fetch.impl, now: 0 }),
      503,
      'catalog_unavailable',
    );
  });

  it('catálogo sem lista vira mapa vazio', async () => {
    const fetch = fakeFetch({ [URL_CATALOG]: () => new Response('{}') });
    expect((await catalogMods(URL_CATALOG, { fetchImpl: fetch.impl })).size).toBe(0);
  });
});
