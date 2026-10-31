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

/** Capa vem como caminho relativo do catálogo ("covers/<nome>.webp"); nada de URL externa nem outro formato. */
const CAPA_PATH = /^covers\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.webp$/;

interface SubmissionRow {
  id: string;
  mod_id: string;
  operation: string;
  payload: string | null;
  status: string;
  created_at: string;
}

/** O que volta para o formulário: só o que o cliente precisa acompanhar do próprio envio. */
function publicSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    modId: row.mod_id,
    operation: row.operation,
    status: row.status,
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

function githubSource(mod: Record<string, unknown>): Record<string, unknown> {
  const repo = str(mod.repo, 3, 100);
  if (!REPO.test(repo)) invalidPayload();
  return { origem: 'github', repo, tag: str(mod.tag, 1, 64), arquivo: str(mod.arquivo, 1, 128) };
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/**
 * Monta o JSON canônico do mod a partir do que o cliente mandou. Dono vira a conta logada (site), autor vira o
 * username, e confiável e datas ficam fora do controle do cliente: quem concede confiança é a moderação, e as
 * datas nascem do histórico do Git no catálogo.
 */
function modPayloadFrom(raw: unknown, user: User, modId: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalidPayload();
  const mod = raw as Record<string, unknown>;
  const id = str(mod.id, 2, 64);
  if (id !== modId || !MOD_ID.test(id)) invalidPayload();
  const tipo = mod.tipo;
  if (typeof tipo !== 'string' || !MOD_TYPES.includes(tipo as ModType)) invalidPayload();
  const pagina = mod.pagina === null ? null : httpsUrl(mod.pagina);
  const capa = mod.capa ?? null;
  if (capa !== null && (typeof capa !== 'string' || !CAPA_PATH.test(capa))) invalidPayload();
  const source =
    mod.origem === 'github'
      ? githubSource(mod)
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
    capa,
    confiavel: false,
    criadoEm: null,
    atualizadoEm: null,
  };
}

async function replay(
  db: Database,
  userId: string,
  key: string,
  operation: string,
  modId: string,
  payloadText: string | null,
): Promise<RouteResult | null> {
  const row = await db
    .prepare('SELECT * FROM submissions WHERE user_id = ? AND idempotency_key = ?')
    .bind(userId, key)
    .first<SubmissionRow>();
  if (!row) return null;
  if (row.operation !== operation || row.mod_id !== modId || row.payload !== payloadText) {
    throw new HttpError(409, 'idempotency_conflict');
  }
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

/**
 * Valida o envio, confere existência e posse no catálogo publicado e grava a submissão pending.
 * O reenvio com a mesma chave de idempotência devolve a submissão original: depois de um failed,
 * o cliente manda a mesma chave e não nasce um segundo PR.
 */
export async function recordSubmission(
  db: Database,
  user: User,
  body: unknown,
  mods: Map<string, CatalogEntry>,
  now: Date,
): Promise<RouteResult> {
  const operation = field(body, 'operation');
  if (typeof operation !== 'string' || !OPERATIONS.includes(operation as Operation)) {
    throw new HttpError(400, 'invalid_operation');
  }
  const modId = field(body, 'modId');
  if (typeof modId !== 'string' || !MOD_ID.test(modId)) throw new HttpError(400, 'invalid_mod_id');
  const key = field(body, 'idempotencyKey');
  if (typeof key !== 'string' || key.length < 8 || key.length > 64) {
    throw new HttpError(400, 'invalid_idempotency_key');
  }
  const withPayload = operation === 'publish' || operation === 'edit';
  const payloadText = withPayload
    ? JSON.stringify(modPayloadFrom(field(body, 'mod'), user, modId))
    : null;

  const existing = await replay(db, user.id, key, operation, modId, payloadText);
  if (existing) return existing;

  await requireDailyQuota(db, user.id, now);

  const entry = mods.get(modId);
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

  const id = uuidv7(now);
  const at = now.toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO submissions
           (id, user_id, mod_id, operation, payload, idempotency_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(id, user.id, modId, operation, payloadText, key, at, at)
      .run();
  } catch (error) {
    if (!isUniqueViolation(error, 'submissions.user_id')) throw error;
    // Corrida entre dois envios com a mesma chave: o primeiro vence, e comparar de novo dá o replay certo.
    const winner = await replay(db, user.id, key, operation, modId, payloadText);
    if (!winner) throw new HttpError(409, 'idempotency_conflict');
    return winner;
  }
  return {
    response: json(
      { submission: { id, modId, operation, status: 'pending', createdAt: at } },
      { status: 201 },
    ),
    userId: user.id,
  };
}
