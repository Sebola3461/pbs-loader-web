import { describe, expect, it } from 'vitest';
import { CATALOG_REPO, publishToGithub, pullRequestState } from './github';
import { expectHttpError } from './testing/fixtures';
import { fakeFetch } from './testing/http';

const REPO_API = `https://api.github.com/repos/${CATALOG_REPO}`;
const contentsUrl = (modId: string) => `${REPO_API}/contents/mods/${modId}.json?ref=site/${modId}`;
const TOKEN = 'token-teste';
const ROW = {
  id: 'sub-1',
  userId: 'u-1',
  modId: 'Novo',
  operation: 'publish' as const,
  payload: '{"id":"Novo"}',
};

/** Endpoints do caminho feliz de publish: arquivo novo (404 no GET) e PR 12. */
const contentsHandler = (request: Request) =>
  request.method === 'PUT'
    ? new Response('{}', { status: 201 })
    : new Response('{"message":"Not Found"}', { status: 404 });
// O PUT/DELETE do Contents API não leva ?ref (o branch vai no corpo): o caminho puro é outra chave.
const base = () => ({
  [REPO_API]: () => new Response(JSON.stringify({ default_branch: 'main' })),
  [`${REPO_API}/pulls?head=Sebola3461%3Asite%2FNovo&state=open`]: () => new Response('[]'),
  [`${REPO_API}/git/ref/heads/main`]: () =>
    new Response(JSON.stringify({ object: { sha: 'sha-base' } })),
  [`${REPO_API}/git/refs`]: () => new Response('{}', { status: 201 }),
  [contentsUrl('Novo')]: contentsHandler,
  [`${REPO_API}/contents/mods/Novo.json`]: contentsHandler,
  [`${REPO_API}/pulls`]: () => new Response(JSON.stringify({ number: 12 }), { status: 201 }),
});

const file = (sha: string, content: string) => ({ sha, content: btoa(content) });

describe('cliente do GitHub', () => {
  it('publica: branch, arquivo novo e PR; devolve o número', async () => {
    const fetcher = fakeFetch(base());
    const result = await publishToGithub(TOKEN, fetcher.impl, ROW);
    expect(result.prNumber).toBe(12);
    const put = fetcher.calls.find((c) => c.method === 'PUT' && c.url.includes('/contents/'));
    const body = JSON.parse(await put!.request.text());
    expect(body.sha).toBeUndefined();
    expect(body.branch).toBe('site/Novo');
    expect(body.message).toContain('via site, user: u-1');
    expect(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'))).toEqual({ id: 'Novo' });
  });

  it('PR aberto para o mesmo mod dá conflito, sem criar branch', async () => {
    const fetcher = fakeFetch({
      [`${REPO_API}/pulls?head=Sebola3461%3Asite%2FNovo&state=open`]: () =>
        new Response(JSON.stringify([{ number: 5 }])),
    });
    await expectHttpError(publishToGithub(TOKEN, fetcher.impl, ROW), 409, 'pr_conflict');
    expect(fetcher.calls.every((c) => !c.url.includes('/git/refs'))).toBe(true);
  });

  it('sem token falha fechado', async () => {
    await expectHttpError(publishToGithub(undefined, fetch, ROW), 503, 'github_unavailable');
  });

  it('GitHub fora do ar dá github_unavailable', async () => {
    const fetcher = fakeFetch({});
    await expectHttpError(publishToGithub(TOKEN, fetcher.impl, ROW), 502, 'github_unavailable');
  });

  it('limite da API vira github_unavailable', async () => {
    const fetcher = fakeFetch({
      [`${REPO_API}/pulls?head=Sebola3461%3Asite%2FNovo&state=open`]: () =>
        new Response('{}', { status: 403 }),
    });
    await expectHttpError(publishToGithub(TOKEN, fetcher.impl, ROW), 502, 'github_unavailable');
  });

  it('repo inexistente ou inacessível vira github_unavailable', async () => {
    const fetcher = fakeFetch({
      [`${REPO_API}/pulls?head=Sebola3461%3Asite%2FNovo&state=open`]: () => new Response('[]'),
      [REPO_API]: () => new Response('"Not Found"', { status: 404 }),
    });
    await expectHttpError(publishToGithub(TOKEN, fetcher.impl, ROW), 502, 'github_unavailable');
  });

  it('branch de envio anterior (422 no create-ref) é reutilizado: o arquivo é criado nele', async () => {
    const fetcher = fakeFetch({
      ...base(),
      [`${REPO_API}/git/refs`]: () => new Response('"Reference already exists"', { status: 422 }),
    });
    const result = await publishToGithub(TOKEN, fetcher.impl, ROW);
    expect(result.prNumber).toBe(12);
  });

  it('editar pega o sha do arquivo existente e sobrescreve', async () => {
    const handler = (request: Request) =>
      request.method === 'PUT'
        ? new Response('{}', { status: 201 })
        : new Response(JSON.stringify(file('sha-arquivo', '{"id":"Novo"}')), { status: 200 });
    const fetcher = fakeFetch({
      ...base(),
      [contentsUrl('Novo')]: handler,
      [`${REPO_API}/contents/mods/Novo.json`]: handler,
    });
    const result = await publishToGithub(TOKEN, fetcher.impl, { ...ROW, operation: 'edit' });
    expect(result.prNumber).toBe(12);
    const put = fetcher.calls.find((c) => c.method === 'PUT' && c.url.includes('/contents/'));
    const body = JSON.parse(await put!.request.text());
    expect(body.sha).toBe('sha-arquivo');
  });

  it('remover apaga o arquivo com o sha atual', async () => {
    const fetcher = fakeFetch({
      ...base(),
      [contentsUrl('Novo')]: () => new Response(JSON.stringify(file('sha-arquivo', '{"id":"Novo"}')), { status: 200 }),
    });
    await publishToGithub(TOKEN, fetcher.impl, { ...ROW, operation: 'remove' });
    const del = fetcher.calls.find((c) => c.method === 'DELETE');
    const body = JSON.parse(await del!.request.text());
    expect(body.sha).toBe('sha-arquivo');
    expect(body.branch).toBe('site/Novo');
  });

  it('ocultar grava o arquivo atual do repo com oculto verdadeiro', async () => {
    let gravado = '';
    const handler = async (request: Request) => {
      if (request.method === 'PUT') {
        gravado = Buffer.from(JSON.parse(await request.text()).content, 'base64').toString('utf8');
        return new Response('{}', { status: 201 });
      }
      return new Response(JSON.stringify(file('sha-arquivo', '{"id":"Novo","nome":"Mod"}')), {
        status: 200,
      });
    };
    const fetcher = fakeFetch({
      ...base(),
      [contentsUrl('Novo')]: handler,
      [`${REPO_API}/contents/mods/Novo.json`]: handler,
    });
    await publishToGithub(TOKEN, fetcher.impl, { ...ROW, operation: 'hide' });
    expect(JSON.parse(gravado)).toMatchObject({ id: 'Novo', nome: 'Mod', oculto: true });
  });

  it('estado do PR: merged, fechado e aberto; sem token não consulta', async () => {
    const mergeada = fakeFetch({
      [`${REPO_API}/pulls/7`]: () => new Response(JSON.stringify({ state: 'closed', merged: true })),
    });
    expect(await pullRequestState(TOKEN, mergeada.impl, 7)).toBe('merged');
    const recusada = fakeFetch({
      [`${REPO_API}/pulls/7`]: () => new Response(JSON.stringify({ state: 'closed', merged: false })),
    });
    expect(await pullRequestState(TOKEN, recusada.impl, 7)).toBe('closed');
    const aberta = fakeFetch({
      [`${REPO_API}/pulls/7`]: () => new Response(JSON.stringify({ state: 'open', merged: false })),
    });
    expect(await pullRequestState(TOKEN, aberta.impl, 7)).toBe('open');
    expect(await pullRequestState(undefined, fetch, 7)).toBeNull();
  });

  it('estado do PR com GitHub fora do ar: sem quebrar a listagem, segue como está', async () => {
    const offline = fakeFetch({});
    expect(await pullRequestState(TOKEN, offline.impl, 7)).toBeNull();
  });
});
