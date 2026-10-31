import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { githubMod, provideCatalog } from '../testing/catalog-fixtures';
import { App } from './app';
import { provideAppRouter } from './app.routes';
import { DEFAULT_DESCRIPTION, SITE_NAME } from './page-meta';

describe('App', () => {
  async function start() {
    TestBed.configureTestingModule({
      providers: [provideAppRouter(), provideCatalog(githubMod())],
    });
    const harness = await RouterTestingHarness.create();
    const page = async (url: string) => {
      await harness.navigateByUrl(url);
      return {
        title: TestBed.inject(Title).getTitle(),
        description: TestBed.inject(Meta).getTag('name="description"')?.content,
        el: harness.routeNativeElement as HTMLElement,
      };
    };
    return { page };
  }

  it('mostra cabeçalho, navegação e rodapé', () => {
    TestBed.configureTestingModule({ providers: [provideAppRouter(), provideCatalog()] });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.skip-link')?.getAttribute('href')).toBe('#conteudo');
    expect([...el.querySelectorAll('.nav a')].map((a) => a.textContent?.trim())).toEqual([
      'Mods',
      'Documentação',
      'Enviar mod',
    ]);
    expect(el.querySelector('main#conteudo router-outlet')).not.toBeNull();
    expect(el.querySelector('.site-footer')?.textContent).toContain(
      'sem ligação com os desenvolvedores',
    );
  });

  it('página inicial com título e descrição padrão', async () => {
    const { page } = await start();
    expect(await page('/')).toMatchObject({ title: SITE_NAME, description: DEFAULT_DESCRIPTION });
  });

  it('página do mod com título e descrição do mod', async () => {
    const { page } = await start();
    const { title, description, el } = await page('/mods/gh-fulana/PainelDigital');
    expect(title).toBe(`Painel Digital · ${SITE_NAME}`);
    expect(description).toBe('Painel digital para o ônibus.');
    expect(el.querySelector('h1')?.textContent).toBe('Painel Digital');
  });

  it('descrição do mod numa linha só e com no máximo 160 caracteres', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideAppRouter(),
        provideCatalog(githubMod({ descricao: `Linha 1\n\nLinha   2 ${'x'.repeat(300)}` })),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/mods/gh-fulana/PainelDigital');
    const description = TestBed.inject(Meta).getTag('name="description"')?.content ?? '';
    expect(description.startsWith('Linha 1 Linha 2 xxx')).toBe(true);
    expect(description).toHaveLength(160);
  });

  it('a descrição do mod não sobra ao navegar para outra página', async () => {
    const { page } = await start();
    await page('/mods/gh-fulana/PainelDigital');
    expect((await page('/')).description).toBe(DEFAULT_DESCRIPTION);
  });

  it('página do autor com título e descrição', async () => {
    const { page } = await start();
    expect(await page('/autores/gh-fulana')).toMatchObject({
      title: `Fulana · ${SITE_NAME}`,
      description: 'Mods de Fulana para o Proton Bus Simulator.',
    });
  });

  it('mod e autor que não existem', async () => {
    const { page } = await start();
    expect(await page('/mods/gh-fulana/Sumiu')).toMatchObject({
      title: `Mod não encontrado · ${SITE_NAME}`,
      description: 'Mod não encontrado no catálogo.',
    });
    expect(await page('/autores/gh-ninguem')).toMatchObject({
      title: `Autor não encontrado · ${SITE_NAME}`,
      description: 'Autor não encontrado no catálogo.',
    });
  });

  it('endereço desconhecido mostra a página de não encontrado com o texto padrão', async () => {
    const { page } = await start();
    const { title, el } = await page('/qualquer/coisa');
    expect(title).toBe(`Página não encontrada · ${SITE_NAME}`);
    expect(el.querySelector('h1')?.textContent).toBe('Página não encontrada');
    expect(el.querySelector('p')?.textContent).toContain('O endereço pode estar errado');
    expect(TestBed.inject(Router).url).toBe('/qualquer/coisa');
  });
});
