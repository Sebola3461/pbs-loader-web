import { expect } from 'vitest';
import { HttpError } from '../http';

/** Hash falsa com comprimento válido para o CHECK do banco; nunca é verificada nos testes. */
export const FAKE_HASH =
  'pbkdf2$sha256$10000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}
