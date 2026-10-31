import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { apiErrorMessage } from './api-error';
import { SessionStore } from './session.store';

/**
 * Escolha do apelido público. O nome do perfil do Google é o nome real da pessoa, então o site nunca o mostra:
 * no primeiro login a pessoa escolhe como quer aparecer.
 */
@Component({
  selector: 'app-nickname-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="submit($event)">
      <h2 id="apelido-titulo">Como você quer aparecer?</h2>
      <p class="hint">
        Esse apelido aparece nos mods que você publicar. Seu nome e seu e-mail do Google não
        aparecem no site.
      </p>
      <label for="apelido">Apelido</label>
      <input
        id="apelido"
        name="apelido"
        autocomplete="nickname"
        minlength="3"
        maxlength="24"
        required
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="apelido-erro"
        [value]="current() ?? ''"
      />
      <p id="apelido-erro" class="error" role="alert">{{ error() }}</p>
      <div class="actions">
        @if (current()) {
          <button type="button" class="button button-secondary" (click)="done.emit()">
            Cancelar
          </button>
        }
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
export class NicknameForm {
  private readonly session = inject(SessionStore);

  readonly done = output<void>();
  protected readonly current = () => this.session.user()?.nickname ?? null;
  protected readonly error = signal('');
  protected readonly saving = signal(false);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const input = (event.target as HTMLFormElement).elements.namedItem(
      'apelido',
    ) as HTMLInputElement;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.session.setNickname(input.value);
      this.done.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
