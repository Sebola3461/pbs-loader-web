import { CatalogMod, MOD_TYPES, ModOwner, ModType } from './catalog.model';

export const MOD_TYPE_LABELS: Readonly<Record<ModType, string>> = {
  plugin: 'Plugin',
  onibus: 'Ônibus',
  mapa: 'Mapa',
  skin: 'Skin',
  destino: 'Destino',
  som: 'Som',
  outro: 'Outro',
};

/** Valores que aparecem na URL (?ordem=), por isso em português. */
export const SORT_KEYS = ['recentes', 'avaliacao', 'nome', 'antigos'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  recentes: 'Atualizados recentemente',
  avaliacao: 'Melhor avaliados',
  nome: 'Nome (A–Z)',
  antigos: 'Publicados há mais tempo',
};

export interface RatingSummary {
  readonly count: number;
  readonly average: number;
}

/** Quantos votos "imaginários" na média geral cada mod começa tendo. */
const BAYES_PRIOR_VOTES = 5;

/**
 * Média bayesiana: puxa a média de quem tem poucos votos para a média geral, para um único voto 5 não passar à
 * frente de vinte votos 4,8. Mod sem voto fica com a média geral.
 */
export function bayesianScores(
  stats: Readonly<Record<string, RatingSummary>>,
): (modId: string) => number {
  const all = Object.values(stats);
  const votes = all.reduce((sum, s) => sum + s.count, 0);
  const mean = votes ? all.reduce((sum, s) => sum + s.average * s.count, 0) / votes : 0;
  return (modId) => {
    const s = stats[modId];
    if (!s) return mean;
    return (BAYES_PRIOR_VOTES * mean + s.average * s.count) / (BAYES_PRIOR_VOTES + s.count);
  };
}

export interface ModFilters {
  readonly query: string;
  readonly type: ModType | '';
  /** Slug do autor (authorSlug). */
  readonly author: string;
  readonly gameVersion: string;
  readonly sort: SortKey;
}

export const EMPTY_FILTERS: ModFilters = {
  query: '',
  type: '',
  author: '',
  gameVersion: '',
  sort: 'recentes',
};

export const MAX_QUERY_LENGTH = 100;

export interface Author {
  readonly slug: string;
  readonly nome: string;
  readonly modCount: number;
}

export interface DownloadLink {
  readonly url: string;
  readonly label: string;
  readonly external: boolean;
}

/** Endereço estável da página do autor: o dono não muda quando o apelido exibido muda. */
export function authorSlug(owner: ModOwner): string {
  return 'github' in owner ? `gh-${owner.github.toLowerCase()}` : `site-${owner.site}`;
}

/** Minúsculas e sem acento, para "onibus" achar "Ônibus". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function filterMods(mods: readonly CatalogMod[], filters: ModFilters): CatalogMod[] {
  const query = normalizeText(filters.query);
  return mods.filter(
    (mod) =>
      (!filters.type || mod.tipo === filters.type) &&
      (!filters.author || authorSlug(mod.dono) === filters.author) &&
      (!filters.gameVersion || mod.versoesDoJogo.includes(filters.gameVersion)) &&
      (!query ||
        normalizeText(`${mod.nome} ${mod.id} ${mod.autor} ${mod.descricao}`).includes(query)),
  );
}

const compareNames = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

// Data ausente (arquivo sem histórico no catálogo) vai para o fim nas duas ordens por data.
function compareDates(a: string | null, b: string | null, direction: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -direction : direction;
}

export function sortMods(
  mods: readonly CatalogMod[],
  order: SortKey,
  stats: Readonly<Record<string, RatingSummary>> = {},
): CatalogMod[] {
  const byName = (a: CatalogMod, b: CatalogMod) => compareNames(a.nome, b.nome);
  const sorted = [...mods];
  if (order === 'nome') return sorted.sort(byName);
  if (order === 'avaliacao') {
    const score = bayesianScores(stats);
    const rated = (mod: CatalogMod) => (stats[mod.id] ? 1 : 0);
    return sorted.sort((a, b) => rated(b) - rated(a) || score(b.id) - score(a.id) || byName(a, b));
  }
  if (order === 'antigos') {
    return sorted.sort((a, b) => compareDates(a.criadoEm, b.criadoEm, 1) || byName(a, b));
  }
  return sorted.sort((a, b) => compareDates(a.atualizadoEm, b.atualizadoEm, -1) || byName(a, b));
}

/** O nome exibido do autor é o do mod atualizado mais recentemente, porque o apelido pode mudar. */
export function listAuthors(mods: readonly CatalogMod[]): Author[] {
  const bySlug = new Map<string, { nome: string; modCount: number }>();
  for (const mod of sortMods(mods, 'recentes')) {
    const slug = authorSlug(mod.dono);
    const current = bySlug.get(slug);
    if (current) current.modCount++;
    else bySlug.set(slug, { nome: mod.autor, modCount: 1 });
  }
  return [...bySlug]
    .map(([slug, author]) => ({ slug, ...author }))
    .sort((a, b) => compareNames(a.nome, b.nome));
}

export function listGameVersions(mods: readonly CatalogMod[]): string[] {
  return [...new Set(mods.flatMap((m) => m.versoesDoJogo))].sort((a, b) =>
    b.localeCompare(a, 'en', { numeric: true }),
  );
}

interface ParamReader {
  get(name: string): string | null;
}

const isModType = (value: string): value is ModType =>
  (MOD_TYPES as readonly string[]).includes(value);
const isSortKey = (value: string): value is SortKey =>
  (SORT_KEYS as readonly string[]).includes(value);

/**
 * Filtros a partir da URL. Autor e versão desconhecidos (link antigo, autor que saiu do catálogo) são descartados:
 * filtrariam tudo enquanto o select mostra "Todos".
 */
export function filtersFromParams(
  params: ParamReader,
  known: { authors: readonly Author[]; gameVersions: readonly string[] },
): ModFilters {
  const type = params.get('tipo') ?? '';
  const sort = params.get('ordem') ?? '';
  const author = params.get('autor') ?? '';
  const gameVersion = params.get('versao') ?? '';
  return {
    query: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    type: isModType(type) ? type : '',
    author: known.authors.some((a) => a.slug === author) ? author : '',
    gameVersion: known.gameVersions.includes(gameVersion) ? gameVersion : '',
    sort: isSortKey(sort) ? sort : EMPTY_FILTERS.sort,
  };
}

/** Parâmetros da URL; null remove o parâmetro, para o link ficar curto com os valores padrão. */
export function filtersToParams(filters: ModFilters): Record<string, string | null> {
  return {
    q: filters.query || null,
    tipo: filters.type || null,
    autor: filters.author || null,
    versao: filters.gameVersion || null,
    ordem: filters.sort === EMPTY_FILTERS.sort ? null : filters.sort,
  };
}

export function hasActiveFilters(filters: ModFilters): boolean {
  return Boolean(filters.query || filters.type || filters.author || filters.gameVersion);
}

/** O release mais novo é escolhido pelo instalador; o site aponta para a lista de releases do repositório. */
export function downloadLink(mod: CatalogMod): DownloadLink {
  if (mod.origem === 'github') {
    return {
      url: `https://github.com/${mod.repo}/releases`,
      label: 'Baixar no GitHub',
      external: false,
    };
  }
  return { url: mod.url, label: 'Abrir link externo', external: true };
}

/** Só plugin .dll vindo do GitHub entra no instalador (Catalogo.MergeCommunity no pbsu-loader). */
export function isInstallable(mod: CatalogMod): boolean {
  return (
    mod.tipo === 'plugin' && mod.origem === 'github' && mod.arquivo.toLowerCase().endsWith('.dll')
  );
}

const DATE_FORMATS = {
  long: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }),
  short: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' }),
};

/** long: "20 de outubro de 2026"; short (cartões): "20 de out. de 2026". */
export function formatDate(iso: string | null, style: 'long' | 'short' = 'long'): string {
  return iso ? DATE_FORMATS[style].format(new Date(iso)) : '—';
}
