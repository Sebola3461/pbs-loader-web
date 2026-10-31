import { HttpError } from './http';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface KeyCache {
  keys: Jwk[];
  expiresAt: number;
}

let keyCache: KeyCache | null = null;

export function resetGoogleKeyCache(): void {
  keyCache = null;
}

export interface VerifyOptions {
  clientId: string;
  now: Date;
  fetchImpl?: typeof fetch;
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

function decodeSignature(segment: string): Uint8Array<ArrayBuffer> {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// O Google troca as chaves de tempos em tempos e diz no Cache-Control por quanto tempo cada lista vale.
async function fetchKeys(fetchImpl: typeof fetch, now: number): Promise<KeyCache> {
  const res = await fetchImpl(GOOGLE_JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'google_unavailable');
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1];
  const body = (await res.json()) as { keys?: Jwk[] };
  return {
    keys: body.keys ?? [],
    expiresAt: now + (maxAge ? Number(maxAge) * 1000 : DEFAULT_KEYS_TTL_MS),
  };
}

async function findKey(
  kid: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<Jwk | undefined> {
  if (!keyCache || keyCache.expiresAt <= now) keyCache = await fetchKeys(fetchImpl, now);
  let key = keyCache.keys.find((k) => k.kid === kid);
  // Chave nova publicada antes de a lista em cache vencer: busca de novo uma vez.
  if (!key) {
    keyCache = await fetchKeys(fetchImpl, now);
    key = keyCache.keys.find((k) => k.kid === kid);
  }
  return key;
}

const invalid = () => new HttpError(401, 'invalid_token');

/**
 * Confere o ID token que o botão "Fazer login com o Google" entrega: assinatura RS256 com a chave pública do
 * Google, emissor, audiência (o client ID deste site) e validade. Devolve o "sub", o id estável da conta Google.
 */
export async function verifyGoogleIdToken(
  token: string,
  options: VerifyOptions,
): Promise<{ sub: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw invalid();
  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string; exp?: number; iat?: number; sub?: string };
  try {
    header = decodeSegment(parts[0]) as typeof header;
    payload = decodeSegment(parts[1]) as typeof payload;
  } catch {
    throw invalid();
  }
  if (header.alg !== 'RS256' || !header.kid) throw invalid();

  const nowMs = options.now.getTime();
  const jwk = await findKey(header.kid, options.fetchImpl ?? fetch, nowMs);
  if (!jwk) throw invalid();
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = decodeSignature(parts[2]);
  } catch {
    throw invalid();
  }
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed))) throw invalid();

  const nowS = nowMs / 1000;
  if (!payload.iss || !ISSUERS.has(payload.iss)) throw invalid();
  if (!options.clientId || payload.aud !== options.clientId) throw invalid();
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) throw invalid();
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > nowS) throw invalid();
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
    throw invalid();
  }
  return { sub: payload.sub };
}
