import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MOD_TYPE_LABELS } from '../../catalog/catalog';
import { CatalogStore } from '../../catalog/catalog.store';
import { apiErrorMessage } from '../../session/api-error';
import { SessionStore } from '../../session/session.store';

/** Formato do id de mod, igual ao que a API e o catálogo exigem. */
const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

interface SubmissionResult {
  submission: { id: string; modId: string; status: string; prNumber: number | null };
}

/**
 * Formulário de envio — e de edição/remoção, quando a rota traz autor e id. A chave de idempotência nasce quando
 * o formulário abre e só troca depois de um envio aceito: se a rede falhar no meio, reenviar a mesma chave não
 * cria dois mods.
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
  private readonly catalog = inject(CatalogStore);

  /** Parâmetros da rota de edição; presentes quando o formulário edita um mod existente. */
  readonly autor = input<string>();
  readonly id = input<string>();

  protected readonly editing = computed(() => Boolean(this.id() && this.autor()));
  protected readonly original = computed(() =>
    this.editing() ? this.catalog.findMod(this.id()!, this.autor()!) : null,
  );

  /** Valores atuais do mod para pré-preencher o formulário na edição. */
  protected readonly prefill = computed(() => {
    const mod = this.original();
    if (!mod) return null;
    const github = mod.origem === 'github' ? mod : null;
    const externa = mod.origem === 'externa' ? mod : null;
    return {
      nome: mod.nome,
      tipo: mod.tipo,
      descricao: mod.descricao,
      versoes: mod.versoesDoJogo.join(', '),
      dependencias: mod.dependencias.join(', '),
      pagina: mod.pagina ?? '',
      repo: github ? github.repo : '',
      tag: github ? github.tag : '',
      arquivo: github ? github.arquivo : '',
      url: externa ? externa.url : '',
    };
  });

  /** Editar pelo site é só para o dono da conta: autores do GitHub usam o catálogo direto. */
  protected readonly owner = computed(() => {
    const user = this.session.user();
    const mod = this.original();
    return Boolean(user && mod && 'site' in mod.dono && mod.dono.site === user.id);
  });
  protected readonly tipos = Object.entries(MOD_TYPE_LABELS);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly sent = signal<{ modId: string; prNumber: number | null; removed: boolean } | null>(null);
  protected readonly origem = signal<'github' | 'externa'>(
    (this.original()?.origem as 'github' | 'externa' | undefined) ?? 'github',
  );
  protected readonly removing = signal(false);
  private readonly erro = viewChild<ElementRef<HTMLElement>>('erro');
  private readonly removeDialog = viewChild.required<ElementRef<HTMLDialogElement>>('removeDialog');
  private idempotencyKey = crypto.randomUUID();

  /** Versões e dependências viram listas no cliente; vazio significar "sem" (o que é válido para dependências). */
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
    const modId = this.editing() ? this.id()! : value('id');
    const mod: Record<string, unknown> = {
      id: modId,
      nome: value('nome'),
      tipo: value('tipo'),
      descricao: value('descricao'),
      versoesDoJogo: versoes,
      dependencias,
      pagina: value('pagina') === '' ? null : value('pagina'),
      capa: null,
    };
    if (this.origem() === 'github') {
      mod['origem'] = 'github';
      mod['repo'] = value('repo');
      mod['tag'] = value('tag');
      mod['arquivo'] = value('arquivo');
    } else {
      mod['origem'] = 'externa';
      mod['url'] = value('url');
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<SubmissionResult>('/api/submissions', {
          operation: this.editing() ? 'edit' : 'publish',
          modId,
          idempotencyKey: this.idempotencyKey,
          mod,
        }),
      );
      this.sent.set({ modId: result.submission.modId, prNumber: result.submission.prNumber, removed: false });
      // Envio aceito encerra a chave: a próxima operação nasce com chave própria.
      this.idempotencyKey = crypto.randomUUID();
      form.reset();
    } catch (error) {
      this.fail(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected abrirRemocao(): void {
    this.removing.set(true);
    this.removeDialog().nativeElement.showModal();
  }

  protected cancelarRemocao(): void {
    this.removeDialog().nativeElement.close();
  }

  protected async remover(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.editing()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<SubmissionResult>('/api/submissions', {
          operation: 'remove',
          modId: this.id(),
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      this.removeDialog().nativeElement.close();
      this.sent.set({ modId: result.submission.modId, prNumber: result.submission.prNumber, removed: true });
    } catch (error) {
      // Fechar o diálogo no erro: a mensagem vive no formulário principal, atrás do modal.
      this.removeDialog().nativeElement.close();
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
