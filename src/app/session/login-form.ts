import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { TurnstileApi, loadTurnstile } from './turnstile';

/**
 * Formulário próprio de conta: entrar ou criar conta, sempre com o Turnstile. O site não depende de Google:
 * o username é login e nome público ao mesmo tempo.
 */
@Component({
  selector: 'app-login-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="submit($event)">
      <h2>{{ mode() === 'entrar' ? 'Entrar' : 'Criar conta' }}</h2>
      <label for="usuario">Nome de usuário</label>
      <input
        id="usuario"
        name="usuario"
        type="text"
        autocomplete="username"
        spellcheck="false"
        minlength="3"
        maxlength="24"
        required
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="login-erro"
      />
      <label for="senha">Senha</label>
      <input
        id="senha"
        name="senha"
        type="password"
        required
        minlength="8"
        maxlength="128"
        [autocomplete]="mode() === 'entrar' ? 'current-password' : 'new-password'"
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="login-erro"
      />
      <div #widget class="widget"></div>
      <p id="login-erro" class="form-error" role="alert">{{ error() }}</p>
      <div class="form-actions">
        <button type="button" class="button-link" (click)="toggle()">
          {{ mode() === 'entrar' ? 'Criar conta' : 'Já tenho conta' }}
        </button>
        <button type="submit" class="button" [disabled]="busy() || !token()">
          {{ busy() ? 'Enviando…' : mode() === 'entrar' ? 'Entrar' : 'Criar conta' }}
        </button>
      </div>
    </form>
  `,
  // O resto do formulário (campos, erro, ações) usa o vocabulário global do design system (styles.css).
  styles: `
    .widget {
      min-height: 4.5rem;
    }
  `,
})
export class LoginForm {
  private readonly session = inject(SessionStore);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('widget');

  readonly siteKey = input.required<string>();

  protected readonly mode = signal<'entrar' | 'criar'>('entrar');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly token = signal<string | null>(null);
  private widgetId: string | null = null;
  private turnstile: TurnstileApi | null = null;

  constructor() {
    afterNextRender(() => void this.render());
    // Sair da página tira o widget do DOM do Cloudflare, senão ele reclama do elemento órfão.
    this.destroyRef.onDestroy(() => {
      if (this.widgetId) this.turnstile?.remove(this.widgetId);
    });
  }

  private async render(): Promise<void> {
    try {
      this.turnstile = await loadTurnstile(this.doc);
    } catch {
      this.error.set('O widget anti-robô não carregou. Desative bloqueadores e recarregue.');
      return;
    }
    this.widgetId = this.turnstile.render(this.host().nativeElement, {
      sitekey: this.siteKey(),
      callback: (token) => this.token.set(token),
      'expired-callback': () => this.token.set(null),
      'error-callback': () => this.token.set(null),
    });
  }

  protected toggle(): void {
    this.mode.update((mode) => (mode === 'entrar' ? 'criar' : 'entrar'));
    this.error.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const token = this.token();
    if (!token) return;
    const form = event.target as HTMLFormElement;
    const username = (form.elements.namedItem('usuario') as HTMLInputElement).value;
    const password = (form.elements.namedItem('senha') as HTMLInputElement).value;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.mode() === 'entrar') await this.session.login(username, password, token);
      else await this.session.register(username, password, token);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      // O token do Turnstile vale uma tentativa só: erro de senha pede um novo desafio.
      if (this.widgetId) this.turnstile?.reset(this.widgetId);
      this.token.set(null);
    } finally {
      this.busy.set(false);
    }
  }
}
