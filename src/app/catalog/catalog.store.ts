import { Injectable, InjectionToken, inject } from '@angular/core';
import { Author, listAuthors, listGameVersions, authorSlug } from './catalog';
import { CatalogMod, CommunityCatalog } from './catalog.model';

/** Catálogo baixado no build (scripts/fetch-catalog.mjs); os testes fornecem um próprio. */
export const COMMUNITY_CATALOG = new InjectionToken<CommunityCatalog>('COMMUNITY_CATALOG');

export const COVER_BASE_URL = 'https://sebola3461.github.io/pbs-loader-catalogo/';

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly catalog = inject(COMMUNITY_CATALOG);

  readonly mods: readonly CatalogMod[] = this.catalog.mods;
  readonly generatedAt = this.catalog.geradoEm;
  readonly authors: readonly Author[] = listAuthors(this.mods);
  readonly gameVersions: readonly string[] = listGameVersions(this.mods);

  /** Busca por id; com ownerSlug, exige que o dono bata — ids podem coexistir entre autores. */
  findMod(id: string, ownerSlug?: string): CatalogMod | null {
    return (
      this.mods.find((m) => m.id === id && (!ownerSlug || authorSlug(m.dono) === ownerSlug)) ??
      null
    );
  }

  findAuthor(slug: string): Author | null {
    return this.authors.find((a) => a.slug === slug) ?? null;
  }

  modsByAuthor(slug: string): CatalogMod[] {
    return this.mods.filter((m) => authorSlug(m.dono) === slug);
  }

  coverUrl(mod: CatalogMod): string | null {
    return mod.capa ? COVER_BASE_URL + mod.capa : null;
  }
}
