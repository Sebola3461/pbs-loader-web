import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, vi } from 'vitest';
import { authorSlug } from '../../catalog/catalog';
import { CatalogMod } from '../../catalog/catalog.model';
import { githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { SessionStore } from '../../session/session.store';
import { Submit } from './submit';

const ANA = { id: 'u-ana', username: 'Ana', role: 'user' as const };

// O jsdom não implementa <dialog>.showModal/close (mesmo polyfill do components.spec).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

async function setup(user: typeof ANA | null, mod: CatalogMod | null = githubMod()) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCatalog(...(mod ? [mod] : [])),
    ],
  });
  const fixture = TestBed.createComponent(Submit);
  const http = TestBed.inject(HttpTestingController);
  const done = TestBed.inject(SessionStore).load();
  http.expectOne('/api/me').flush({ user, turnstileSiteKey: '' });
  await done;
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, http };
}

/** Modo edição: o mod pertence à Ana e a rota traz o slug do dono. */
async function setupEdicao(mod = githubMod({ dono: { site: ANA.id } })) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCatalog(mod),
    ],
  });
  const fixture = TestBed.createComponent(Submit);
  const http = TestBed.inject(HttpTestingController);
  const done = TestBed.inject(SessionStore).load();
  http.expectOne('/api/me').flush({ user: ANA, turnstileSiteKey: '' });
  await done;
  fixture.componentRef.setInput('autor', authorSlug(mod.dono));
  fixture.componentRef.setInput('id', mod.id);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, http, mod };
}

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

/** Preenche e dispara input: os campos guiados por signal precisam do evento, não só do valor. */
function fill(el: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const campo = el.querySelector(`[name="${name}"]`) as HTMLInputElement;
    campo.value = value;
    campo.dispatchEvent(new Event('input'));
  }
}

/** O select múltiplo é a fonte das versões: marcar opções e avisar o componente. */
function marcarVersoes(el: HTMLElement, versoes: string[]) {
  const select = el.querySelector('#versao-jogo') as HTMLSelectElement;
  for (const opcao of [...select.options]) opcao.selected = versoes.includes(opcao.value);
  select.dispatchEvent(new Event('change'));
}

function escolherSelect(el: HTMLElement, seletor: string, valor: string) {
  const select = el.querySelector(seletor) as HTMLSelectElement;
  select.value = valor;
  select.dispatchEvent(new Event('change'));
}

function adicionarDependencia(fixture: ComponentFixture<Submit>, id: string) {
  const el = fixture.nativeElement as HTMLElement;
  const select = el.querySelector('#dep-select') as HTMLSelectElement;
  select.value = id;
  select.dispatchEvent(new Event('change'));
  // Reavaliar [disabled] do botão (depende do valor do select) antes de clicar.
  fixture.detectChanges();
  (el.querySelector('.dep-add button') as HTMLButtonElement).click();
  // O chip renderiza depois do CD que o clique do botão dispara.
  fixture.detectChanges();
}

function buscarImagens(el: HTMLElement, repo: string) {
  const campo = el.querySelector('#galeria-repo') as HTMLInputElement;
  campo.value = repo;
  campo.dispatchEvent(new Event('input'));
  const botao = [...el.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Buscar imagens'),
  ) as HTMLButtonElement;
  botao.click();
}

/** O jsdom valida e dispara o submit sem bloquear: o evento chega ao componente como no navegador. */
function submitForm(el: HTMLElement) {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
}

const FORM_DEFAULTS = {
  nome: 'Mod Novo',
  descricao: 'Descrição.',
  repo: 'ana/mod-novo',
  tag: 'Novo-v',
  arquivo: 'Novo.dll',
};

describe('Submit', () => {
  it('sem conta, convida a entrar em vez de mostrar o formulário', async () => {
    const { el } = await setup(null);
    expect(text(el, 'h1')).toBe('Enviar mod');
    expect(text(el, '.panel p')).toContain('Entre com sua conta');
    expect(el.querySelector('form')).toBeNull();
  });

  it('logado mostra o formulário: id automático, versões em select e todos os tipos', async () => {
    const { el } = await setup(ANA);
    expect(el.querySelectorAll('#tipo option')).toHaveLength(7);
    const id = el.querySelector('#id') as HTMLInputElement;
    expect(id.readOnly).toBe(true);
    expect(el.querySelector('#versao-jogo')).not.toBeNull();
    expect(el.querySelector('#versao-jogo')!.hasAttribute('multiple')).toBe(true);
    expect(el.querySelector('#dep-select')).not.toBeNull();
    expect(el.querySelector('#repo')).not.toBeNull();
    expect(el.querySelector('#url')).toBeNull();
    expect(el.querySelector('#galeria-repo')).not.toBeNull();
  });

  it('id nasce automaticamente do nome, sem acentos e em minúsculas', async () => {
    const { fixture, el } = await setup(ANA);
    fill(el, { nome: 'Modão Brabo 2' });
    fixture.detectChanges();
    expect((el.querySelector('#id') as HTMLInputElement).value).toBe('modao-brabo-2');
  });

  it('envia publish com id do nome, dono e idempotência do cliente', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('publish');
    expect(body['modId']).toBe('mod-novo');
    expect(body['idempotencyKey']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body['mod']).toMatchObject({
      id: 'mod-novo',
      nome: 'Mod Novo',
      tipo: 'plugin',
      versoesDoJogo: ['307'],
      dependencias: [],
      origem: 'github',
      repo: 'ana/mod-novo',
      tag: 'Novo-v',
      arquivo: 'Novo.dll',
    });
    req.flush({ submission: { id: 's1', modId: 'mod-novo', status: 'pending', prNumber: 12 } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel p')).toContain('mod-novo foi enviado para publicação');
    expect(el.querySelector('.panel .form-hint a')?.getAttribute('href')).toContain('/pull/12');
  });

  it('erro da API aparece no formulário e permite tentar de novo', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    submitForm(el);
    http
      .expectOne('/api/submissions')
      .flush({ error: 'submission_limit' }, { status: 429, statusText: 'Too Many Requests' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.form-error')).toBe(
      'Você já fez 5 envios nas últimas 24 horas. Tente de novo amanhã.',
    );
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('sem versão marcada falha no cliente, sem chamada à API', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('Selecione de 1 a 10 versões');
    http.expectNone('/api/submissions');
  });

  it('dependência vira chip e vai no POST como id do catálogo, sem aviso de lista vazia', async () => {
    const { fixture, el, http } = await setup(ANA);
    expect(el.textContent).not.toContain('Nenhuma. Mods da comunidade');
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    adicionarDependencia(fixture, 'PainelDigital');
    expect(el.querySelector('.chip')?.textContent).toContain('PainelDigital');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      dependencias: ['PainelDigital'],
    });
    req.flush({ submission: { id: 's10', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('buscar releases sugere prefixo de tag e arquivo do GitHub', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    (el.querySelector('.github-fetch button') as HTMLButtonElement).click();
    http
      .expectOne('https://api.github.com/repos/ana/mod-novo/releases?per_page=20')
      .flush([
        { tag_name: 'Novo-v1.2', assets: [{ name: 'Novo.dll' }, { name: 'leia-me.txt' }] },
      ]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#tag-sugestao')).not.toBeNull();
    expect(el.querySelectorAll('#arquivo-sugestao option')).toHaveLength(3); // vazio + 2 assets
    escolherSelect(el, '#tag-sugestao', 'Novo-v1.2');
    escolherSelect(el, '#arquivo-sugestao', 'Novo.dll');
    expect((el.querySelector('#tag') as HTMLInputElement).value).toBe('Novo-v');
    expect((el.querySelector('#arquivo') as HTMLInputElement).value).toBe('Novo.dll');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      tag: 'Novo-v',
      arquivo: 'Novo.dll',
    });
    req.flush({ submission: { id: 's2', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('repositório sem releases avisa que tag e arquivo são à mão', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    (el.querySelector('.github-fetch button') as HTMLButtonElement).click();
    http.expectOne('https://api.github.com/repos/ana/mod-novo/releases?per_page=20').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#tag-sugestao')).toBeNull();
    const hints = [...el.querySelectorAll('.form-hint')].map((h) => h.textContent?.trim());
    expect(hints.some((t) => t?.includes('ainda não tem releases'))).toBe(true);
  });

  it('falha na busca de releases mostra o erro e mantém o formulário', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    (el.querySelector('.github-fetch button') as HTMLButtonElement).click();
    http
      .expectOne('https://api.github.com/repos/ana/mod-novo/releases?per_page=20')
      .flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('Não consegui buscar as releases');
  });

  it('link externo troca os campos e envia a url', async () => {
    const { fixture, el, http } = await setup(ANA);
    const radio = el.querySelector('input[value="externa"]') as HTMLInputElement;
    radio.click();
    // O jsdom não dispara change no click do rádio: o evento vai manualmente, como no navegador.
    radio.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('#url')).not.toBeNull();
    expect(el.querySelector('#repo')).toBeNull();
    fill(el, {
      nome: 'Mod Externo',
      descricao: 'Descrição.',
      url: 'https://exemplo.com/mod.zip',
    });
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      origem: 'externa',
      url: 'https://exemplo.com/mod.zip',
    });
    req.flush({ submission: { id: 's3', modId: 'mod-externo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('capa escolhida vira WebP no navegador e vai no POST', async () => {
    // Mesmos mocks do webp.spec: o jsdom não tem canvas nem createImageBitmap.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1920, height: 1080, close: () => {} })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(50)], { type: 'image/webp' })),
    );
    const { fixture, el, http } = await setup(ANA);
    const input = el.querySelector('#capa') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(10)], 'capa.png', { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change'));
    // O FileReader do jsdom roda em task própria: esperar capa ou erro aparecer de fato.
    const interno = fixture.componentInstance as unknown as {
      capa: () => { nome: string; base64: string } | null;
      error: () => string | null;
    };
    await vi.waitFor(() => expect(interno.capa() ?? interno.error()).toBeTruthy(), { timeout: 2000 });
    fixture.detectChanges();
    const hints = [...el.querySelectorAll('.form-hint')].map((h) => h.textContent?.trim());
    expect(hints.some((t) => t?.includes('capa.png convertida para WebP'))).toBe(true);

    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['capaBase64']).toBeTruthy();
    req.flush({ submission: { id: 's4', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('campo de capa voltando a vazio não quebra e limpa a escolha', async () => {
    const { fixture, el } = await setup(ANA);
    const input = el.querySelector('#capa') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [] });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    const hints = [...el.querySelectorAll('.form-hint')].map((h) => h.textContent?.trim());
    expect(hints.some((t) => t?.includes('o navegador converte para WebP'))).toBe(true);
  });

  it('conversão da capa que falha mostra o erro e limpa a escolha', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1920, height: 1080, close: () => {} })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
    const { fixture, el } = await setup(ANA);
    const input = el.querySelector('#capa') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(10)], 'capa.png', { type: 'image/png' })],
    });
    input.dispatchEvent(new Event('change'));
    const interno = fixture.componentInstance as unknown as {
      capa: () => { nome: string } | null;
      error: () => string | null;
    };
    await vi.waitFor(() => expect(interno.error()).toBeTruthy(), { timeout: 2000 });
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('não consegue converter');
    expect(interno.capa()).toBeNull();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('modo edição pré-preenche versões, dependências e GitHub, e envia como edit', async () => {
    const imagens = ['https://raw.githubusercontent.com/fulana/painel-digital/main/prints/a.png'];
    const { fixture, el, http } = await setupEdicao(
      githubMod({ dono: { site: ANA.id }, imagens }),
    );
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('Painel Digital');
    expect((el.querySelector('#id') as HTMLInputElement).value).toBe('PainelDigital');
    expect((el.querySelector('#id') as HTMLInputElement).readOnly).toBe(true);
    expect((el.querySelector('#repo') as HTMLInputElement).value).toBe('fulana/painel-digital');
    expect((el.querySelector('#galeria-repo') as HTMLInputElement).value).toBe(
      'fulana/painel-digital',
    );
    const select = el.querySelector('#versao-jogo') as HTMLSelectElement;
    expect([...select.selectedOptions].map((o) => o.value)).toEqual(['307']);
    expect(el.querySelector('.chip')?.textContent).toContain('PBSLoaderCommonUtils');
    fill(el, { descricao: 'Descrição nova.' });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('edit');
    expect(body['modId']).toBe('PainelDigital');
    expect((body['mod'] as Record<string, unknown>)['descricao']).toBe('Descrição nova.');
    expect((body['mod'] as Record<string, unknown>)['versoesDoJogo']).toEqual(['307']);
    expect((body['mod'] as Record<string, unknown>)['repo']).toBe('fulana/painel-digital');
    expect(body['imagens']).toEqual(imagens);
    req.flush({
      submission: { id: 's5', modId: 'PainelDigital', status: 'pending', prNumber: null },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel h1')).toBe('Envio recebido');
  });

  it('edição sem ser dono mostra o aviso e não mostra o formulário', async () => {
    const { el } = await setupEdicao(githubMod());
    expect(text(el, '.panel h1')).toBe('Só o dono edita');
    expect(el.querySelector('form')).toBeNull();
  });

  it('remover pede confirmação e envia remove sem payload', async () => {
    const { fixture, el, http } = await setupEdicao();
    (el.querySelector('.danger button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('remove');
    expect(body['modId']).toBe('PainelDigital');
    expect(body['mod']).toBeUndefined();
    req.flush({ submission: { id: 's6', modId: 'PainelDigital', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel h1')).toBe('Remoção enviada');
  });

  it('remoção que falha fecha o diálogo e mostra o erro', async () => {
    const { fixture, el, http } = await setupEdicao();
    (el.querySelector('.danger button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http
      .expectOne('/api/submissions')
      .flush({ error: 'pr_conflict' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('Espere o PR atual');
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('cancelar a remoção fecha o diálogo sem enviar nada', async () => {
    const { fixture, el, http } = await setupEdicao();
    (el.querySelector('.danger button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    (dialog.querySelector('.button-link') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    http.expectNone('/api/submissions');
  });

  it('envio aceito volta ao formulário limpo ao pedir outro envio', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    submitForm(el);
    http
      .expectOne('/api/submissions')
      .flush({ submission: { id: 's7', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    const another = [...el.querySelectorAll('.panel .form-actions button')].find(
      (b) => b.textContent?.trim() === 'Enviar outro mod',
    ) as HTMLButtonElement;
    another.click();
    fixture.detectChanges();
    expect(el.querySelector('form')).not.toBeNull();
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('');
    expect((el.querySelector('#id') as HTMLInputElement).value).toBe('');
    expect(
      [...(el.querySelector('#versao-jogo') as HTMLSelectElement).options].some((o) => o.selected),
    ).toBe(false);
  });

  it('galeria lista imagens do repositório pela API pública e envia as escolhidas', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    buscarImagens(el, 'ana/mod-novo');
    http.expectOne('https://api.github.com/repos/ana/mod-novo').flush({ default_branch: 'main' });
    // A árvore só é pedida depois da resposta do repositório: esperar o microtask entre as duas.
    await fixture.whenStable();
    http
      .expectOne('https://api.github.com/repos/ana/mod-novo/git/trees/main?recursive=1')
      .flush({
        tree: [
          { path: 'prints/salao.webp', type: 'blob' },
          { path: 'prints/mapa.PNG', type: 'blob' },
          { path: 'README.md', type: 'blob' },
          { path: 'prints', type: 'tree' },
        ],
      });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('.galeria-item')).toHaveLength(2);
    const caixa = el.querySelector('.galeria-item input') as HTMLInputElement;
    caixa.click();
    caixa.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const hints = [...el.querySelectorAll('.form-hint')].map((h) => h.textContent?.trim());
    expect(hints.some((t) => t?.includes('1 de até 10 imagens'))).toBe(true);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['imagens']).toEqual([
      'https://raw.githubusercontent.com/ana/mod-novo/main/prints/salao.webp',
    ]);
    req.flush({ submission: { id: 's8', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('busca de imagens que falha mostra o erro e mantém o formulário', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersoes(el, ['307']);
    buscarImagens(el, 'ana/mod-novo');
    http
      .expectOne('https://api.github.com/repos/ana/mod-novo')
      .flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('Não consegui listar as imagens');
  });

  it('sem versões no catálogo, o formulário aceita versões manuais', async () => {
    const { el, http } = await setup(ANA, null);
    expect(el.querySelector('#versao-jogo')).toBeNull();
    expect(el.querySelector('#versao-manual')).not.toBeNull();
    fill(el, { ...FORM_DEFAULTS, 'versao-manual': '307' });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect(
      ((req.request.body as Record<string, unknown>)['mod'] as Record<string, unknown>)[
        'versoesDoJogo'
      ],
    ).toEqual(['307']);
    req.flush({ submission: { id: 's9', modId: 'mod-novo', status: 'pending', prNumber: null } });
  });

  it('versões manuais fora do formato são recusadas', async () => {
    const { fixture, el, http } = await setup(ANA, null);
    fill(el, { ...FORM_DEFAULTS, 'versao-manual': 'abc, 307' });
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('números de até 6 dígitos');
    http.expectNone('/api/submissions');
  });
});
