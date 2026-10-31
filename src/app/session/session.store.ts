import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly role: 'user' | 'moderator' | 'admin';
}

interface MeResponse {
  user: SessionUser | null;
  turnstileSiteKey: string;
}

/**
 * Quem está logado. O estado começa "não carregado" no servidor e no cliente, para o HTML pré-renderizado bater
 * com a primeira renderização do navegador; load() só roda no navegador.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);

  private readonly state = signal<{ loaded: boolean; user: SessionUser | null; siteKey: string }>({
    loaded: false,
    user: null,
    siteKey: '',
  });

  readonly loaded = computed(() => this.state().loaded);
  readonly user = computed(() => this.state().user);
  /** Chave pública do Turnstile; vazia quando a API não respondeu ou o login está desligado. */
  readonly siteKey = computed(() => this.state().siteKey);

  async load(): Promise<void> {
    try {
      const me = await firstValueFrom(this.http.get<MeResponse>('/api/me'));
      this.state.set({ loaded: true, user: me.user, siteKey: me.turnstileSiteKey });
    } catch {
      // Sem API (ng serve sem as Functions, ou fora do ar): o site segue só leitura, sem login.
      this.state.set({ loaded: true, user: null, siteKey: '' });
    }
  }

  private setUser(user: SessionUser): void {
    this.state.update((s) => ({ ...s, user }));
  }

  async register(
    username: string,
    password: string,
    turnstileToken: string,
  ): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: SessionUser }>('/api/auth/register', {
        username,
        password,
        turnstileToken,
      }),
    );
    this.setUser(user);
  }

  async login(username: string, password: string, turnstileToken: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: SessionUser }>('/api/auth/login', {
        username,
        password,
        turnstileToken,
      }),
    );
    this.setUser(user);
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/session'));
    this.state.update((s) => ({ ...s, user: null }));
  }

  /** O username é login e nome público; trocar muda os dois, e o servidor registra o evento. */
  async setUsername(username: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.put<{ user: SessionUser }>('/api/me/username', { username }),
    );
    this.setUser(user);
  }

  /** Trocar senha derruba as outras sessões; o servidor re-emite o cookie desta navegação. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.put<{ user: SessionUser }>('/api/me/password', { currentPassword, newPassword }),
    );
    this.setUser(user);
  }
}
