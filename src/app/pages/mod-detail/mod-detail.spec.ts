import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { externalMod, githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { CatalogMod } from '../../catalog/catalog.model';
import { ModDetail } from './mod-detail';

function render(id: string, ...mods: CatalogMod[]) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideCatalog(...mods)] });
  const fixture = TestBed.createComponent(ModDetail);
  fixture.componentRef.setInput('id', id);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement };
}

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

describe('ModDetail', () => {
  it('mostra o plugin com download, instalação e dependências', () => {
    const lib = githubMod({ id: 'Lib', nome: 'Lib', dependencias: [] });
    const painel = githubMod({
      dependencias: ['PBSLoaderCommonUtils', 'Lib'],
      capa: 'covers/PainelDigital.webp',
    });
    const { el } = render('PainelDigital', painel, lib);

    expect(text(el, 'h1')).toBe('Painel Digital');
    expect(el.querySelector('.author a')?.getAttribute('href')).toBe('/autores/gh-fulana');
    const [download, page] = [...el.querySelectorAll<HTMLAnchorElement>('.actions a')];
    expect(download.getAttribute('href')).toBe('https://github.com/fulana/painel-digital/releases');
    expect(download.textContent?.trim()).toBe('Baixar no GitHub');
    expect(page.getAttribute('href')).toBe('https://github.com/fulana/painel-digital');
    expect(el.querySelector('img.cover')?.getAttribute('alt')).toBe('Capa de Painel Digital');
    expect(text(el, '.notice h3')).toBe('Instalar pelo PBS Loader');
    expect(text(el, '.caution')).toContain('não passam por revisão');

    const deps = el.querySelectorAll('.facts dd')[1];
    expect(deps.textContent?.replace(/\s+/g, ' ').trim()).toBe('PBSLoaderCommonUtils, Lib');
    expect(deps.querySelector('a')?.getAttribute('href')).toBe('/mods/Lib');
    expect(text(el, '.facts dd:nth-of-type(3)')).toBe('1 de setembro de 2026');
  });

  it('link externo avisa e não sugere o instalador', () => {
    const { el } = render('LinhaCentro', externalMod());
    expect(text(el, '.actions a')).toBe('Abrir link externo');
    expect(el.querySelectorAll('.actions a')).toHaveLength(1);
    expect(text(el, '.notice-warning h3')).toBe('Arquivo fora do GitHub');
    expect(text(el, '.notice:not(.notice-warning)')).toBeUndefined();
    expect(text(el, '.tag-external')).toBe('Link externo');
    expect(text(el, '.facts dd:nth-of-type(2)')).toBe('Nada');
  });

  it('autor confiável não mostra o aviso de revisão', () => {
    const { el } = render('PainelDigital', githubMod({ confiavel: true }));
    expect(el.querySelector('.caution')).toBeNull();
    expect(text(el, '.tag-trusted')).toBe('Autor confiável');
  });

  it('mod que não existe mostra a página de não encontrado', () => {
    const { el } = render('Sumiu', githubMod());
    expect(text(el, 'h1')).toBe('Mod não encontrado');
    expect(el.querySelector('app-not-found a')?.getAttribute('href')).toBe('/');
  });
});
