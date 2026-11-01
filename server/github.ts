import { HttpError } from './http';

/** O token do bot só precisa alcançar o repo do catálogo; nada de outros repositórios. */
export const CATALOG_REPO = 'Sebola3461/pbs-loader-catalogo';
const API = 'https://api.github.com';
/** A API do GitHub pede User-Agent e fecha conexões vagantes: timeout curto evita pendurar o envio. */
const TIMEOUT_MS = 10_000;

export interface SubmissionForGithub {
  /** Id da submissão, para a trilha no corpo do PR. */
  id: string;
  userId: string;
  modId: string;
  operation: 'publish' | 'edit' | 'remove' | 'hide';
  /** JSON canônico do mod; nulo em remove (nada a gravar) e em hide (o conteúdo vem do próprio repo). */
  payload: string | null;
  /** Bytes da capa em base64; gravados num segundo commit, antes de abrir o PR (o head do PR já leva os dois). */
  coverBase64: string | null;
}

interface GithubFile {
  sha: string;
  content: string;
}

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pbs-loader-web',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

async function call(token: string, fetchImpl: typeof fetch, path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { ...headers(token), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 403/429 costuma ser limite de API ou de conteúdo; para o usuário o efeito é o mesmo: tentar de novo depois.
    if (response.status === 403 || response.status === 429 || response.status >= 500 || response.status === 401) {
      throw new HttpError(502, 'github_unavailable');
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'github_unavailable');
  }
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** json() só depois de conferir o status: resposta inesperada de GitHub é indisponibilidade, não crash. */
async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new HttpError(502, 'github_unavailable');
  return json<T>(response);
}

const branchOf = (modId: string) => `site/${modId}`;
const modPath = (modId: string) => `/repos/${CATALOG_REPO}/contents/mods/${modId}.json`;

async function defaultBranch(token: string, fetchImpl: typeof fetch): Promise<string> {
  const repo = await okJson<{ default_branch: string }>(
    await call(token, fetchImpl, `/repos/${CATALOG_REPO}`),
  );
  return repo.default_branch;
}

/** PR aberto para o mesmo mod existe: o usuário espera o merge em vez de abrir um segundo. */
async function assertNoOpenPullRequest(
  token: string,
  fetchImpl: typeof fetch,
  modId: string,
): Promise<void> {
  const url = new URL(`${API}/repos/${CATALOG_REPO}/pulls`);
  url.searchParams.set('head', `${CATALOG_REPO.split('/')[0]}:${branchOf(modId)}`);
  url.searchParams.set('state', 'open');
  const response = await call(token, fetchImpl, url.pathname + url.search);
  const pulls = await okJson<Array<{ number: number }>>(response);
  if (pulls.length > 0) throw new HttpError(409, 'pr_conflict');
}

async function branchHead(
  token: string,
  fetchImpl: typeof fetch,
  branch: string,
): Promise<string> {
  const ref = await okJson<{ object: { sha: string } }>(
    await call(token, fetchImpl, `/repos/${CATALOG_REPO}/git/ref/heads/${branch}`),
  );
  return ref.object.sha;
}

/** O conteúdo atual do mod no branch (decodificado) e o sha para o PUT/DELETE seguinte. */
async function currentFile(
  token: string,
  fetchImpl: typeof fetch,
  modId: string,
  branch: string,
): Promise<GithubFile | null> {
  const response = await call(token, fetchImpl, `${modPath(modId)}?ref=${branch}`);
  if (response.status === 404) return null;
  const file = await okJson<GithubFile>(response);
  return { sha: file.sha, content: atob(file.content.replace(/\n/g, '')) };
}

async function putFile(
  token: string,
  fetchImpl: typeof fetch,
  row: SubmissionForGithub,
  branch: string,
  content: string,
  existing: GithubFile | null,
): Promise<void> {
  const label = { publish: 'Publicar', edit: 'Editar', remove: 'Remover', hide: 'Ocultar' }[row.operation];
  const message = `${label} ${row.modId} (via site, user: ${row.userId}, operação: ${row.operation})`;
  const body: Record<string, unknown> = { message, content: base64(content), branch };
  if (existing) body.sha = existing.sha;
  await call(token, fetchImpl, modPath(row.modId), {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function deleteFile(
  token: string,
  fetchImpl: typeof fetch,
  row: SubmissionForGithub,
  branch: string,
  existing: GithubFile,
): Promise<void> {
  await call(token, fetchImpl, modPath(row.modId), {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Remover ${row.modId} (via site, user: ${row.userId}, operação: remove)`,
      sha: existing.sha,
      branch,
    }),
  });
}

async function openPullRequest(
  token: string,
  fetchImpl: typeof fetch,
  row: SubmissionForGithub,
  base: string,
): Promise<number> {
  const label = { publish: 'Publicar', edit: 'Editar', remove: 'Remover', hide: 'Ocultar' }[row.operation];
  const pull = await okJson<{ number: number }>(
    await call(token, fetchImpl, `/repos/${CATALOG_REPO}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `${label} "${row.modId}" pelo site`,
        head: branchOf(row.modId),
        base,
        body: `Enviado pelo site: user: ${row.userId}, operação: ${row.operation}, submissão: ${row.id}.`,
      }),
    }),
  );
  return pull.number;
}

/**
 * O payload guardado usa a forma plana do site (origem: 'github' com repo/tag/arquivo na raiz, pagina nula);
 * o arquivo que o PR grava segue o schema do catálogo: origem vira objeto, pagina nula sai do arquivo e
 * dependências/imagens só entram quando existem. O agregado do catálogo desmonta de volta para a forma plana.
 */
function conteudoDoCatalogo(payload: string): string {
  const mod = JSON.parse(payload) as Record<string, unknown>;
  const github = mod['origem'] === 'github' ? mod : null;
  const externa = mod['origem'] === 'externa' ? mod : null;
  if (!github && !externa) throw new HttpError(400, 'invalid_payload');
  const origem = github
    ? { github: { repo: github['repo'], tag: github['tag'], arquivo: github['arquivo'] } }
    : { externa: { url: (externa as Record<string, unknown>)['url'] } };
  const dependencias = mod['dependencias'];
  const imagens = mod['imagens'];
  const pagina = mod['pagina'];
  const saida: Record<string, unknown> = {
    id: mod['id'],
    nome: mod['nome'],
    tipo: mod['tipo'],
    autor: mod['autor'],
    dono: mod['dono'],
    descricao: mod['descricao'],
    versoesDoJogo: mod['versoesDoJogo'],
    ...(Array.isArray(dependencias) && dependencias.length ? { dependencias } : {}),
    origem,
    ...(typeof pagina === 'string' && pagina !== '' ? { pagina } : {}),
    ...(Array.isArray(imagens) && imagens.length ? { imagens } : {}),
  };
  return JSON.stringify(saida, null, 2) + '\n';
}

/** Conteúdo que o PR grava para cada operação; null só em remove, que apaga o arquivo. */
async function contentFor(
  token: string,
  fetchImpl: typeof fetch,
  row: SubmissionForGithub,
  branch: string,
): Promise<{ content: string | null; existing: GithubFile | null }> {
  const existing = await currentFile(token, fetchImpl, row.modId, branch);
  if (row.operation === 'remove') {
    if (!existing) throw new HttpError(404, 'mod_not_found');
    return { content: null, existing };
  }
  if (row.operation === 'hide') {
    // Ocultar é um edit que só liga a flag: o conteúdo é o arquivo atual do repo, que é a versão canônica.
    if (!existing) throw new HttpError(404, 'mod_not_found');
    const mod = JSON.parse(existing.content) as Record<string, unknown>;
    mod['oculto'] = true;
    return { content: JSON.stringify(mod, null, 2) + '\n', existing };
  }
  if (!row.payload) throw new HttpError(400, 'invalid_payload');
  return { content: conteudoDoCatalogo(row.payload), existing };
}

/**
 * Publica a submissão no repo do catálogo: branch `site/<id>`, um commit só (o merge da Action recusa commits
 * que chegam depois da validação) e o PR de volta para o branch padrão.
 */
export async function publishToGithub(
  token: string | undefined,
  fetchImpl: typeof fetch,
  row: SubmissionForGithub,
): Promise<{ prNumber: number }> {
  if (!token) throw new HttpError(503, 'github_unavailable');
  await assertNoOpenPullRequest(token, fetchImpl, row.modId);
  const base = await defaultBranch(token, fetchImpl);
  const branch = branchOf(row.modId);
  await call(token, fetchImpl, `/repos/${CATALOG_REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: await branchHead(token, fetchImpl, base) }),
  });
  // 422 aqui significa branch de envio anterior que sobrou: o PUT abaixo reutiliza o que existe.
  // Falha real (rede, limite) sobe: engoli-la aqui transformaria "GitHub fora" em erro confuso depois.

  const { content, existing } = await contentFor(token, fetchImpl, row, branch);
  if (content === null) {
    await deleteFile(token, fetchImpl, row, branch, existing as GithubFile);
  } else {
    await putFile(token, fetchImpl, row, branch, content, existing);
  }
  if (row.coverBase64 && (row.operation === 'publish' || row.operation === 'edit')) {
    // Os dois commits acontecem antes do PR abrir: o head do PR já leva JSON e capa, sem corrida de validação.
    const coverPath = `/repos/${CATALOG_REPO}/contents/covers/${row.modId}.webp`;
    const resposta = await call(token, fetchImpl, `${coverPath}?ref=${branch}`);
    const atual = resposta.status === 404 ? null : await okJson<GithubFile>(resposta);
    await call(token, fetchImpl, coverPath, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Capa de ${row.modId} (via site, user: ${row.userId}, operação: ${row.operation})`,
        content: row.coverBase64,
        branch,
        ...(atual ? { sha: atual.sha } : {}),
      }),
    });
  }
  const prNumber = await openPullRequest(token, fetchImpl, row, base);
  return { prNumber };
}

/** Estado do PR do ponto de vista da submissão: merged entra, closed sem merge virou rejected. */
export async function pullRequestState(
  token: string | undefined,
  fetchImpl: typeof fetch,
  prNumber: number,
): Promise<'merged' | 'closed' | 'open' | null> {
  if (!token) return null;
  try {
    const pull = await okJson<{ state: string; merged: boolean }>(
      await call(token, fetchImpl, `/repos/${CATALOG_REPO}/pulls/${prNumber}`),
    );
    if (pull.merged) return 'merged';
    if (pull.state === 'closed') return 'closed';
    return 'open';
  } catch (error) {
    // Consulta de status não pode derrubar a listagem: sem GitHub, a linha fica como está.
    if (!(error instanceof HttpError)) throw error;
    console.warn(JSON.stringify({ warning: 'pr_status_unavailable', prNumber }));
    return null;
  }
}
