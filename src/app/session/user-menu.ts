import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { apiErrorMessage } from './api-error';
import { GoogleButton } from './google-button';
import { NicknameForm } from './nickname-form';
import { SessionStore } from './session.store';

/** Área de login no cabeçalho: botão do Google, ou apelido e "Sair". Abre a escolha de apelido quando falta. */
@Component({
  selector: 'app-user-menu',
  imports: [GoogleButton, NicknameForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.user(); as user) {
      <div class="user">
        <button type="button" class="nickname" (click)="openDialog()" title="Trocar apelido">
          {{ user.nickname ?? 'Escolher apelido' }}
        </button>
        <button type="button" class="button button-secondary" (click)="signOut()">Sair</button>
      </div>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    } @else if (session.googleClientId(); as clientId) {
      <app-google-button [clientId]="clientId" />
    }
    <dialog #dialog aria-labelledby="apelido-titulo" (close)="dialogOpen.set(false)">
      @if (dialogOpen()) {
        <app-nickname-form (done)="closeDialog()" />
      }
    </dialog>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .user {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .nickname {
      min-height: 2.75rem;
      padding-inline: var(--space-2);
      font: inherit;
      font-weight: 600;
      color: var(--color-foreground);
      background: none;
      border: 0;
      cursor: pointer;
    }
    .nickname:hover {
      text-decoration: underline;
    }
    .error {
      font-size: 0.8125rem;
      color: var(--color-warning-fg);
    }
    dialog {
      width: min(26rem, 100% - 2rem);
      margin: auto;
      padding: var(--space-5);
      color: var(--color-foreground);
      background: var(--color-surface);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-lg);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
})
export class UserMenu {
  protected readonly session = inject(SessionStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly dialogOpen = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Logou pela primeira vez e ainda não tem apelido: pergunta na hora.
    effect(() => {
      if (this.session.needsNickname()) this.openDialog();
    });
  }

  protected openDialog(): void {
    this.dialogOpen.set(true);
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  protected closeDialog(): void {
    this.dialog().nativeElement.close();
  }

  protected async signOut(): Promise<void> {
    this.error.set(null);
    try {
      await this.session.signOut();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    }
  }
}
