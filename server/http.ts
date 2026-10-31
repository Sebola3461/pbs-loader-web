/** Erro com status e código estável; a mensagem nunca leva detalhe de infraestrutura. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const MAX_BODY_BYTES = 8 * 1024;

export function json(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function noContent(headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set('Cache-Control', 'no-store');
  return new Response(null, { status: 204, headers: result });
}

/**
 * Proteção contra CSRF nas escritas: o cookie de sessão é SameSite=Lax, e além disso o navegador precisa dizer que
 * a requisição saiu do próprio site.
 */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) throw new HttpError(403, 'bad_origin');
}

/** Corpo JSON pequeno; Content-Type de formulário fica de fora para um <form> de outro site não chegar aqui. */
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'json_required');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    throw new HttpError(413, 'body_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export interface RouteResult {
  response: Response;
  userId?: string;
}

/**
 * Envolve um handler: converte HttpError na resposta, esconde erro inesperado atrás de um 500 genérico e grava um
 * log JSON por requisição (rota, status, duração, usuário e o cf-ray para cruzar com o painel da Cloudflare).
 */
export async function runRoute(
  route: string,
  request: Request,
  handler: () => Promise<RouteResult>,
  log: (line: string) => void = console.log,
): Promise<Response> {
  const started = Date.now();
  let result: RouteResult;
  let failure: string | undefined;
  try {
    result = await handler();
  } catch (error) {
    if (error instanceof HttpError) {
      result = { response: json({ error: error.code }, { status: error.status }) };
    } else {
      failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      result = { response: json({ error: 'internal_error' }, { status: 500 }) };
    }
  }
  log(
    JSON.stringify({
      route,
      status: result.response.status,
      ms: Date.now() - started,
      user: result.userId ?? null,
      ray: request.headers.get('cf-ray'),
      ...(failure ? { error: failure } : {}),
    }),
  );
  return result.response;
}
