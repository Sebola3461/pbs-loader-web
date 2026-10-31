import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface SessionUser {
  readonly id: string;
  readonly nickname: string | null;
  readonly role: 'user' | 'moderator' | 'admin';
}

interface MeResponse {
  user: SessionUser | null;
  googleClientId: string;
}

/**
 * Quem está logado. O estado começa "não carregado" no servidor e no cliente, para o HTML pré-renderizado bater
 * com a primeira renderização do navegador; load() só roda no navegador.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);

  private readonly state = signal<{ loaded: boolean; user: SessionUser | null; clientId: string }>({
    loaded: false,
    user: null,
    clientId: '',
  });

  readonly loaded = computed(() => this.state().loaded);
  readonly user = computed(() => this.state().user);
  readonly googleClientId = computed(() => this.state().clientId);
  readonly needsNickname = computed(() => this.state().user?.nickname === null);

  async load(): Promise<void> {
    try {
      const me = await firstValueFrom(this.http.get<MeResponse>('/api/me'));
      this.state.set({ loaded: true, user: me.user, clientId: me.googleClientId });
    } catch {
      // Sem API (ng serve sem as Functions, ou fora do ar): o site segue só leitura, sem botão de login.
      this.state.set({ loaded: true, user: null, clientId: '' });
    }
  }

  async signIn(credential: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: SessionUser }>('/api/session', { credential }),
    );
    this.state.update((s) => ({ ...s, user }));
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/session'));
    this.state.update((s) => ({ ...s, user: null }));
  }

  async setNickname(nickname: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.put<{ user: SessionUser }>('/api/me/nickname', { nickname }),
    );
    this.state.update((s) => ({ ...s, user }));
  }
}
