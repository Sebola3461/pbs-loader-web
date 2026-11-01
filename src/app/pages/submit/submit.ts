import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string }>;
}

interface GithubRepo {
  default_branch: string;
}

interface GithubTree {
  tree: Array<{ path: string; type: string }>;
}

/** Extensões aceitas como imagem de galeria. */
const IMAGEM_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const MAX_IMAGENS = 10;
/** Mesma regra do servidor para dono/repo. */
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** Tipos que o catálogo distribui só por link externo. */
const SO_EXTERNA: ReadonlySet<string> = new Set(['onibus', 'mapa']);
/** Pausa entre o autor parar de digitar e a busca no GitHub sair. */
const DEBOUNCE_MS = 600;

/**
 * Extrai dono/repo tanto de "dono/repo" quanto de um link completo do GitHub
 * (https://github.com/dono/repo/…, com ou sem .git e barra final).
 */
export function normalizarRepo(valor: string): string {
  const partes = valor
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\/?/i, '')
    .replace(/\.git$/i, '')
    .split(/[/?#]/)
    .filter(Boolean);
  return partes.length >= 2 ? `${partes[0]}/${partes[1]}` : '';
}

/**
 * Deriva o prefixo de tag do nome de uma tag existente: FreeWalk-v1.0 → FreeWalk-v.
 * Mantém o "v" porque é o padrão usado pelos mods do catálogo; tags sem versão ficam como estão.
 */
export function prefixoDeTag(tag: string): string {
  return tag.replace(/[\d.]+$/, '').replace(/[-_. ]+$/, '') || tag;
}

/**
 * Formulário de envio — e de edição/remoção, quando a rota traz autor e id. O id do mod nasce no
 * servidor, derivado do nome (o formulário nem mostra o campo); versões, releases e imagens vêm de
 * listas — do catálogo e da API pública do GitHub. A chave de idempotência nasce quando o formulário
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
    const externa = mod.origem === 'externa' ? mod : null;
    return {
      nome: mod.nome,
      tipo: mod.tipo,
      descricao: mod.descricao,
      versoes: mod.versoesDoJogo.join(', '),
      pagina: mod.pagina ?? '',
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

  // Campos guiados por signal: o mesmo valor alimenta o envio e as sugestões do GitHub.
  protected readonly tipo = signal('plugin');
  /** Ônibus e mapa não têm arquivo nem release: só link externo de download. */
  protected readonly somenteExterna = computed(() => SO_EXTERNA.has(this.tipo()));
  protected readonly origemEfetiva = computed(() =>
    this.somenteExterna() ? 'externa' : this.origem(),
  );
  protected readonly repo = signal('');
  protected readonly tagValor = signal('');
  protected readonly arquivoValor = signal('');
  protected readonly galeriaRepo = signal('');
  /** Dependências não são editadas pelo site; na edição elas seguem como estão. */
  protected readonly dependencias = computed(() => this.original()?.dependencias ?? []);

  // Releases do repositório: sugestões de prefixo de tag (datalist) e de arquivo.
  protected readonly tagsGithub = signal<string[]>([]);
  protected readonly assetsGithub = signal<string[]>([]);
  protected readonly buscandoReleases = signal(false);
  protected readonly avisoReleases = signal<string | null>(null);
  protected readonly sugestoesTag = computed(() => [
    ...new Set(this.tagsGithub().map(prefixoDeTag)),
  ]);

  // Galeria: imagens listadas da árvore do repositório, escolhidas pelo autor.
  protected readonly imagensGaleria = signal<Array<{ url: string; label: string }>>([]);
  protected readonly buscandoImagens = signal(false);
  protected readonly avisoImagens = signal<string | null>(null);
  protected readonly imagensSelecionadas = signal<Set<string>>(new Set());

  private readonly preenchido = signal(false);
  private readonly erro = viewChild<ElementRef<HTMLElement>>('erro');
  private readonly removeDialog = viewChild.required<ElementRef<HTMLDialogElement>>('removeDialog');
  private idempotencyKey = crypto.randomUUID();
  private repoTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.repoTimer));
    // Na edição, as seleções partem do estado atual do mod (a pré-preencher roda uma vez).
    effect(() => {
      const mod = this.original();
      if (this.editing() && mod && !this.preenchido()) {
        this.versoesSelecionadas.set(new Set(mod.versoesDoJogo));
        this.tipo.set(mod.tipo);
        this.imagensSelecionadas.set(new Set(mod.imagens ?? []));
        const github = mod.origem === 'github' ? mod : null;
        if (github) {
          this.repo.set(github.repo);
          this.tagValor.set(github.tag);
          this.arquivoValor.set(github.arquivo);
          this.galeriaRepo.set(github.repo);
          // Repo já conhecido: as sugestões chegam sozinhas, como no envio novo.
          this.repoTimer = setTimeout(() => void this.buscarReleases(), DEBOUNCE_MS);
        }
        this.preenchido.set(true);
      }
    });
  }

  protected versaoSelecionada(versao: string): boolean {
    return this.versoesSelecionadas().has(versao);
  }

  /** O select múltiplo é a única fonte: o evento change traz tudo que está marcado. */
  protected alternarVersoes(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.versoesSelecionadas.set(new Set([...select.selectedOptions].map((o) => o.value)));
  }

  protected atualizarTipo(event: Event): void {
    this.tipo.set((event.target as HTMLSelectElement).value);
    if (this.somenteExterna()) this.origem.set('externa');
  }

  protected atualizarRepo(event: Event): void {
    const valor = (event.target as HTMLInputElement).value;
    this.repo.set(valor);
    // Nas origens GitHub, imagens moram no mesmo repositório: a galeria acompanha.
    if (this.origemEfetiva() === 'github') this.galeriaRepo.set(valor);
    this.agendarBuscaReleases();
  }

  protected atualizarTag(event: Event): void {
    this.tagValor.set((event.target as HTMLInputElement).value);
  }

  protected atualizarArquivo(event: Event): void {
    this.arquivoValor.set((event.target as HTMLInputElement).value);
  }

  protected atualizarGaleriaRepo(event: Event): void {
    this.galeriaRepo.set((event.target as HTMLInputElement).value);
  }

  /** Repositório informado → releases chegam sozinhas depois de uma pequena pausa na digitação. */
  protected agendarBuscaReleases(): void {
    clearTimeout(this.repoTimer);
    this.repoTimer = setTimeout(() => void this.buscarReleases(), DEBOUNCE_MS);
  }

  /** Releases do repositório alimentam as sugestões de tag e de arquivo — uma chamada só. */
  protected async buscarReleases(): Promise<void> {
    const repo = normalizarRepo(this.repo());
    this.tagsGithub.set([]);
    this.assetsGithub.set([]);
    this.avisoReleases.set(null);
    if (!REPO.test(repo)) {
      this.avisoReleases.set('Repositório inválido: use dono/repo ou o link do GitHub.');
      return;
    }
    this.buscandoReleases.set(true);
    this.error.set(null);
    try {
      const releases = await firstValueFrom(
        this.http.get<GithubRelease[]>(`https://api.github.com/repos/${repo}/releases?per_page=20`),
      );
      this.tagsGithub.set(releases.map((r) => r.tag_name).filter(Boolean));
      this.assetsGithub.set([
        ...new Set(releases.flatMap((r) => r.assets.map((a) => a.name)).filter(Boolean)),
      ]);
      if (!this.tagsGithub().length) {
        this.avisoReleases.set(
          'O repositório ainda não tem releases: informe a tag e o arquivo à mão.',
        );
      } else {
        // Autocompleta com a sugestão mais óbvia, sem apagar o que o autor já escolheu.
        if (!this.tagValor()) this.tagValor.set(prefixoDeTag(this.tagsGithub()[0]));
        if (!this.arquivoValor() && this.assetsGithub().length) {
          this.arquivoValor.set(this.assetsGithub()[0]);
        }
      }
    } catch {
      this.avisoReleases.set(
        'Não consegui buscar as releases no GitHub. Confira o repositório — ou preencha a tag e o arquivo à mão.',
      );
    } finally {
      this.buscandoReleases.set(false);
    }
  }

  /** Lista as imagens da árvore do repositório (API pública, sem login) para o autor escolher. */
  protected async buscarImagens(): Promise<void> {
    const repo = normalizarRepo(this.galeriaRepo());
    if (!REPO.test(repo)) {
      this.fail('Informe o repositório das imagens: dono/repo ou o link do GitHub.');
      return;
    }
    this.buscandoImagens.set(true);
    this.avisoImagens.set(null);
    this.error.set(null);
    try {
      const info = await firstValueFrom(
        this.http.get<GithubRepo>(`https://api.github.com/repos/${repo}`),
      );
      const galho = info.default_branch || 'main';
      const arvore = await firstValueFrom(
        this.http.get<GithubTree>(
          `https://api.github.com/repos/${repo}/git/trees/${galho}?recursive=1`,
        ),
      );
      this.imagensGaleria.set(
        arvore.tree
          .filter((arquivo) => arquivo.type === 'blob' && IMAGEM_EXT.test(arquivo.path))
          .slice(0, 60)
          .map((arquivo) => ({
            url: `https://raw.githubusercontent.com/${repo}/${galho}/${encodeURI(arquivo.path)}`,
            label: arquivo.path,
          })),
      );
      this.avisoImagens.set(
        this.imagensGaleria().length
          ? null
          : 'Nenhuma imagem (png, jpg, webp, gif ou avif) encontrada no repositório.',
      );
    } catch {
      this.fail('Não consegui listar as imagens do repositório. Verifique o endereço.');
    } finally {
      this.buscandoImagens.set(false);
    }
  }

  protected imagemSelecionada(url: string): boolean {
    return this.imagensSelecionadas().has(url);
  }

  protected alternarImagem(url: string, event: Event): void {
    const marcado = (event.target as HTMLInputElement).checked;
    if (marcado && this.imagensSelecionadas().size >= MAX_IMAGENS) {
      (event.target as HTMLInputElement).checked = false;
      this.fail(`No máximo ${MAX_IMAGENS} imagens na galeria.`);
      return;
    }
    this.imagensSelecionadas.update((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(url);
      else novo.delete(url);
      return novo;
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();

    // O id nasce no servidor a partir do nome; o formulário nem mostra o campo.
    if (!value('nome')) {
      this.fail('Escreva o nome do mod.');
      return;
    }

    // Com o catálogo conhecendo versões, é o select múltiplo; sem catálogo, o autor digita (fallback).
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
    const origem = this.origemEfetiva();
    if (origem === 'github') {
      const repo = normalizarRepo(this.repo());
      if (!REPO.test(repo)) {
        this.fail('Informe o repositório no formato dono/repo (ou o link do GitHub).');
        return;
      }
    }
    const galeria = [...this.imagensSelecionadas()];
    if (
      galeria.length > MAX_IMAGENS ||
      galeria.some((g) => !g.startsWith('https://raw.githubusercontent.com/'))
    ) {
      this.fail('A galeria aceita até 10 imagens do repositório (raw.githubusercontent.com).');
      return;
    }
    const mod: Record<string, unknown> = {
      nome: value('nome'),
      tipo: this.tipo(),
      descricao: value('descricao'),
      versoesDoJogo: versoes,
      dependencias: this.dependencias(),
      pagina: value('pagina') === '' ? null : value('pagina'),
    };
    // Na edição o id é fixo e volta no payload; no publish o servidor gera o id do nome.
    if (this.editing()) mod['id'] = this.id();
    if (origem === 'github') {
      mod['origem'] = 'github';
      mod['repo'] = normalizarRepo(this.repo());
      mod['tag'] = this.tagValor().trim();
      mod['arquivo'] = this.arquivoValor().trim();
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
          // Publish não manda id: o servidor gera do nome e devolve o id na resposta.
          ...(this.editing() ? { modId: this.id() } : {}),
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
      // Novo envio começa sem seleção nem sugestões; na edição a pré-seleção vem do próprio mod.
      if (!this.editing()) {
        this.tipo.set('plugin');
        this.origem.set('github');
        this.repo.set('');
        this.tagValor.set('');
        this.arquivoValor.set('');
        this.galeriaRepo.set('');
        this.versoesSelecionadas.set(new Set());
        this.imagensSelecionadas.set(new Set());
        this.imagensGaleria.set([]);
        this.tagsGithub.set([]);
        this.assetsGithub.set([]);
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
