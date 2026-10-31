import { HttpErrorResponse } from '@angular/common/http';

/** Mensagem para a pessoa a partir do código estável que a API devolve em { error }. */
const MESSAGES: Record<string, string> = {
  invalid_username:
    'Use de 3 a 24 letras, números, espaço, "_", "." ou "-", começando e terminando com letra ou número.',
  username_taken: 'Esse nome já está em uso.',
  invalid_credentials: 'Usuário ou senha incorretos.',
  wrong_password: 'A senha atual não confere.',
  invalid_password: 'A senha precisa de 8 a 128 caracteres.',
  captcha_required: 'Confirme que você é humano para continuar.',
  captcha_invalid: 'A verificação anti-robô venceu. Tente de novo.',
  captcha_unavailable: 'A verificação anti-robô está fora do ar. Tente de novo em instantes.',
  too_many_attempts: 'Muitas tentativas. Tente de novo daqui a pouco.',
  login_required: 'Entre com sua conta para continuar.',
  banned: 'Sua conta foi suspensa pelos moderadores.',
  own_mod: 'Você não pode avaliar o próprio mod.',
  too_many_changes: 'Muitas mudanças em pouco tempo. Tente de novo daqui a pouco.',
  catalog_unavailable: 'O catálogo está fora do ar. Tente de novo em instantes.',
  mod_not_found: 'Este mod não está mais no catálogo.',
};

export function apiErrorMessage(error: unknown): string {
  const code =
    error instanceof HttpErrorResponse
      ? (error.error as { error?: string } | null)?.error
      : undefined;
  return (code && MESSAGES[code]) || 'Algo deu errado. Tente de novo.';
}
