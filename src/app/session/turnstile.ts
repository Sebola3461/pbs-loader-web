const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ): string;
  reset(id?: string): void;
  remove(id: string): void;
}

let loading: Promise<TurnstileApi> | null = null;

export function resetTurnstileLoader(): void {
  loading = null;
}

/** Carrega o widget do Cloudflare uma vez só, mesmo com vários formulários na página. */
export function loadTurnstile(doc: Document): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () =>
      resolve((doc.defaultView as unknown as { turnstile: TurnstileApi }).turnstile);
    script.onerror = () => {
      loading = null;
      reject(new Error('não carregou o Turnstile'));
    };
    doc.head.appendChild(script);
  });
  return loading;
}
