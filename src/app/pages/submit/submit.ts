import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
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
import { converterParaWebp } from './webp';

interface SubmissionResult {
  submission: { id: string; modId: string; status: string; prNumber: number | null };
}

/**
 * Formulário de envio — e de edição/remoção, quando a rota traz autor e id. Versões e dependências são
 * selecionadas de listas do catálogo (nada digitado à mão); a chave de idempotência nasce quando o formulário
 * abre e só troca depois de um envio aceito.
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
      galeria: mod.imagens?.join('\n') ?? '',
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
  protected readonly gameVersions = this.catalog.gameVersions;
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly sent = signal<{ modId: string; prNumber: number | null; removed: boolean } | null>(null);
  protected readonly origem = signal<'github' | 'externa'>(
    (this.original()?.origem as 'github' | 'externa' | undefined) ?? 'github',
  );
  protected readonly capa = signal<{ nome: string; base64: string } | null>(null);
  protected readonly carregandoCapa = signal(false);
  protected readonly removing = signal(false);
  protected readonly versoesSelecionadas = signal<Set<string>>(new Set());
  protected readonly dependenciasEscolhidas = signal<string[]>([]);
  private readonly preenchido = signal(false);
  private readonly erro = viewChild<ElementRef<HTMLElement>>('erro');
  private readonly removeDialog = viewChild.required<ElementRef<HTMLDialogElement>>('removeDialog');
  private idempotencyKey = crypto.randomUUID();

  constructor() {
    // Na edição, as versões e dependências atuais do mod partem pré-marcadas.
    effect(() => {
      const mod = this.original();
      if (this.editing() && mod && !this.preenchido()) {
        this.versoesSelecionadas.set(new Set(mod.versoesDoJogo));
        this.dependenciasEscolhidas.set([...mod.dependencias]);
        this.preenchido.set(true);
      }
    });
  }

  protected versaoSelecionada(versao: string): boolean {
    return this.versoesSelecionadas().has(versao);
  }

  protected alternarVersao(versao: string, event: Event): void {
    const marcado = (event.target as HTMLInputElement).checked;
    this.versoesSelecionadas.update((marcadas) => {
      const atual = new Set(marcadas);
      if (marcado) atual.add(versao);
      else atual.delete(versao);
      return atual;
    });
  }

  /** Só mods que existem no catálogo podem ser dependência (menos o próprio, na edição). */
  protected readonly opcoesDependencia = computed(() => {
    const escolhidas = new Set(this.dependenciasEscolhidas());
    const proprioId = this.editing() ? this.id() : null;
    return this.catalog.mods
      .filter((m) => m.id !== proprioId && !escolhidas.has(m.id))
      .map((m) => ({ id: m.id, nome: m.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  });

  protected adicionarDependencia(id: string): void {
    if (!id || this.dependenciasEscolhidas().includes(id)) return;
    this.dependenciasEscolhidas.update((atual) => [...atual, id]);
  }

  protected removerDependencia(id: string): void {
    this.dependenciasEscolhidas.update((atual) => atual.filter((d) => d !== id));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();

    // Com o catálogo conhecendo versões, são checkboxes; sem catálogo, o autor digita (fallback).
    const versoes = this.gameVersions.length
      ? [...this.versoesSelecionadas()]
      : value('versao-manual')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '');
    if (versoes.length === 0 || versoes.length > 10) {
      this.fail('Selecione de 1 a 10 versões do jogo.');
      return;
    }
    if (versoes.some((v) => !/^\d{1,6}$/.test(v))) {
      this.fail('As versões do jogo são números de até 6 dígitos, como 307.');
      return;
    }
    const dependencias = this.dependenciasEscolhidas();
    if (dependencias.length > 20) {
      this.fail('No máximo 20 dependências.');
      return;
    }
    const galeria = value('galeria')
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    if (
      galeria.length > 10 ||
      galeria.some((g) => !g.startsWith('https://raw.githubusercontent.com/'))
    ) {
      this.fail('Cada endereço da galeria deve começar com https://raw.githubusercontent.com/ (máximo de 10).');
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
          capaBase64: this.capa()?.base64 ?? null,
          ...(galeria.length ? { imagens: galeria } : {}),
        }),
      );
      this.sent.set({ modId: result.submission.modId, prNumber: result.submission.prNumber, removed: false });
      // Envio aceito encerra a chave e a capa: a próxima operação nasce com chave própria.
      this.idempotencyKey = crypto.randomUUID();
      this.capa.set(null);
      // Novo envio começa sem seleção; na edição a pré-seleção vem do próprio mod.
      if (!this.editing()) {
        this.versoesSelecionadas.set(new Set());
        this.dependenciasEscolhidas.set([]);
      }
      form.reset();
    } catch (error) {
      this.fail(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** O arquivo escolhido vira WebP no navegador; o servidor só recebe os bytes prontos. */
  protected async definirCapa(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.capa.set(null);
      return;
    }
    this.carregandoCapa.set(true);
    this.error.set(null);
    try {
      const base64 = await converterParaWebp(file);
      this.capa.set({ nome: file.name, base64 });
    } catch (error) {
      this.capa.set(null);
      input.value = '';
      this.fail(error instanceof Error ? error.message : 'Não consegui converter a capa.');
    } finally {
      this.carregandoCapa.set(false);
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
