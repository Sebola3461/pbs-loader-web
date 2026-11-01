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

function fill(el: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    (el.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
  }
}

/** O jsdom não dispara change no click de checkbox/rádio: marcar e disparar na mão. */
function marcarVersao(el: HTMLElement, versao: string) {
  const caixa = el.querySelector(
    `input[name="versao-jogo"][value="${versao}"]`,
  ) as HTMLInputElement;
  caixa.checked = true;
  caixa.dispatchEvent(new Event('change'));
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

/** O jsdom valida e dispara o submit sem bloquear: o evento chega ao componente como no navegador. */
function submitForm(el: HTMLElement) {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
}

const FORM_DEFAULTS = {
  id: 'Novo',
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

  it('logado mostra o formulário com versões do catálogo e todos os tipos', async () => {
    const { el } = await setup(ANA);
    expect(el.querySelectorAll('#tipo option')).toHaveLength(7);
    expect(el.querySelector('input[name="versao-jogo"]')).not.toBeNull();
    expect(el.querySelector('#dep-select')).not.toBeNull();
    expect(el.querySelector('#repo')).not.toBeNull();
    expect(el.querySelector('#url')).toBeNull();
  });

  it('envia publish com dono e idempotência do cliente', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersao(el, '307');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('publish');
    expect(body['modId']).toBe('Novo');
    expect(body['idempotencyKey']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body['mod']).toMatchObject({
      id: 'Novo',
      nome: 'Mod Novo',
      tipo: 'plugin',
      versoesDoJogo: ['307'],
      dependencias: [],
      origem: 'github',
      repo: 'ana/mod-novo',
    });
    req.flush({ submission: { id: 's1', modId: 'Novo', status: 'pending', prNumber: 12 } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel p')).toContain('Novo foi enviado para publicação');
    expect(el.querySelector('.panel .form-hint a')?.getAttribute('href')).toContain('/pull/12');
  });

  it('erro da API aparece no formulário e permite tentar de novo', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersao(el, '307');
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

  it('dependência vira chip e vai no POST como id do catálogo', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersao(el, '307');
    adicionarDependencia(fixture, 'PainelDigital');
    expect(el.querySelector('.chip')?.textContent).toContain('PainelDigital');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      dependencias: ['PainelDigital'],
    });
    req.flush({ submission: { id: 's2', modId: 'Novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
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
      id: 'Externo',
      nome: 'Mod Externo',
      descricao: 'Descrição.',
      url: 'https://exemplo.com/mod.zip',
    });
    marcarVersao(el, '307');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      origem: 'externa',
      url: 'https://exemplo.com/mod.zip',
    });
    req.flush({ submission: { id: 's3', modId: 'Externo', status: 'pending', prNumber: null } });
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
    marcarVersao(el, '307');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['capaBase64']).toBeTruthy();
    req.flush({ submission: { id: 's4', modId: 'Novo', status: 'pending', prNumber: null } });
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

  it('modo edição pré-preenche versões, dependências e descrição, e envia como edit', async () => {
    const { fixture, el, http } = await setupEdicao();
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('Painel Digital');
    expect((el.querySelector('#id') as HTMLInputElement).readOnly).toBe(true);
    expect(text(el, '.lead')).toContain('O id e o dono não mudam');
    const caixa = el.querySelector(
      'input[name="versao-jogo"][value="307"]',
    ) as HTMLInputElement;
    expect(caixa.checked).toBe(true);
    expect(el.querySelector('.chip')?.textContent).toContain('PBSLoaderCommonUtils');
    fill(el, { descricao: 'Descrição nova.' });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('edit');
    expect(body['modId']).toBe('PainelDigital');
    expect((body['mod'] as Record<string, unknown>)['descricao']).toBe('Descrição nova.');
    expect((body['mod'] as Record<string, unknown>)['versoesDoJogo']).toEqual(['307']);
    expect((body['mod'] as Record<string, unknown>)['dependencias']).toEqual([
      'PBSLoaderCommonUtils',
    ]);
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

  it('envio aceito volta ao formulário limpo ao pedir outro envio', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    marcarVersao(el, '307');
    submitForm(el);
    http
      .expectOne('/api/submissions')
      .flush({ submission: { id: 's7', modId: 'Novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    const another = [...el.querySelectorAll('.panel .form-actions button')].find(
      (b) => b.textContent?.trim() === 'Enviar outro mod',
    ) as HTMLButtonElement;
    another.click();
    fixture.detectChanges();
    expect(el.querySelector('form')).not.toBeNull();
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('');
    expect((el.querySelector('input[name="versao-jogo"]') as HTMLInputElement).checked).toBe(false);
  });

  it('galeria do mod vai no POST como imagens', async () => {
    const { el, http } = await setup(ANA);
    fill(el, {
      ...FORM_DEFAULTS,
      galeria: 'https://raw.githubusercontent.com/Sebola3461/FreeWalk/main/prints/salao.webp',
    });
    marcarVersao(el, '307');
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['imagens']).toEqual([
      'https://raw.githubusercontent.com/Sebola3461/FreeWalk/main/prints/salao.webp',
    ]);
    req.flush({ submission: { id: 's8', modId: 'Novo', status: 'pending', prNumber: null } });
  });

  it('galeria com endereço fora do GitHub falha no cliente, sem POST', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { ...FORM_DEFAULTS, galeria: 'https://exemplo.com/print.png' });
    marcarVersao(el, '307');
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('raw.githubusercontent.com');
    http.expectNone('/api/submissions');
  });

  it('sem versões no catálogo, o formulário aceita versões manuais', async () => {
    const { el, http } = await setup(ANA, null);
    expect(el.querySelector('input[name="versao-jogo"]')).toBeNull();
    expect(el.querySelector('#versao-manual')).not.toBeNull();
    fill(el, { ...FORM_DEFAULTS, 'versao-manual': '307' });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect(
      ((req.request.body as Record<string, unknown>)['mod'] as Record<string, unknown>)[
        'versoesDoJogo'
      ],
    ).toEqual(['307']);
    req.flush({ submission: { id: 's9', modId: 'Novo', status: 'pending', prNumber: null } });
  });

  it('versões manuais fora do formato são recusadas', async () => {
    const { fixture, el, http } = await setup(ANA, null);
    fill(el, { ...FORM_DEFAULTS, 'versao-manual': 'abc, 307' });
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('números de até 6 dígitos');
    http.expectNone('/api/submissions');
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
});
