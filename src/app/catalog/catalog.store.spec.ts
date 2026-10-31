import { TestBed } from '@angular/core/testing';
import { externalMod, githubMod, provideCatalog, SITE_OWNER } from '../../testing/catalog-fixtures';
import { CatalogStore, COVER_BASE_URL } from './catalog.store';

describe('CatalogStore', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideCatalog(githubMod({ capa: 'covers/PainelDigital.webp' }), externalMod())],
    });
    return TestBed.inject(CatalogStore);
  }

  it('expõe mods, autores, versões e data do catálogo', () => {
    const store = setup();
    expect(store.mods.map((m) => m.id)).toEqual(['PainelDigital', 'LinhaCentro']);
    expect(store.authors.map((a) => a.slug)).toEqual([`site-${SITE_OWNER}`, 'gh-fulana']);
    expect(store.gameVersions).toEqual(['307', '306']);
    expect(store.generatedAt).toBe('2026-10-30T12:00:00Z');
  });

  it('acha mod e autor, ou devolve null', () => {
    const store = setup();
    expect(store.findMod('PainelDigital')?.nome).toBe('Painel Digital');
    expect(store.findMod('paineldigital')).toBeNull();
    expect(store.findAuthor('gh-fulana')?.nome).toBe('Fulana');
    expect(store.findAuthor('gh-ninguem')).toBeNull();
    expect(store.modsByAuthor('gh-fulana').map((m) => m.id)).toEqual(['PainelDigital']);
  });

  it('monta a URL da capa no GitHub Pages do catálogo', () => {
    const store = setup();
    expect(store.coverUrl(store.mods[0])).toBe(`${COVER_BASE_URL}covers/PainelDigital.webp`);
    expect(store.coverUrl(store.mods[1])).toBeNull();
  });
});
