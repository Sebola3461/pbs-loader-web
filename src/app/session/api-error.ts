import { HttpErrorResponse } from '@angular/common/http';

/** Mensagem para a pessoa a partir do código estável que a API devolve em { error }. */
const MESSAGES: Record<string, string> = {
  invalid_nickname:
    'Use de 3 a 24 letras, números, espaço, "_", "." ou "-", começando e terminando com letra ou número.',
  nickname_taken: 'Esse apelido já está em uso.',
  login_required: 'Entre com sua conta Google para continuar.',
  banned: 'Sua conta foi suspensa pelos moderadores.',
  own_mod: 'Você não pode avaliar o próprio mod.',
  too_many_changes: 'Muitas mudanças em pouco tempo. Tente de novo daqui a pouco.',
  invalid_token: 'Não deu para confirmar o login com o Google. Tente de novo.',
  google_unavailable: 'O Google não respondeu. Tente de novo em instantes.',
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
