import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authorSlug } from '../../catalog/catalog';
import { CatalogStore } from '../../catalog/catalog.store';
import { apiErrorMessage } from '../../session/api-error';
import { SessionStore } from '../../session/session.store';

interface SubmissionRow {
  id: string;
  modId: string;
  operation: string;
  payload: string | null;
  idempotencyKey: string;
  status: string;
  prNumber: number | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Em publicação',
  merged: 'No catálogo',
  rejected: 'Recusado',
  failed: 'Falhou — tente de novo',
};

const OPERATION_LABELS: Record<string, string> = {
  publish: 'publicar',
  edit: 'editar',
  remove: 'remover',
  hide: 'ocultar',
};

/** Os envios da conta: o que está na fila, o que entrou e o que falhou (com botão de repetir). */
@Component({
  selector: 'app-my-submissions',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-submissions.html',
  styleUrl: './my-submissions.css',
})
export class MySubmissions {
  private readonly http = inject(HttpClient);
  protected readonly session = inject(SessionStore);
  private readonly catalog = inject(CatalogStore);

  // null = ainda carregando; lista vazia é estado válido (nenhum envio ainda).
  protected readonly rows = signal<SubmissionRow[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  constructor() {
    // No pré-render não há API nem sessão: a carga roda só no navegador.
    afterNextRender(() => void this.load());
  }

  protected async load(): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.http.get<{ submissions: SubmissionRow[] }>('/api/me/submissions'),
      );
      this.rows.set(result.submissions);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      this.rows.set([]);
    }
  }

  /** O reenvio usa a MESMA chave e o MESMO payload: a API repete a publicação sem criar segunda linha. */
  protected async retry(row: SubmissionRow): Promise<void> {
    this.busy.set(row.id);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post('/api/submissions', {
          operation: row.operation,
          modId: row.modId,
          idempotencyKey: row.idempotencyKey,
          ...(row.payload ? { mod: JSON.parse(row.payload) } : {}),
        }),
      );
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      // O estado da linha pode ter mudado (falhou de novo): recarregar mostra a verdade.
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }

  protected statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  protected operationLabel(operation: string): string {
    return OPERATION_LABELS[operation] ?? operation;
  }

  /** Página do mod só existe depois que ele entra no catálogo. */
  protected modLink(row: SubmissionRow): string[] | null {
    const mod = this.catalog.findMod(row.modId);
    return mod ? ['/mods', authorSlug(mod.dono), row.modId] : null;
  }
}
