import { HttpError } from './http';

/**
 * Hash de senha com o KDF da plataforma: PBKDF2-SHA256 do WebCrypto nativo. Zero dependência, auditado pelo
 * runtime — nada de cripto escrito à mão aqui. O formato gravado é auto-descritivo, o que permite subir as
 * iterações no futuro sem quebrar as hashes antigas: "pbkdf2$sha256$<iterações>$<salt>$<hash>".
 */
const PREFIX = 'pbkdf2$sha256$';
const SALT_BYTES = 16;
const HASH_BITS = 256;
/** Conservador por padrão (OWASP 2023 pede 600 mil para PBKDF2-SHA256); medir CPU no staging antes de reduzir. */
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PASSWORD_CHARS = 8;
const MAX_PASSWORD_CHARS = 128;
const MAX_ITERATIONS = 10_000_000;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Base64 inválida devolve null — hash estragada é senha errada, não exceção. */
function decode(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Comparação em tempo constante: cada byte sempre entra na conta, mesmo quando os tamanhos divergem. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) difference ^= (a[i] ?? 0xff) ^ (b[i] ?? 0xff);
  return difference === 0;
}

/**
 * Normalização para guardar e comparar: NFKC nos dois lados, 8 a 128 pontos de código. Sem regras de composição
 * (NIST 800-63B) — o que protege é o KDF, o throttle e o Turnstile, não exigir "1 maiúscula".
 */
export function normalizePassword(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_password');
  const password = raw.normalize('NFKC');
  const chars = Array.from(password).length;
  if (chars < MIN_PASSWORD_CHARS || chars > MAX_PASSWORD_CHARS)
    throw new HttpError(400, 'invalid_password');
  return password;
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${PREFIX}${iterations}$${encode(salt)}$${encode(hash)}`;
}

/** Hash fictício para o login gastar o mesmo tempo quando a conta não existe: o derive roda do mesmo jeito. */
export const DUMMY_HASH = `${PREFIX}${DEFAULT_ITERATIONS}$${encode(new Uint8Array(16))}$${encode(new Uint8Array(32))}`;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (
    stored !== `${parts[0]}$${parts[1]}$${parts[2]}$${parts[3]}$${parts[4]}` ||
    parts[0] !== 'pbkdf2' ||
    parts[1] !== 'sha256'
  )
    return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const salt = decode(parts[3]);
  const expected = decode(parts[4]);
  if (salt === null || expected === null) return false;
  const hash = await derive(password, salt, iterations);
  return constantTimeEqual(hash, expected);
}

/** Itens configuração vindos do env; fora da faixa plausível vale o padrão, sem surpresa. */
export function iterationsFromEnv(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > MAX_ITERATIONS)
    return DEFAULT_ITERATIONS;
  return parsed;
}
