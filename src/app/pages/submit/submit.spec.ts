import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../../session/session.store';
import { Submit } from './submit';

const ANA = { id: 'u-ana', username: 'Ana', role: 'user' as const };

async function setup(user: typeof ANA | null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

function fill(el: HTMLElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    (el.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
  }
}

/** O jsdom valida e dispara o submit sem bloquear: o evento chega ao componente como no navegador. */
function submitForm(el: HTMLElement) {
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
}

const FORM_DEFAULTS = {
  id: 'Novo',
  nome: 'Mod Novo',
  descricao: 'Descrição.',
  versoes: '307',
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

  it('logado mostra o formulário com todos os tipos de mod', async () => {
    const { el } = await setup(ANA);
    expect(el.querySelectorAll('#tipo option')).toHaveLength(7);
    expect(el.querySelector('#repo')).not.toBeNull();
    expect(el.querySelector('#url')).toBeNull();
  });

  it('envia publish com dono e idempotência do cliente', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { ...FORM_DEFAULTS, versoes: '307, 306' });
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
      versoesDoJogo: ['307', '306'],
      dependencias: [],
      origem: 'github',
      repo: 'ana/mod-novo',
      capa: null,
    });
    req.flush({ submission: { id: 's1', modId: 'Novo', status: 'pending' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.panel p')).toContain('Novo foi enviado para publicação');
  });

  it('erro da API aparece no formulário e permite tentar de novo', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, FORM_DEFAULTS);
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

  it('versões vazias falham no cliente, sem chamada à API', async () => {
    const { fixture, el, http } = await setup(ANA);
    fill(el, { ...FORM_DEFAULTS, versoes: ' , ' });
    submitForm(el);
    fixture.detectChanges();
    expect(text(el, '.form-error')).toContain('Informe de 1 a 10 versões');
    http.expectNone('/api/submissions');
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
      versoes: '307',
      url: 'https://exemplo.com/mod.zip',
    });
    submitForm(el);
    const req = http.expectOne('/api/submissions');
    expect((req.request.body as Record<string, unknown>)['mod']).toMatchObject({
      origem: 'externa',
      url: 'https://exemplo.com/mod.zip',
    });
    req.flush({ submission: { id: 's2', modId: 'Externo', status: 'pending' } });
    await fixture.whenStable();
    fixture.detectChanges();
  });
});
