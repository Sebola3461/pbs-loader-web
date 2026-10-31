import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { externalMod, githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { CatalogMod } from '../../catalog/catalog.model';
import { ModBrowser } from './mod-browser';

async function render(url: string, ...mods: CatalogMod[]) {
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: '', component: ModBrowser }]), provideCatalog(...mods)],
  });
  const harness = await RouterTestingHarness.create(url);
  const el = harness.routeNativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const names = () => [...el.querySelectorAll('.title a')].map((a) => a.textContent?.trim());
  const settle = async () => {
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const type = (text: string) => {
    const input = el.querySelector<HTMLInputElement>('#busca')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  const choose = (id: string, value: string) => {
    const select = el.querySelector<HTMLSelectElement>(id)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };
  const typeRadio = (value: string) =>
    el.querySelector<HTMLInputElement>(`input[name="tipo"][value="${value}"]`)!;
  const pickType = (value: string) => {
    const radio = typeRadio(value);
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };
  return { el, router, harness, names, settle, type, choose, typeRadio, pickType };
}

const mods = [
  githubMod(),
  externalMod(),
  githubMod({
    id: 'Som',
    nome: 'Som do Motor',
    descricao: 'Diesel.',
    arquivo: 'Som.dll',
    atualizadoEm: '2026-10-25T00:00:00Z',
  }),
];

describe('ModBrowser', () => {
  it('lista tudo, do mais recente para o mais antigo', async () => {
    const { el, names } = await render('/', ...mods);
    expect(names()).toEqual(['Som do Motor', 'Painel Digital', 'Mapa Linha Centro']);
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('3 mods');
    expect(el.querySelector('.clear-filters')).toBeNull();
  });

  it('aplica os filtros que vêm na URL', async () => {
    const { el, names, typeRadio } = await render('/?tipo=plugin&ordem=nome', ...mods);
    expect(names()).toEqual(['Painel Digital', 'Som do Motor']);
    expect(typeRadio('plugin').checked).toBe(true);
    expect(typeRadio('').checked).toBe(false);
    expect(el.querySelector<HTMLSelectElement>('#ordem')?.value).toBe('nome');
  });

  it('ignora autor e versão da URL que não existem no catálogo', async () => {
    const { el, names } = await render('/?autor=gh-saiu&versao=999', ...mods);
    expect(names()).toHaveLength(3);
    expect(el.querySelector<HTMLSelectElement>('#autor')?.value).toBe('');
  });

  it('digitar na busca atualiza a URL sem empilhar histórico', async () => {
    const { el, router, names, settle, type } = await render('/', ...mods);
    const navigate = vi.spyOn(router, 'navigate');
    type('diesel');
    await settle();
    expect(router.url).toBe('/?q=diesel');
    expect(navigate.mock.calls[0][1]?.replaceUrl).toBe(true);
    expect(names()).toEqual(['Som do Motor']);
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('1 mod');
  });

  it('a navegação atrasada não apaga o que já foi digitado', async () => {
    const { el, router, settle, type } = await render('/', ...mods);
    type('di');
    type('die');
    type('diesel');
    await settle();
    expect(el.querySelector<HTMLInputElement>('#busca')?.value).toBe('diesel');
    expect(router.url).toBe('/?q=diesel');
  });

  it('dois filtros trocados em seguida mantêm os dois', async () => {
    const { router, settle, choose, pickType } = await render('/', ...mods);
    pickType('plugin');
    choose('#ordem', 'nome');
    await settle();
    expect(router.url).toBe('/?tipo=plugin&ordem=nome');
  });

  it('o tipo mostra só os tipos que existem, com a contagem de cada um', async () => {
    const { el } = await render('/', ...mods);
    const options = [...el.querySelectorAll('.option')].map((o) =>
      [...o.querySelectorAll('span')].map((s) => s.textContent?.trim()).join(' '),
    );
    expect(options).toEqual(['Todos 3', 'Plugin 2', 'Mapa 1']);
  });

  it('no celular, o botão abre e fecha os filtros e mostra quantos estão ativos', async () => {
    const { el, settle } = await render('/?tipo=mapa&versao=307', ...mods);
    const toggle = el.querySelector<HTMLButtonElement>('.filters-toggle')!;
    const panel = el.querySelector('#filtros')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.badge')?.textContent?.trim()).toBe('2');
    expect(panel.classList.contains('open')).toBe(false);
    toggle.click();
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.classList.contains('open')).toBe(true);
    toggle.click();
    await settle();
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('sem filtro no painel o botão não mostra contagem', async () => {
    const { el } = await render('/?q=painel', ...mods);
    expect(el.querySelector('.filters-toggle .badge')).toBeNull();
  });

  it('trocar um select grava no histórico e mantém os outros filtros', async () => {
    const { router, names, settle, choose } = await render('/?q=painel', ...mods);
    const navigate = vi.spyOn(router, 'navigate');
    choose('#versao', '307');
    await settle();
    expect(router.url).toBe('/?q=painel&versao=307');
    expect(navigate.mock.calls[0][1]?.replaceUrl).toBe(false);
    expect(names()).toEqual(['Painel Digital']);
  });

  it('navegação de fora (voltar, link do menu) traz os filtros da URL', async () => {
    const { el, router, names, settle, type } = await render('/', ...mods);
    type('diesel');
    await settle();
    await router.navigateByUrl('/?tipo=mapa');
    await settle();
    expect(names()).toEqual(['Mapa Linha Centro']);
    expect(el.querySelector<HTMLInputElement>('#busca')?.value).toBe('');
  });

  it('lista autores e versões nos selects', async () => {
    const { el } = await render('/', ...mods);
    const options = (id: string) =>
      [...el.querySelectorAll(`${id} option`)].map((o) => o.textContent?.trim());
    expect(options('#autor')).toEqual(['Todos', 'Ciclano', 'Fulana']);
    expect(options('#versao')).toEqual(['Todas', '307', '306']);
  });

  it('sem resultado mostra o aviso e limpa os filtros mantendo a ordem', async () => {
    const { el, router, names, settle } = await render('/?q=inexistente&ordem=nome', ...mods);
    expect(names()).toEqual([]);
    expect(el.querySelector('.empty h3')?.textContent).toBe('Nenhum mod com esses filtros');
    el.querySelector<HTMLButtonElement>('.empty button')!.click();
    await settle();
    expect(router.url).toBe('/?ordem=nome');
    expect(names()).toHaveLength(3);
  });

  it('limpar os filtros grava no histórico, para o "voltar" trazê-los de volta', async () => {
    const { el, router, settle } = await render('/?tipo=mapa', ...mods);
    const navigate = vi.spyOn(router, 'navigate');
    el.querySelector<HTMLButtonElement>('.clear-filters')!.click();
    await settle();
    expect(router.url).toBe('/');
    expect(navigate.mock.calls[0][1]?.replaceUrl).toBe(false);
  });

  it('catálogo vazio convida a enviar o primeiro mod', async () => {
    const { el } = await render('/');
    expect(el.querySelector('.empty h3')?.textContent).toBe('Nenhum mod publicado ainda');
    expect(el.querySelector('.empty a')?.getAttribute('href')).toContain(
      'pbs-loader-catalogo#enviar-um-mod',
    );
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('0 mods');
  });
});
