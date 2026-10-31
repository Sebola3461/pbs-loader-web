import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { externalMod, githubMod, provideCatalog, SITE_OWNER } from '../../../testing/catalog-fixtures';
import { CatalogMod } from '../../catalog/catalog.model';
import { SessionStore } from '../../session/session.store';
import { ModDetail } from './mod-detail';

const GITHUB_SLUG = 'gh-fulana';
const SITE_SLUG = `site-${SITE_OWNER}`;

/** A sessão carrega antes do componente: o link de edição depende de quem está logado. */
async function render(id: string, autor: string, user: { id: string } | null, ...mods: CatalogMod[]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCatalog(...mods),
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const done = TestBed.inject(SessionStore).load();
  http.expectOne('/api/me').flush({ user, turnstileSiteKey: '' });
  await done;
  const fixture = TestBed.createComponent(ModDetail);
  fixture.componentRef.setInput('id', id);
  fixture.componentRef.setInput('autor', autor);
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement };
}

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

describe('ModDetail', () => {
  it('mostra o plugin com download, instalação e dependências', async () => {
    const lib = githubMod({ id: 'Lib', nome: 'Lib', dependencias: [] });
    const painel = githubMod({
      dependencias: ['PBSLoaderCommonUtils', 'Lib'],
      capa: 'covers/PainelDigital.webp',
    });
    const { el } = await render('PainelDigital', GITHUB_SLUG, null, painel, lib);

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
    expect(deps.querySelector('a')?.getAttribute('href')).toBe('/mods/gh-fulana/Lib');
    expect(text(el, '.facts dd:nth-of-type(3)')).toBe('1 de setembro de 2026');
  });

  it('link externo avisa e não sugere o instalador', async () => {
    const { el } = await render('LinhaCentro', SITE_SLUG, null, externalMod());
    expect(text(el, '.actions a')).toBe('Abrir link externo');
    expect(el.querySelectorAll('.actions a')).toHaveLength(1);
    expect(text(el, '.notice-warning h3')).toBe('Arquivo fora do GitHub');
    expect(text(el, '.notice:not(.notice-warning)')).toBeUndefined();
    expect(text(el, '.badge-warning')).toBe('Link externo');
    expect(text(el, '.facts dd:nth-of-type(2)')).toBe('Nada');
  });

  it('autor confiável não mostra o aviso de revisão', async () => {
    const { el } = await render('PainelDigital', GITHUB_SLUG, null, githubMod({ confiavel: true }));
    expect(el.querySelector('.caution')).toBeNull();
    expect(text(el, '.badge-success')).toBe('Autor confiável');
  });

  it('mod que não existe mostra a página de não encontrado', async () => {
    const { el } = await render('Sumiu', GITHUB_SLUG, null, githubMod());
    expect(text(el, 'h1')).toBe('Mod não encontrado');
    expect(el.querySelector('app-not-found a')?.getAttribute('href')).toBe('/');
  });

  it('mods com o mesmo id coexistem: o autor do endereço escolhe qual mostrar', async () => {
    const deFulana = githubMod();
    const deBeltrano = githubMod({ dono: { github: 'Beltrano' } });
    const { el } = await render('PainelDigital', 'gh-beltrano', null, deFulana, deBeltrano);
    expect(el.querySelector('.author a')?.getAttribute('href')).toBe('/autores/gh-beltrano');
  });

  it('autor no endereço que não é o dono cai na página de não encontrado', async () => {
    const { el } = await render('PainelDigital', 'gh-ninguem', null, githubMod());
    expect(text(el, 'h1')).toBe('Mod não encontrado');
  });

  it('dono do site vê o botão de editar', async () => {
    const dono = { id: 'u-dono', username: 'Dono', role: 'user' as const };
    const { el } = await render(
      'PainelDigital',
      'site-u-dono',
      dono,
      githubMod({ dono: { site: 'u-dono' } }),
    );
    const edit = [...el.querySelectorAll('.actions a')].find(
      (a) => a.textContent?.trim() === 'Editar',
    );
    expect(edit?.getAttribute('href')).toBe('/mods/site-u-dono/PainelDigital/editar');
  });

  it('quem não é o dono não vê o botão de editar', async () => {
    const { el } = await render('PainelDigital', GITHUB_SLUG, { id: 'u-outro' }, githubMod());
    expect(
      [...el.querySelectorAll('.actions a')].some((a) => a.textContent?.trim() === 'Editar'),
    ).toBe(false);
  });
});
