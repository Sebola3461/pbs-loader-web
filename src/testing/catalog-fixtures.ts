import { Provider } from '@angular/core';
import { CatalogMod, CommunityCatalog, ExternalMod, GithubMod } from '../app/catalog/catalog.model';
import { COMMUNITY_CATALOG } from '../app/catalog/catalog.store';

export const SITE_OWNER = '01928c3e-7b2a-7c4d-8e9f-0123456789ab';

export function githubMod(overrides: Partial<GithubMod> = {}): GithubMod {
  return {
    id: 'PainelDigital',
    nome: 'Painel Digital',
    tipo: 'plugin',
    autor: 'Fulana',
    dono: { github: 'Fulana' },
    descricao: 'Painel digital para o ônibus.',
    versoesDoJogo: ['307'],
    dependencias: ['PBSLoaderCommonUtils'],
    origem: 'github',
    repo: 'fulana/painel-digital',
    tag: 'PainelDigital-v',
    arquivo: 'PainelDigital.dll',
    pagina: 'https://github.com/fulana/painel-digital',
    capa: null,
    confiavel: false,
    criadoEm: '2026-09-01T10:00:00Z',
    atualizadoEm: '2026-10-20T10:00:00Z',
    ...overrides,
  };
}

export function externalMod(overrides: Partial<ExternalMod> = {}): ExternalMod {
  return {
    id: 'LinhaCentro',
    nome: 'Mapa Linha Centro',
    tipo: 'mapa',
    autor: 'Ciclano',
    dono: { site: SITE_OWNER },
    descricao: 'Mapa urbano com terminal.',
    versoesDoJogo: ['306', '307'],
    dependencias: [],
    origem: 'externa',
    url: 'https://exemplo.com/linha.zip',
    pagina: null,
    capa: null,
    confiavel: false,
    criadoEm: '2026-08-15T10:00:00Z',
    atualizadoEm: '2026-08-15T10:00:00Z',
    ...overrides,
  };
}

export function catalogOf(...mods: CatalogMod[]): CommunityCatalog {
  return { formato: 1, geradoEm: '2026-10-30T12:00:00Z', mods };
}

export function provideCatalog(...mods: CatalogMod[]): Provider {
  return { provide: COMMUNITY_CATALOG, useValue: catalogOf(...mods) };
}
