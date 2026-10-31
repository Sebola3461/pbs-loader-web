import { HttpError } from './http';

/** Endereço de verificação do Turnstile. A chave secreta nunca sai do servidor; só o token chega do navegador. */
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Confirma o token do widget no serviço do Cloudflare. Falha fechada: rede fora do ar é 503, não "deixa passar".
 * O IP vai junto para o painel do Turnstile mostrar de onde vieram as tentativas.
 */
export async function verifyTurnstile(
  token: unknown,
  ip: string,
  secret: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (
    typeof token !== 'string' ||
    token.trim().length === 0 || // espaço em branco não é desafio cumprido
    token.length > 2048
  )
    throw new HttpError(400, 'captcha_required');
  if (!secret) throw new HttpError(503, 'captcha_unavailable');
  const form = new URLSearchParams({ secret, response: token, remoteip: ip });
  let payload: { success?: boolean };
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new HttpError(503, 'captcha_unavailable');
    payload = (await response.json()) as { success?: boolean };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'captcha_unavailable');
  }
  if (payload.success !== true) throw new HttpError(400, 'captcha_invalid');
}
