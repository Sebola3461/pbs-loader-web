import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { externalMod, githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { CatalogMod } from '../../catalog/catalog.model';
import { RatingsStore } from '../../session/ratings.store';
import { ModCard } from './mod-card';

function render(mod: CatalogMod) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideCatalog(mod)] });
  const fixture = TestBed.createComponent(ModCard);
  fixture.componentRef.setInput('mod', mod);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ModCard', () => {
  it('mostra nome com link, autor, tipo e data', () => {
    const el = render(githubMod({ confiavel: true }));
    const title = el.querySelector<HTMLAnchorElement>('.title a')!;
    expect(title.textContent?.trim()).toBe('Painel Digital');
    expect(title.getAttribute('href')).toBe('/mods/gh-fulana/PainelDigital');
    expect(el.querySelector('.author-link')?.getAttribute('href')).toBe('/autores/gh-fulana');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.badge')?.textContent?.trim()).toBe('Plugin');
    expect(el.querySelector('.meta')?.textContent).toContain('Jogo 307');
    expect(el.querySelector('.badge-success')).not.toBeNull();
    expect(el.querySelector('.badge-warning')).toBeNull();
    expect(el.querySelector('.meta')?.textContent).toContain('20 de out. de 2026');
  });

  it('usa a capa quando existe e marca link externo', () => {
    const el = render(externalMod({ capa: 'covers/LinhaCentro.webp' }));
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://sebola3461.github.io/pbs-loader-catalogo/covers/LinhaCentro.webp',
    );
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(el.querySelector('.badge-warning')).not.toBeNull();
    expect(el.querySelector('.badge-success')).toBeNull();
  });

  it('mostra a média e a contagem quando o mod tem avaliações', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideCatalog(githubMod())] });
    TestBed.inject(RatingsStore).stats.set({ PainelDigital: { count: 12, average: 4.25 } });
    const fixture = TestBed.createComponent(ModCard);
    fixture.componentRef.setInput('mod', githubMod());
    fixture.detectChanges();
    const rating = (fixture.nativeElement as HTMLElement).querySelector('.rating');
    expect(rating?.textContent?.replace(/\s+/g, ' ').trim()).toBe('★ 4,3 de 5, em (12)');
  });

  it('sem avaliações não mostra estrelas', () => {
    expect(render(githubMod()).querySelector('.rating')).toBeNull();
  });
});
