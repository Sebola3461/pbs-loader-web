const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const encodeJson = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));

export const TEST_CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';

/** Emissor falso de ID tokens: um par RSA, o JWKS público e uma função que assina como o Google. */
export async function createGoogleIssuer(kid = 'chave-1') {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid,
    alg: 'RS256',
    use: 'sig',
  };

  async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
    const head = encodeJson({ alg: 'RS256', kid, typ: 'JWT', ...header });
    const body = encodeJson(payload);
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      encoder.encode(`${head}.${body}`),
    );
    return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
  }

  function validPayload(now: Date, overrides: Record<string, unknown> = {}) {
    const s = Math.floor(now.getTime() / 1000);
    return {
      iss: 'https://accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: '1234567890',
      iat: s - 10,
      exp: s + 3600,
      ...overrides,
    };
  }

  return { jwk, sign, validPayload };
}

/** fetch falso: responde o JWKS e o catálogo, e conta as chamadas. */
export function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`fetch inesperado: ${url}`);
    return route();
  }) as typeof fetch;
  return { impl, calls };
}
