import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SessionStore } from './session.store';

export interface ModStats {
  readonly count: number;
  readonly average: number;
}

interface RatingResult {
  stats: ModStats | null;
}

/**
 * Médias de todos os mods (públicas, com cache de 60 s na borda) e as notas de quem está logado. As notas do
 * usuário recarregam quando a sessão muda.
 */
@Injectable({ providedIn: 'root' })
export class RatingsStore {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);

  readonly stats = signal<Readonly<Record<string, ModStats>>>({});
  readonly mine = signal<Readonly<Record<string, number>>>({});

  constructor() {
    // A sessão começa sem usuário; só uma troca de usuário recarrega ou limpa as notas.
    let currentUserId: string | null = null;
    effect(() => {
      const userId = this.session.user()?.id ?? null;
      if (userId === currentUserId) return;
      currentUserId = userId;
      if (userId) void this.loadMine();
      else this.mine.set({});
    });
  }

  async loadStats(): Promise<void> {
    try {
      const { mods } = await firstValueFrom(
        this.http.get<{ mods: Record<string, ModStats> }>('/api/stats'),
      );
      this.stats.set(mods);
    } catch {
      // Sem estatísticas, os mods aparecem sem estrelas; nada quebra.
    }
  }

  private async loadMine(): Promise<void> {
    try {
      const { ratings } = await firstValueFrom(
        this.http.get<{ ratings: Record<string, number> }>('/api/me/ratings'),
      );
      this.mine.set(ratings);
    } catch {
      this.mine.set({});
    }
  }

  async rate(modId: string, stars: number): Promise<void> {
    const result = await firstValueFrom(
      this.http.put<RatingResult>(`/api/mods/${encodeURIComponent(modId)}/rating`, { stars }),
    );
    this.mine.update((m) => ({ ...m, [modId]: stars }));
    this.applyStats(modId, result.stats);
  }

  async unrate(modId: string): Promise<void> {
    const result = await firstValueFrom(
      this.http.delete<RatingResult>(`/api/mods/${encodeURIComponent(modId)}/rating`),
    );
    this.mine.update((m) => {
      const { [modId]: _removed, ...rest } = m;
      return rest;
    });
    this.applyStats(modId, result.stats);
  }

  // A resposta da nota já traz a média nova daquele mod; buscar /api/stats de novo poderia vir do cache.
  private applyStats(modId: string, stats: ModStats | null): void {
    this.stats.update((all) => {
      const { [modId]: _old, ...rest } = all;
      return stats ? { ...rest, [modId]: stats } : rest;
    });
  }
}
