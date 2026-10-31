import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { apiErrorMessage } from './api-error';
import { SessionStore } from './session.store';

/**
 * Troca de senha: pede a atual, define a nova. O servidor derruba todas as sessões ao trocar e re-emite o cookie
 * desta navegação — quem copiou um cookie antigo fica fora.
 */
@Component({
  selector: 'app-password-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="submit($event)">
      <h2 id="senha-titulo">Trocar senha</h2>
      <p class="form-hint">Ao trocar, as outras sessões são encerradas.</p>
      <label for="senha-atual">Senha atual</label>
      <input
        id="senha-atual"
        name="atual"
        type="password"
        autocomplete="current-password"
        required
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="senha-erro"
      />
      <label for="nova-senha">Nova senha</label>
      <input
        id="nova-senha"
        name="nova"
        type="password"
        autocomplete="new-password"
        required
        minlength="8"
        maxlength="128"
        [attr.aria-invalid]="error() ? 'true' : null"
        aria-describedby="senha-erro"
      />
      <p id="senha-erro" class="form-error" role="alert">{{ error() ?? success() }}</p>
      <div class="form-actions">
        <button type="button" class="button button-secondary" (click)="done.emit()">
          Fechar
        </button>
        <button type="submit" class="button" [disabled]="saving()">
          {{ saving() ? 'Salvando…' : 'Trocar senha' }}
        </button>
      </div>
    </form>
  `,
  // Estilos vêm do design system global (styles.css): .form, .form-hint, .form-error, .form-actions.
})
export class PasswordForm {
  private readonly session = inject(SessionStore);

  readonly done = output<void>();
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly saving = signal(false);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const current = (form.elements.namedItem('atual') as HTMLInputElement).value;
    const next = (form.elements.namedItem('nova') as HTMLInputElement).value;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.session.changePassword(current, next);
      // Fecha na hora: o diálogo que chama é quem mostra o resultado (ou nada, como é o caso).
      this.done.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
