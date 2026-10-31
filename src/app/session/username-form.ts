import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { apiErrorMessage } from './api-error';
import { SessionStore } from './session.store';

/**
 * Escolha/troca do nome público, que também é o login. Um nome só: o que aparece nos mods publicados é o que a
 * pessoa digita para entrar.
 */
@Component({
  selector: 'app-username-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="submit($event)">
      <h2 id="nome-titulo">Seu nome no site</h2>
      <p class="hint">
        Esse nome aparece nos mods que você publicar e também é o seu login. Se trocar, o novo nome
        passa a valer para entrar.
      </p>
      <label for="nome">Nome</label>
      <input
        id="nome"
        name="nome"
        autocomplete="username"
        spellcheck="false"
        minlength="3"
        maxlength="24"
        required
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="nome-erro"
        [value]="current() ?? ''"
      />
      <p id="nome-erro" class="error" role="alert">{{ error() }}</p>
      <div class="actions">
        <button type="button" class="button button-secondary" (click)="done.emit()">Cancelar</button>
        <button type="submit" class="button" [disabled]="saving()">
          {{ saving() ? 'Salvando…' : 'Salvar' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    h2 {
      font-size: 1.125rem;
    }
    .hint {
      color: var(--color-muted-foreground);
      font-size: 0.875rem;
      margin-bottom: var(--space-2);
    }
    input {
      width: 100%;
      min-height: 2.75rem;
      padding: var(--space-2) var(--space-3);
      font: inherit;
      color: var(--color-foreground);
      background: var(--color-background);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius);
    }
    .error {
      min-height: 1.25rem;
      font-size: 0.8125rem;
      color: var(--color-warning-fg);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `,
})
export class UsernameForm {
  private readonly session = inject(SessionStore);

  readonly done = output<void>();
  protected readonly current = () => this.session.user()?.username ?? null;
  protected readonly error = signal('');
  protected readonly saving = signal(false);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const input = (event.target as HTMLFormElement).elements.namedItem(
      'nome',
    ) as HTMLInputElement;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.session.setUsername(input.value);
      this.done.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
