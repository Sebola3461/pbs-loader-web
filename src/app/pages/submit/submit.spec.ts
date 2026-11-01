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

/**
 * Repo/tag/arquivo direto pelos signals: sem evento de input, o debounce da busca no GitHub não
 * dispara — útil nos testes longos (capa, galeria) que não querem a chamada extra.
 */
function preencherGithub(
  fixture: ComponentFixture<Submit>,
  valores: { repo?: string; tag?: string; arquivo?: string },
) {
  const c = fixture.componentInstance as unknown as {
    repo: { set: (v: string) => void };
    tagValor: { set: (v: string) => void };
    arquivoValor: { set: (v: string) => void };
  };
  c.repo.set(valores.repo ?? '');
  c.tagValor.set(valores.tag ?? '');
  c.arquivoValor.set(valores.arquivo ?? '');
}

/** O select múltiplo é a fonte das versões: marcar opções e avisar o componente. */
function marcarVersoes(el: HTMLElement, versoes: string[]) {
  const select = el.querySelector('#versao-jogo') as HTMLSelectElement;
  for (const opcao of [...select.options]) opcao.selected = versoes.includes(opcao.value);
  select.dispatchEvent(new Event('change'));
}

function escolherTipo(el: HTMLElement, tipo: string) {
  const select = el.querySelector('#tipo') as HTMLSelectElement;
  select.value = tipo;
  select.dispatchEvent(new Event('change'));
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

  it('logado mostra o formulário: id gerado no servidor, versões em select, sem dependências', async () => {
    const { el } = await setup(ANA);
    expect(el.querySelectorAll('#tipo option')).toHaveLength(7);
    // O id nasce no servidor: o campo nem aparece na tela.
    expect(el.querySelector('#id')).toBeNull();
    expect(el.querySelector('#versao-jogo')!.hasAttribute('multiple')).toBe(true);
    expect(el.textContent).not.toContain('Dependências');
    expect(el.querySelector('#repo')).not.toBeNull();
    expect(el.querySelector('#url')).toBeNull();
    expect(el.querySelectorAll('#tag-opcoes option')).toHaveLength(0);
    expect(el.querySelector('#galeria-repo')).not.toBeNull();
  });

  it('nome vazio falha no cliente, sem chamada à API', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { descricao: 'Descrição.', repo: 'ana/mod-novo', tag: 'Novo-v', arquivo: 'Novo.dll' });
    marcarVersoes(el, ['307']);
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toBe('Escreva o nome do mod.');
    http.expectNone('/api/submissions');
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
    // O id nasce no servidor: o publish não manda modId nem id no payload.
    expect(body['modId']).toBeUndefined();
    expect(body['idempotencyKey']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body['mod']).toMatchObject({
      nome: 'Mod Novo',
      tipo: 'plugin',
      versoesDoJogo: ['307'],
      dependencias: [],
      origem: 'github',
      repo: 'ana/mod-novo',
      tag: 'Novo-v',
      arquivo: 'Novo.dll',
    });
    req.flush({
      submission: { id: 's1', modId: 'id-gerado-pelo-servidor', status: 'pending', prNumber: 12 },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel p')).toContain('id-gerado-pelo-servidor foi enviado para publicação');
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

  it('repositório aceita link completo do GitHub e as releases chegam sozinhas', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, {
      nome: 'FreeWalk',
      descricao: 'Descrição.',
      repo: 'https://github.com/Sebola3461/FreeWalk/',
    });
    // Busca automática com defer: o flush acontece no momento em que a chamada aparece.
    await vi.waitFor(() => {
      http
        .expectOne('https://api.github.com/repos/Sebola3461/FreeWalk/releases?per_page=20')
        .flush([
          { tag_name: 'FreeWalk-v1.0', assets: [{ name: 'FreeWalk.zip' }, { name: 'doc.pdf' }] },
        ]);
    }, { timeout: 3000 });
    await fixture.whenStable();
    fixture.detectChanges();
    // Sugestões em datalist (sem campos duplicados) e autocompletar do que estava vazio.
    expect([...el.querySelectorAll('#tag-opcoes option')].map((o) => o.getAttribute('value'))).toEqual([
      'FreeWalk-v',
    ]);
    expect(el.querySelectorAll('#arquivo-opcoes option')).toHaveLength(2);
    expect((el.querySelector('#tag') as HTMLInputElement).value).toBe('FreeWalk-v');
    expect((el.querySelector('#arquivo') as HTMLInputElement).value).toBe('FreeWalk.zip');
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      repo: 'Sebola3461/FreeWalk',
      tag: 'FreeWalk-v',
      arquivo: 'FreeWalk.zip',
    });
    req.flush({ submission: { id: 's2', modId: 'freewalk', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('repositório sem releases avisa que tag e arquivo são à mão', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
    await vi.waitFor(() => {
      http
        .expectOne('https://api.github.com/repos/ana/mod-novo/releases?per_page=20')
        .flush([]);
    }, { timeout: 3000 });
    await fixture.whenStable();
    fixture.detectChanges();
    // O datalist fica no DOM mesmo vazio (não renderiza nada visível): o que interessa é não ter sugestão.
    expect(el.querySelectorAll('#tag-opcoes option')).toHaveLength(0);
    const hints = [...el.querySelectorAll('.form-hint')].map((h) => h.textContent?.trim());
    expect(hints.some((t) => t?.includes('ainda não tem releases'))).toBe(true);
  });

  it('repositório inválido vira aviso, não erro vermelho, e não chama a API', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { repo: '???' });
    await vi.waitFor(() => {
      expect(el.textContent).toContain('Repositório inválido');
    }, { timeout: 3000 });
    expect(text(el, '.form-error')).toBe('');
    http.expectNone('https://api.github.com/repos/ana/mod-novo/releases?per_page=20');
  });

  it('mods de ônibus e mapa só têm link externo, sem origem nem arquivo', async () => {
    const { fixture, el, http } = await setup(ANA);
    escolherTipo(el, 'onibus');
    fixture.detectChanges();
    expect(el.querySelector('input[name="origem"]')).toBeNull();
    expect(el.querySelector('#repo')).toBeNull();
    expect(el.querySelector('#tag')).toBeNull();
    expect(el.querySelector('#arquivo')).toBeNull();
    expect(el.querySelector('#url')).not.toBeNull();
    fill(el, {
      nome: 'Modão do Bairro',
      descricao: 'Descrição.',
      url: 'https://exemplo.com/modao.zip',
    });
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      tipo: 'onibus',
      origem: 'externa',
      url: 'https://exemplo.com/modao.zip',
    });
    expect((req.request.body as Record<string, unknown>)['mod']).not.toHaveProperty('repo');
    req.flush({ submission: { id: 's3', modId: 'modao-do-bairro', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    // Publicar um ônibus não pode prender o tipo: "Enviar outro mod" volta ao formulário plugin padrão.
    const outro = [...el.querySelectorAll('.panel .form-actions button')].find(
      (b) => b.textContent?.trim() === 'Enviar outro mod',
    ) as HTMLButtonElement;
    outro.click();
    fixture.detectChanges();
    expect((el.querySelector('#tipo') as HTMLSelectElement).value).toBe('plugin');
    expect(el.querySelector('input[name="origem"]')).not.toBeNull();
    expect(el.querySelector('#url')).toBeNull();
  });

  it('link externo no plugin troca os campos e envia a url', async () => {
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
    req.flush({ submission: { id: 's4', modId: 'mod-externo', status: 'pending', prNumber: null } });
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

    fill(el, { nome: 'Mod Novo', descricao: 'Descrição.' });
    preencherGithub(fixture, { repo: 'ana/mod-novo', tag: 'Novo-v', arquivo: 'Novo.dll' });
    marcarVersoes(el, ['307']);
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['capaBase64']).toBeTruthy();
    req.flush({ submission: { id: 's5', modId: 'mod-novo', status: 'pending', prNumber: null } });
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

  it('modo edição pré-preenche GitHub e versões, preserva dependências e envia como edit', async () => {
    const imagens = ['https://raw.githubusercontent.com/fulana/painel-digital/main/prints/a.png'];
    const { fixture, el, http } = await setupEdicao(
      githubMod({ dono: { site: ANA.id }, imagens }),
    );
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('Painel Digital');
    // Sem campo de id na tela: a edição manda o id da rota no payload.
    expect(el.querySelector('#id')).toBeNull();
    expect((el.querySelector('#repo') as HTMLInputElement).value).toBe('fulana/painel-digital');
    expect((el.querySelector('#galeria-repo') as HTMLInputElement).value).toBe(
      'fulana/painel-digital',
    );
    const select = el.querySelector('#versao-jogo') as HTMLSelectElement;
    expect([...select.selectedOptions].map((o) => o.value)).toEqual(['307']);
    expect(el.textContent).not.toContain('Dependências');
    fill(el, { descricao: 'Descrição nova.' });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('edit');
    expect(body['modId']).toBe('PainelDigital');
    expect((body['mod'] as Record<string, unknown>)['descricao']).toBe('Descrição nova.');
    expect((body['mod'] as Record<string, unknown>)['versoesDoJogo']).toEqual(['307']);
    expect((body['mod'] as Record<string, unknown>)['repo']).toBe('fulana/painel-digital');
    expect((body['mod'] as Record<string, unknown>)['id']).toBe('PainelDigital');
    expect((body['mod'] as Record<string, unknown>)['dependencias']).toEqual([
      'PBSLoaderCommonUtils',
    ]);
    expect(body['imagens']).toEqual(imagens);
    req.flush({
      submission: { id: 's6', modId: 'PainelDigital', status: 'pending', prNumber: null },
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
    req.flush({ submission: { id: 's7', modId: 'PainelDigital', status: 'pending', prNumber: null } });
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
      .flush({ submission: { id: 's8', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
    const another = [...el.querySelectorAll('.panel .form-actions button')].find(
      (b) => b.textContent?.trim() === 'Enviar outro mod',
    ) as HTMLButtonElement;
    another.click();
    fixture.detectChanges();
    expect(el.querySelector('form')).not.toBeNull();
    expect((el.querySelector('#nome') as HTMLInputElement).value).toBe('');
    expect(el.querySelector('#id')).toBeNull();
    expect(
      [...(el.querySelector('#versao-jogo') as HTMLSelectElement).options].some((o) => o.selected),
    ).toBe(false);
  });

  it('galeria lista imagens do repositório pela API pública e envia as escolhidas', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { nome: 'Mod Novo', descricao: 'Descrição.' });
    preencherGithub(fixture, { repo: 'ana/mod-novo', tag: 'Novo-v', arquivo: 'Novo.dll' });
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
    req.flush({ submission: { id: 's9', modId: 'mod-novo', status: 'pending', prNumber: null } });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('busca de imagens que falha mostra o erro e mantém o formulário', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { nome: 'Mod Novo', descricao: 'Descrição.' });
    preencherGithub(fixture, { repo: 'ana/mod-novo', tag: 'Novo-v', arquivo: 'Novo.dll' });
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
    req.flush({ submission: { id: 's10', modId: 'mod-novo', status: 'pending', prNumber: null } });
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
