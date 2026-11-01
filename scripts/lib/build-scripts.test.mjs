import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { DEFAULT_CATALOG_SOURCE, loadCatalog, parseCatalog } from './catalog-source.mjs';
import { buildHeaders, COVER_ORIGIN, inlineScriptHashes } from './static-headers.mjs';

const VALID = JSON.stringify({ formato: 1, geradoEm: 'x', mods: [] });
const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

test('parseCatalog aceita o formato 1 e recusa o resto', () => {
  assert.deepEqual(parseCatalog(VALID).mods, []);
  assert.throws(
    () => parseCatalog('{"formato": 2, "mods": []}'),
    /formato de catálogo não suportado: 2/,
  );
  assert.throws(() => parseCatalog('{"formato": 1}'), /sem a lista "mods"/);
  assert.throws(() => parseCatalog('null'), /não suportado/);
  assert.throws(() => parseCatalog('{'), SyntaxError);
});

test('parseCatalog descarta mod com id ou dono que viraria caminho perigoso', () => {
  const ok = { id: 'Bom', dono: { github: 'fulana' } };
  const site = { id: 'DoSite', dono: { site: '01928c3e-7b2a-7c4d-8e9f-0123456789ab' } };
  const mods = [
    ok,
    site,
    { id: '../../etc', dono: { github: 'x' } },
    { id: 'SemDono' },
    { id: 'DonoRuim', dono: { github: '../x' } },
    { id: 7, dono: { github: 'x' } },
    null,
  ];
  const warnings = [];
  const parsed = parseCatalog(JSON.stringify({ formato: 1, mods }), (w) => warnings.push(w));
  assert.deepEqual(parsed.mods, [ok, site]);
  assert.equal(warnings.length, 5);
  assert.match(warnings[0], /"..\/..\/etc"/);
});

test('loadCatalog baixa de https', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => VALID };
  };
  assert.equal((await loadCatalog(DEFAULT_CATALOG_SOURCE, { fetchImpl })).formato, 1);
  assert.deepEqual(seen, [DEFAULT_CATALOG_SOURCE]);
});

test('loadCatalog falha o build quando o download falha', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(
    loadCatalog('https://x.com/c.json', { fetchImpl }),
    /não consegui baixar o catálogo de https:\/\/x.com\/c.json \(503\)/,
  );
});

test('loadCatalog lê arquivo local', async () => {
  const read = [];
  const readFileImpl = async (path) => {
    read.push(path);
    return VALID;
  };
  assert.equal((await loadCatalog('fixtures/c.json', { readFileImpl })).formato, 1);
  assert.deepEqual(read, ['fixtures/c.json']);
});

test('inlineScriptHashes pega só scripts inline executáveis', () => {
  const html = [
    '<script src="main.js"></script>',
    '<script>window.a=1</script>',
    '<script type="module">import "x"</script>',
    '<script type="text/javascript">b()</script>',
    '<script id="ng-state" type="application/json">{"a":1}</script>',
    "<SCRIPT TYPE='module' src='y.js'></SCRIPT>",
  ].join('');
  assert.deepEqual(inlineScriptHashes(html), [sha('window.a=1'), sha('import "x"'), sha('b()')]);
  assert.deepEqual(inlineScriptHashes('<p>sem scripts</p>'), []);
});

test('inlineScriptHashes reconhece os tipos JS do HTML e não confunde data-type com type', () => {
  const html = [
    '<script type="application/javascript">c()</script>',
    '<script type="text/javascript; charset=utf-8">d()</script>',
    '<script type="">e()</script>',
    '<script data-type="x" type="module">f()</script>',
    '<script data-src="x.js">g()</script>',
    '<script type=text/template><p>h</p></script>',
  ].join('');
  assert.deepEqual(inlineScriptHashes(html), [
    sha('c()'),
    sha('d()'),
    sha('e()'),
    sha('f()'),
    sha('g()'),
  ]);
});

test('buildHeaders monta a CSP com os hashes sem repetir', () => {
  const headers = buildHeaders(["'sha256-b'", "'sha256-a'", "'sha256-b'"]);
  assert.match(headers, /^\/\*\n/);
  assert.match(
    headers,
    /script-src 'self' 'sha256-a' 'sha256-b' https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js;/,
  );
  assert.match(headers, new RegExp(`img-src 'self' data: ${COVER_ORIGIN} https:\\/\\/raw\\.githubusercontent\\.com`));
  assert.match(headers, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(headers, /connect-src 'self';/);
  assert.match(
    headers,
    /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/,
  );
  assert.match(headers, /font-src 'self' https:\/\/fonts\.gstatic\.com;/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(
    buildHeaders([]),
    /script-src 'self' https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js;/,
  );
});
