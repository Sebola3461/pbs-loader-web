import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MOD_TYPE_LABELS } from '../../catalog/catalog';
import { apiErrorMessage } from '../../session/api-error';
import { SessionStore } from '../../session/session.store';

/** Formato do id de mod, igual ao que a API e o catálogo exigem. */
const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

interface SubmissionResult {
  submission: { id: string; modId: string; status: string };
}

/**
 * Formulário de envio de mod. A chave de idempotência nasce quando o formulário abre e só troca depois de um
 * envio aceito: se a rede falhar no meio, reenviar a mesma chave não cria dois mods.
 */
@Component({
  selector: 'app-submit',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './submit.html',
  styleUrl: './submit.css',
})
export class Submit {
  private readonly http = inject(HttpClient);
  protected readonly session = inject(SessionStore);

  protected readonly tipos = Object.entries(MOD_TYPE_LABELS);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly sent = signal<{ modId: string } | null>(null);
  protected readonly origem = signal<'github' | 'externa'>('github');
  private readonly erro = viewChild<ElementRef<HTMLElement>>('erro');
  private idempotencyKey = crypto.randomUUID();

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    const list = (name: string) =>
      value(name)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');

    const versoes = list('versoes');
    if (versoes.length === 0 || versoes.length > 10 || versoes.some((v) => v === '' || v.length > 10)) {
      this.fail('Informe de 1 a 10 versões do jogo, separadas por vírgula (ex.: 307, 306).');
      return;
    }
    const dependencias = list('dependencias');
    if (dependencias.length > 20 || dependencias.some((d) => !MOD_ID.test(d))) {
      this.fail('Cada dependência precisa ser o id de um mod: letras, números, "_" ou "-".');
      return;
    }
    const origem = this.origem();
    const modId = value('id');
    const base = {
      id: modId,
      nome: value('nome'),
      tipo: value('tipo'),
      descricao: value('descricao'),
      versoesDoJogo: versoes,
      dependencias,
      pagina: value('pagina') === '' ? null : value('pagina'),
      capa: null,
    };
    const mod =
      origem === 'github'
        ? { ...base, origem, repo: value('repo'), tag: value('tag'), arquivo: value('arquivo') }
        : { ...base, origem, url: value('url') };

    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<SubmissionResult>('/api/submissions', {
          operation: 'publish',
          modId,
          idempotencyKey: this.idempotencyKey,
          mod,
        }),
      );
      this.sent.set({ modId: result.submission.modId });
      // Envio aceito encerra a chave: o próximo mod nasce com chave própria.
      this.idempotencyKey = crypto.randomUUID();
      form.reset();
    } catch (error) {
      this.fail(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected novo(): void {
    this.sent.set(null);
    this.error.set(null);
  }

  protected mudarOrigem(event: Event): void {
    this.origem.set((event.target as HTMLInputElement).value as 'github' | 'externa');
  }

  private fail(message: string): void {
    this.error.set(message);
    this.busy.set(false);
    // Erro tem de ser alcançável: o foco vai para ele depois de falhar o envio.
    this.erro()?.nativeElement.focus();
  }
}
