import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { apiErrorMessage } from './api-error';
import { SessionStore } from './session.store';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (r: { credential: string }) => void;
      }): void;
      renderButton(element: HTMLElement, options: Record<string, string>): void;
    };
  };
}

let gisLoading: Promise<GoogleIdentity> | null = null;

export function resetGoogleIdentity(): void {
  gisLoading = null;
}

/** Carrega a biblioteca do Google uma vez só, mesmo com vários botões na página. */
export function loadGoogleIdentity(doc: Document): Promise<GoogleIdentity> {
  gisLoading ??= new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () =>
      resolve((doc.defaultView as unknown as { google: GoogleIdentity }).google);
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('não carregou o login do Google'));
    };
    doc.head.appendChild(script);
  });
  return gisLoading;
}

/** Botão "Fazer login com o Google". O ID token vai para /api/session, que cria a sessão. */
@Component({
  selector: 'app-google-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #button class="button-host"></div>
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .button-host {
      min-height: 2.5rem;
      color-scheme: normal;
    }
    .error {
      max-width: 18rem;
      font-size: 0.8125rem;
      color: var(--color-warning-fg);
    }
  `,
})
export class GoogleButton {
  private readonly session = inject(SessionStore);
  private readonly doc = inject(DOCUMENT);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('button');

  readonly clientId = input.required<string>();
  protected readonly error = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.render());
  }

  private async render(): Promise<void> {
    try {
      const google = await loadGoogleIdentity(this.doc);
      google.accounts.id.initialize({
        client_id: this.clientId(),
        callback: ({ credential }) => void this.signIn(credential),
      });
      google.accounts.id.renderButton(this.host().nativeElement, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        locale: 'pt-BR',
      });
    } catch {
      this.error.set(
        'O login do Google não carregou. Desative bloqueadores para este site e recarregue.',
      );
    }
  }

  private async signIn(credential: string): Promise<void> {
    this.error.set(null);
    try {
      await this.session.signIn(credential);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    }
  }
}
