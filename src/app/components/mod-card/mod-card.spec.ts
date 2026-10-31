import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { externalMod, githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { CatalogMod } from '../../catalog/catalog.model';
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
    expect(title.getAttribute('href')).toBe('/mods/PainelDigital');
    expect(el.querySelector('.author-link')?.getAttribute('href')).toBe('/autores/gh-fulana');
    expect(el.querySelector('.cover-placeholder')?.textContent?.trim()).toBe('Plugin');
    expect(el.querySelector('.tag-trusted')).not.toBeNull();
    expect(el.querySelector('.tag-external')).toBeNull();
    expect(el.querySelector('.meta')?.textContent).toContain('20 de outubro de 2026');
  });

  it('usa a capa quando existe e marca link externo', () => {
    const el = render(externalMod({ capa: 'covers/LinhaCentro.webp' }));
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://sebola3461.github.io/pbs-loader-catalogo/covers/LinhaCentro.webp',
    );
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(el.querySelector('.tag-external')).not.toBeNull();
    expect(el.querySelector('.tag-trusted')).toBeNull();
  });
});
