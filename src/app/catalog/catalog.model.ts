/** Formato 1 do community-catalog.json publicado pelo pbs-loader-catalogo (scripts/lib/catalog.mjs lá). */
export interface CommunityCatalog {
  readonly formato: 1;
  readonly geradoEm: string;
  readonly mods: readonly CatalogMod[];
}

export const MOD_TYPES = ['plugin', 'onibus', 'mapa', 'skin', 'destino', 'som', 'outro'] as const;
export type ModType = (typeof MOD_TYPES)[number];

export type ModOwner = { readonly github: string } | { readonly site: string };

interface CatalogModBase {
  readonly id: string;
  readonly nome: string;
  readonly tipo: ModType;
  readonly autor: string;
  readonly dono: ModOwner;
  readonly descricao: string;
  readonly versoesDoJogo: readonly string[];
  readonly dependencias: readonly string[];
  readonly pagina: string | null;
  readonly capa: string | null;
  readonly confiavel: boolean;
  readonly criadoEm: string | null;
  readonly atualizadoEm: string | null;
}

export interface GithubMod extends CatalogModBase {
  readonly origem: 'github';
  readonly repo: string;
  readonly tag: string;
  readonly arquivo: string;
}

export interface ExternalMod extends CatalogModBase {
  readonly origem: 'externa';
  readonly url: string;
}

export type CatalogMod = GithubMod | ExternalMod;
