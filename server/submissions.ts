import { CatalogEntry, MOD_ID, MOD_TYPES, ModType } from './catalog';
import { Database, isUniqueViolation } from './db';
import { field, HttpError, json, RouteResult } from './http';
import { uuidv7 } from './ids';
import { User } from './users';

/** Limite do ARQUITETURA.md: 5 envios por conta numa janela rolante de 24 horas. */
export const SUBMISSIONS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const OPERATIONS = ['publish', 'edit', 'remove', 'hide'] as const;
type Operation = (typeof OPERATIONS)[number];

/** O catálogo recusa PR com capa acima disso (mesmo limite do rules.mjs de lá). */
export const MAX_COVER_BYTES = 300 * 1024;

/**
 * Valida os bytes da capa mandados em base64: tem de ser WebP (assinatura RIFF/WEBP) e caber no limite.
 * O caminho do arquivo NUNCA vem do cliente — é derivado do id do mod (covers/<id>.webp).
 */
function capaValida(base64: unknown): string | null {
  if (base64 === undefined || base64 === null) return null;
  if (typeof base64 !== 'string' || base64.length === 0) invalidPayload();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    invalidPayload();
  }
  if (bytes.length > MAX_COVER_BYTES) invalidPayload();
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!riff || !webp) invalidPayload();
  return base64;
}

/**
 * Grava a submissão no repo do catálogo e devolve o número do PR. Falha com HttpError de código estável
 * (github_unavailable, pr_conflict): a linha vira failed e o reenvio com a mesma chave repete a publicação.
 */
export type Publisher = (row: {
  id: string;
  userId: string;
  modId: string;
  operation: Operation;
  payload: string | null;
  coverBase64: string | null;
}) => Promise<{ prNumber: number }>;

interface SubmissionInput {
  operation: Operation;
  modId: string;
  key: string;
  payloadText: string | null;
  cover: string | null;
}

interface SubmissionRow {
  id: string;
  mod_id: string;
  operation: string;
  payload: string | null;
  status: string;
  pr_number: number | null;
  created_at: string;
}

/** O que volta para o formulário: só o que o cliente precisa acompanhar do próprio envio. */
function publicSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    modId: row.mod_id,
    operation: row.operation,
    status: row.status,
    prNumber: row.pr_number,
    createdAt: row.created_at,
  };
}

function invalidPayload(): never {
  throw new HttpError(400, 'invalid_payload');
}

function str(raw: unknown, min: number, max: number): string {
  if (typeof raw !== 'string') invalidPayload();
  const text = raw.trim();
  if (text.length < min || text.length > max) invalidPayload();
  return text;
}

function httpsUrl(raw: unknown, max = 300): string {
  if (typeof raw !== 'string' || raw.length > max) invalidPayload();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalidPayload();
  }
  if (url.protocol !== 'https:') invalidPayload();
  return raw;
}

function strList(raw: unknown, min: number, max: number, eachMin: number, eachMax: number): string[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) invalidPayload();
  return raw.map((item) => str(item, eachMin, eachMax));
}

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 20) invalidPayload();
  return raw.map((item) => {
    const id = str(item, 2, 64);
    if (!MOD_ID.test(id)) invalidPayload();
    return id;
  });
}

function githubSource(mod: Record<string, unknown>, tipo: string): Record<string, unknown> {
  const repo = str(mod.repo, 3, 100);
  if (!REPO.test(repo)) invalidPayload();
  const arquivo = str(mod.arquivo, 1, 128);
  // O instalador só leva .dll para plugin e .zip para o resto: arquivo errado nasce rejeitado no catálogo.
  const wanted = tipo === 'plugin' ? '.dll' : '.zip';
  if (!arquivo.toLowerCase().endsWith(wanted)) invalidPayload();
  return { origem: 'github', repo, tag: str(mod.tag, 1, 64), arquivo };
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** Galeria do mod: imagens hospedadas no GitHub (o CSP do site só mostra imagens daí). */
const IMAGEM_URL = /^https:\/\/raw\.githubusercontent\.com\/[^\s]+$/;

function lerImagens(body: unknown): string[] {
  const raw = field(body, 'imagens');
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) invalidPayload();
  return raw.map((item) => {
    const url = str(item, 10, 500);
    if (!IMAGEM_URL.test(url)) invalidPayload();
    return url;
  });
}

/**
 * Monta o JSON canônico do mod a partir do que o cliente mandou. Dono vira a conta logada (site), autor vira o
 * username. O schema do catálogo é additionalProperties: false e NÃO tem capa, confiável nem datas: esses campos
 * pertencem ao agregado (a capa vem do arquivo covers/<id>.webp no PR, o confiável vem dos autores confiáveis e
 * as datas, do histórico do Git), então nunca entram no payload.
 */
function modPayloadFrom(
  raw: unknown,
  user: User,
  modId: string,
  imagens: string[],
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalidPayload();
  const mod = raw as Record<string, unknown>;
  const id = str(mod.id, 2, 64);
  if (id !== modId || !MOD_ID.test(id)) invalidPayload();
  const tipo = mod.tipo;
  if (typeof tipo !== 'string' || !MOD_TYPES.includes(tipo as ModType)) invalidPayload();
  // Ônibus e mapa são distribuídos por link externo: release do GitHub só faz sentido para o resto.
  if ((tipo === 'onibus' || tipo === 'mapa') && mod.origem === 'github') invalidPayload();
  const pagina = mod.pagina === null ? null : httpsUrl(mod.pagina);
  const source =
    mod.origem === 'github'
      ? githubSource(mod, tipo)
      : mod.origem === 'externa'
        ? { origem: mod.origem, url: httpsUrl(mod.url) }
        : invalidPayload();
  return {
    id,
    nome: str(mod.nome, 1, 80),
    tipo,
    autor: user.username,
    dono: { site: user.id },
    descricao: str(mod.descricao, 1, 2000),
    versoesDoJogo: strList(mod.versoesDoJogo, 1, 10, 1, 10),
    dependencias: idList(mod.dependencias),
    ...source,
    pagina,
    ...(imagens.length ? { imagens } : {}),
  };
}

/** Valida o corpo do envio e devolve o que o resto do fluxo usa; qualquer desvio vira 400 estável. */
function readSubmission(body: unknown, user: User, modId: string): SubmissionInput {
  const operation = field(body, 'operation');
  if (typeof operation !== 'string' || !OPERATIONS.includes(operation as Operation)) {
    throw new HttpError(400, 'invalid_operation');
  }
  const key = field(body, 'idempotencyKey');
  if (typeof key !== 'string' || key.length < 8 || key.length > 64) {
    throw new HttpError(400, 'invalid_idempotency_key');
  }
  const cover = capaValida(field(body, 'capaBase64'));
  const imagens = lerImagens(body);
  const withPayload = operation === 'publish' || operation === 'edit';
  const payloadText = withPayload
    ? JSON.stringify(modPayloadFrom(field(body, 'mod'), user, modId, imagens))
    : null;
  return { operation: operation as Operation, modId, key, payloadText, cover };
}

async function findReplayRow(db: Database, userId: string, key: string): Promise<SubmissionRow | null> {
  return db
    .prepare('SELECT * FROM submissions WHERE user_id = ? AND idempotency_key = ?')
    .bind(userId, key)
    .first<SubmissionRow>();
}

/** Mesma chave com outra intenção é conflito, não replay: evita trocar o conteúdo por engano. */
function ensureSameIntent(row: SubmissionRow, input: SubmissionInput): void {
  if (row.operation !== input.operation || row.mod_id !== input.modId || row.payload !== input.payloadText) {
    throw new HttpError(409, 'idempotency_conflict');
  }
}

function replayResponse(row: SubmissionRow, userId: string): RouteResult {
  return { response: json({ submission: publicSubmission(row) }), userId };
}

async function requireDailyQuota(db: Database, userId: string, now: Date): Promise<void> {
  // A própria tabela submissions é o registro: contar linhas nas últimas 24h dispensa mais um contador.
  // Duas submissões concorrentes no limite podem passar das 5; é trava anti-spam, não contabilidade.
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND created_at > ?')
    .bind(userId, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= SUBMISSIONS_PER_DAY) throw new HttpError(429, 'submission_limit');
}

/** Publicar cria mod novo; editar e remover exigem ser o dono; ocultar é papel de moderador. */
function authorizeOperation(
  operation: Operation,
  entry: CatalogEntry | undefined,
  user: User,
): void {
  const moderator = user.role === 'moderator' || user.role === 'admin';
  if (operation === 'publish') {
    // Publicar cria mod novo: id que já existe no catálogo é conflito, não substituição silenciosa.
    if (entry) throw new HttpError(409, 'mod_exists');
  } else if (!entry) {
    throw new HttpError(404, 'mod_not_found');
  } else if (operation === 'hide') {
    if (!moderator) throw new HttpError(403, 'forbidden');
  } else if (entry.dono.site !== user.id && !moderator) {
    throw new HttpError(403, 'not_owner');
  }
}

async function insertPendingRow(
  db: Database,
  user: User,
  input: SubmissionInput,
  now: Date,
): Promise<{ id: string; raceWinner: SubmissionRow | null }> {
  const id = uuidv7(now);
  const at = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO submissions
           (id, user_id, mod_id, operation, payload, idempotency_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(id, user.id, input.modId, input.operation, input.payloadText, input.key, at, at)
      .run();
    return { id, raceWinner: null };
  } catch (error) {
    if (!isUniqueViolation(error, 'submissions.user_id')) throw error;
    // Corrida entre dois envios com a mesma chave: o primeiro vence, e o segundo vira replay ou retry.
    const winner = await findReplayRow(db, user.id, input.key);
    if (!winner) throw new HttpError(409, 'idempotency_conflict');
    ensureSameIntent(winner, input);
    return { id: winner.id, raceWinner: winner };
  }
}

/**
 * Publica a submissão no catálogo e registra o resultado na linha: PR aberto guarda pr_number, falha de
 * publicação vira failed com o código estável — o reenvio com a mesma chave repete a publicação.
 */
async function publishRow(
  db: Database,
  userId: string,
  publish: Publisher,
  row: {
    id: string;
    modId: string;
    operation: Operation;
    payload: string | null;
    coverBase64: string | null;
  },
  at: string,
): Promise<RouteResult> {
  try {
    const { prNumber } = await publish({ ...row, userId });
    await db
      .prepare('UPDATE submissions SET pr_number = ?, updated_at = ? WHERE id = ?')
      .bind(prNumber, at, row.id)
      .run();
    return {
      response: json(
        { submission: { ...row, status: 'pending', createdAt: at, prNumber } },
        { status: 201 },
      ),
      userId,
    };
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'github_unavailable';
    await db
      .prepare("UPDATE submissions SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?")
      .bind(code, at, row.id)
      .run();
    throw error;
  }
}

/** Reenvio de uma submissão failed: volta a pending e repete a publicação, sem gastar quota nova. */
async function retryPendingRow(db: Database, row: SubmissionRow, at: string): Promise<void> {
  await db
    .prepare("UPDATE submissions SET status = 'pending', error_code = NULL, pr_number = NULL, updated_at = ? WHERE id = ?")
    .bind(at, row.id)
    .run();
}

/**
 * Valida o envio, confere existência e posse no catálogo publicado, grava a submissão pending e publica no
 * repo do catálogo. O reenvio com a mesma chave devolve a submissão original (ou repete a publicação, quando
 * ela falhou); sem o publisher, a linha fica pending sem PR — só os testes usam esse caminho.
 */
export async function recordSubmission(
  db: Database,
  user: User,
  body: unknown,
  mods: Map<string, CatalogEntry>,
  now: Date,
  publish?: Publisher,
): Promise<RouteResult> {
  const modId = field(body, 'modId');
  if (typeof modId !== 'string' || !MOD_ID.test(modId)) throw new HttpError(400, 'invalid_mod_id');
  const input = readSubmission(body, user, modId);
  const existing = await findReplayRow(db, user.id, input.key);
  if (existing) {
    ensureSameIntent(existing, input);
    return settleRow(db, user, input, existing, now, publish);
  }

  await requireDailyQuota(db, user.id, now);
  authorizeOperation(input.operation, mods.get(input.modId), user);
  const inserted = await insertPendingRow(db, user, input, now);
  if (inserted.raceWinner) {
    // O gêmeo venceu a corrida: mesma decisão do replay — pending responde 200, failed repete a publicação.
    return settleRow(db, user, input, inserted.raceWinner, now, publish);
  }
  const at = now.toISOString();
  if (!publish) {
    return {
      response: json(
        { submission: { id: inserted.id, modId: input.modId, operation: input.operation, status: 'pending', createdAt: at, prNumber: null } },
        { status: 201 },
      ),
      userId: user.id,
    };
  }
  return publishRow(
    db,
    user.id,
    publish,
    {
      id: inserted.id,
      modId: input.modId,
      operation: input.operation,
      payload: input.payloadText,
      coverBase64: input.cover,
    },
    at,
  );
}

/** Decide o destino de uma linha que já existe com a mesma intenção: pending responde, failed repete. */
async function settleRow(
  db: Database,
  user: User,
  input: SubmissionInput,
  row: SubmissionRow,
  now: Date,
  publish?: Publisher,
): Promise<RouteResult> {
  if (row.status !== 'failed') return replayResponse(row, user.id);
  // O reenvio com a mesma chave repete a publicação de uma submissão failed; não gasta quota nova
  // (a tentativa original já contou) e a linha volta a pending antes do PR.
  const at = now.toISOString();
  await retryPendingRow(db, row, at);
  if (!publish) {
    return replayResponse({ ...row, status: 'pending', pr_number: null }, user.id);
  }
  return publishRow(
    db,
    user.id,
    publish,
    {
      id: row.id,
      modId: input.modId,
      operation: input.operation,
      payload: input.payloadText,
      coverBase64: input.cover,
    },
    at,
  );
}
