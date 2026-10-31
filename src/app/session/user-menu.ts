import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { apiErrorMessage } from './api-error';
import { LoginForm } from './login-form';
import { PasswordForm } from './password-form';
import { SessionStore } from './session.store';
import { UsernameForm } from './username-form';

type DialogKind = 'username' | 'password';

/** Área de conta no cabeçalho: formulário de login, ou nome, senha e "Sair". */
@Component({
  selector: 'app-user-menu',
  imports: [LoginForm, PasswordForm, UsernameForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.user(); as user) {
      <div class="user">
        <button type="button" class="username" (click)="open('username')" title="Trocar nome">
          {{ user.username }}
        </button>
        <button
          type="button"
          class="button button-secondary"
          (click)="open('password')"
          title="Trocar senha"
        >
          Senha
        </button>
        <button type="button" class="button button-secondary" (click)="signOut()">Sair</button>
      </div>
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    } @else if (session.siteKey(); as siteKey) {
      <app-login-form [siteKey]="siteKey" />
    }
    <dialog #renameDialog aria-labelledby="nome-titulo" (close)="closed('username')">
      @if (isOpen('username')) {
        <app-username-form (done)="close('username')" />
      }
    </dialog>
    <dialog #passwordDialog aria-labelledby="senha-titulo" (close)="closed('password')">
      @if (isOpen('password')) {
        <app-password-form (done)="close('password')" />
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
    .username {
      min-height: 2.75rem;
      padding-inline: var(--space-2);
      font: inherit;
      font-weight: 600;
      color: var(--color-foreground);
      background: none;
      border: 0;
      cursor: pointer;
    }
    .username:hover {
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
  private readonly renameDialog = viewChild.required<ElementRef<HTMLDialogElement>>('renameDialog');
  private readonly passwordDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('passwordDialog');
  protected readonly openDialog = signal<DialogKind | null>(null);
  protected readonly error = signal<string | null>(null);

  protected isOpen(which: DialogKind): boolean {
    return this.openDialog() === which;
  }

  protected open(which: DialogKind): void {
    this.openDialog.set(which);
    const dialog = which === 'username' ? this.renameDialog() : this.passwordDialog();
    if (!dialog.nativeElement.open) dialog.nativeElement.showModal();
  }

  /** Chamado pelo botão dentro do diálogo e pelo próprio <dialog> (Esc). */
  protected close(which: DialogKind): void {
    const dialog = which === 'username' ? this.renameDialog() : this.passwordDialog();
    if (dialog.nativeElement.open) dialog.nativeElement.close();
  }

  protected closed(which: DialogKind): void {
    this.openDialog.update((current) => (current === which ? null : current));
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
