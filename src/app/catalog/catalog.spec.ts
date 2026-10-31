import { externalMod, githubMod, SITE_OWNER } from '../../testing/catalog-fixtures';
import {
  authorSlug,
  downloadLink,
  EMPTY_FILTERS,
  filterMods,
  filtersFromParams,
  filtersToParams,
  formatDate,
  hasActiveFilters,
  isInstallable,
  listAuthors,
  listGameVersions,
  normalizeText,
  sortMods,
} from './catalog';

const params = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe('catalog', () => {
  const painel = githubMod();
  const mapa = externalMod();
  const som = githubMod({
    id: 'SomDoMotor',
    nome: 'Som do Motor',
    descricao: 'Ônibus com som diesel.',
    versoesDoJogo: ['308'],
    criadoEm: '2026-10-01T00:00:00Z',
    atualizadoEm: null,
  });
  const all = [painel, mapa, som];

  it('authorSlug usa o dono, em minúsculas para o GitHub', () => {
    expect(authorSlug({ github: 'Fulana' })).toBe('gh-fulana');
    expect(authorSlug({ site: SITE_OWNER })).toBe(`site-${SITE_OWNER}`);
  });

  it('normalizeText tira acento e caixa', () => {
    expect(normalizeText('  Ônibus ÁGIL ')).toBe('onibus agil');
  });

  describe('filterMods', () => {
    it('sem filtro devolve tudo', () => {
      expect(filterMods(all, EMPTY_FILTERS)).toEqual(all);
    });

    it('busca em nome, id, autor e descrição sem acento', () => {
      const ids = (query: string) => filterMods(all, { ...EMPTY_FILTERS, query }).map((m) => m.id);
      expect(ids('onibus')).toEqual(['PainelDigital', 'SomDoMotor']);
      expect(ids('ciclano')).toEqual(['LinhaCentro']);
      expect(ids('linhacentro')).toEqual(['LinhaCentro']);
      expect(ids('nada disso')).toEqual([]);
    });

    it('filtra por tipo, autor e versão do jogo', () => {
      expect(filterMods(all, { ...EMPTY_FILTERS, type: 'mapa' })).toEqual([mapa]);
      expect(filterMods(all, { ...EMPTY_FILTERS, author: 'gh-fulana' })).toEqual([painel, som]);
      expect(filterMods(all, { ...EMPTY_FILTERS, gameVersion: '306' })).toEqual([mapa]);
      expect(filterMods(all, { ...EMPTY_FILTERS, type: 'plugin', gameVersion: '308' })).toEqual([
        som,
      ]);
    });
  });

  describe('sortMods', () => {
    it('recentes: atualização mais nova primeiro, sem data no fim', () => {
      expect(sortMods(all, 'recentes').map((m) => m.id)).toEqual([
        'PainelDigital',
        'LinhaCentro',
        'SomDoMotor',
      ]);
    });

    it('antigos: publicação mais antiga primeiro', () => {
      expect(sortMods(all, 'antigos').map((m) => m.id)).toEqual([
        'LinhaCentro',
        'PainelDigital',
        'SomDoMotor',
      ]);
    });

    it('nome, sem diferenciar acento e caixa', () => {
      expect(sortMods(all, 'nome').map((m) => m.nome)).toEqual([
        'Mapa Linha Centro',
        'Painel Digital',
        'Som do Motor',
      ]);
    });

    it('datas iguais ou ausentes desempatam pelo nome', () => {
      const a = githubMod({ id: 'A', nome: 'B', atualizadoEm: null, criadoEm: null });
      const b = githubMod({ id: 'B', nome: 'A', atualizadoEm: null, criadoEm: null });
      expect(sortMods([a, b], 'recentes').map((m) => m.id)).toEqual(['B', 'A']);
      expect(sortMods([a, b], 'antigos').map((m) => m.id)).toEqual(['B', 'A']);
      expect(sortMods([githubMod({ atualizadoEm: null }), mapa], 'recentes')[0]).toBe(mapa);
    });

    it('não altera a lista original', () => {
      const copy = [...all];
      sortMods(all, 'nome');
      expect(all).toEqual(copy);
    });
  });

  it('listAuthors agrupa pelo dono e usa o apelido do mod mais recente', () => {
    const renamed = githubMod({
      id: 'Novo',
      autor: 'Fulana Silva',
      atualizadoEm: '2026-10-25T00:00:00Z',
    });
    expect(listAuthors([painel, mapa, renamed])).toEqual([
      { slug: `site-${SITE_OWNER}`, nome: 'Ciclano', modCount: 1 },
      { slug: 'gh-fulana', nome: 'Fulana Silva', modCount: 2 },
    ]);
  });

  it('listGameVersions sem repetir, da mais nova para a mais velha, comparando como número', () => {
    expect(listGameVersions(all)).toEqual(['308', '307', '306']);
    expect(listGameVersions([githubMod({ versoesDoJogo: ['99', '1000', '307'] })])).toEqual([
      '1000',
      '307',
      '99',
    ]);
  });

  describe('filtros na URL', () => {
    const known = { authors: listAuthors(all), gameVersions: listGameVersions(all) };

    it('lê os parâmetros conhecidos', () => {
      expect(
        filtersFromParams(
          params({ q: 'painel', tipo: 'mapa', autor: 'gh-fulana', versao: '307', ordem: 'nome' }),
          known,
        ),
      ).toEqual({
        query: 'painel',
        type: 'mapa',
        author: 'gh-fulana',
        gameVersion: '307',
        sort: 'nome',
      });
    });

    it('volta ao padrão em valor desconhecido, inclusive autor e versão fora do catálogo', () => {
      expect(
        filtersFromParams(
          params({ tipo: 'carro', ordem: 'aleatorio', autor: 'gh-saiu', versao: '999' }),
          known,
        ),
      ).toEqual(EMPTY_FILTERS);
      expect(filtersFromParams(params({ q: 'x'.repeat(300) }), known).query).toHaveLength(100);
    });

    it('omite os valores padrão', () => {
      expect(filtersToParams(EMPTY_FILTERS)).toEqual({
        q: null,
        tipo: null,
        autor: null,
        versao: null,
        ordem: null,
      });
      expect(
        filtersToParams({
          query: 'a',
          type: 'som',
          author: 'gh-b',
          gameVersion: '1',
          sort: 'antigos',
        }),
      ).toEqual({ q: 'a', tipo: 'som', autor: 'gh-b', versao: '1', ordem: 'antigos' });
    });

    it('hasActiveFilters ignora a ordem', () => {
      expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'nome' })).toBe(false);
      expect(hasActiveFilters({ ...EMPTY_FILTERS, gameVersion: '307' })).toBe(true);
    });
  });

  it('downloadLink aponta para os releases ou para o link externo', () => {
    expect(downloadLink(painel)).toEqual({
      url: 'https://github.com/fulana/painel-digital/releases',
      label: 'Baixar no GitHub',
      external: false,
    });
    expect(downloadLink(mapa)).toEqual({
      url: 'https://exemplo.com/linha.zip',
      label: 'Abrir link externo',
      external: true,
    });
  });

  it('isInstallable só para plugin .dll do GitHub', () => {
    expect(isInstallable(painel)).toBe(true);
    expect(isInstallable(githubMod({ arquivo: 'X.DLL' }))).toBe(true);
    expect(isInstallable(githubMod({ tipo: 'onibus', arquivo: 'X.zip' }))).toBe(false);
    expect(isInstallable(externalMod({ tipo: 'plugin' }))).toBe(false);
  });

  it('formatDate em pt-BR e travessão sem data', () => {
    expect(formatDate('2026-10-20T10:00:00Z')).toBe('20 de outubro de 2026');
    expect(formatDate('2026-10-20T10:00:00Z', 'short')).toBe('20 de out. de 2026');
    expect(formatDate(null)).toBe('—');
  });
});
