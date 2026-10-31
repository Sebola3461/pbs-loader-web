import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { SessionStore } from '../../session/session.store';
import { MySubmissions } from './my-submissions';

const ANA = { id: 'u-ana', username: 'Ana', role: 'user' as const };

const ENVIO = {
  id: 'sub-1',
  modId: 'PainelDigital',
  operation: 'publish',
  payload: '{"id":"PainelDigital"}',
  idempotencyKey: 'chave-0001',
  status: 'pending',
  prNumber: 5,
  createdAt: '2026-10-31T12:00:00Z',
};

const text = (el: HTMLElement, selector: string) =>
  el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

// Continuações de promessa (o load() após o flush) rodam em microtask: dar a vez antes de esperar o request.
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

async function setup(user: typeof ANA | null, submissions: unknown[]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCatalog(githubMod()),
    ],
  });
  const fixture = TestBed.createComponent(MySubmissions);
  const http = TestBed.inject(HttpTestingController);
  const done = TestBed.inject(SessionStore).load();
  http.expectOne('/api/me').flush({ user, turnstileSiteKey: '' });
  await done;
  await fixture.whenStable();
  fixture.detectChanges();
  // A carga dos envios parte do afterNextRender; aguardar o whenStable seguinte a pegou.
  const req = http.expectOne('/api/me/submissions');
  req.flush({ submissions });
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, http };
}

describe('MySubmissions', () => {
  it('sem conta, convida a entrar', async () => {
    const { el } = await setup(null, []);
    expect(text(el, '.panel p')).toContain('Entre com sua conta');
    expect(el.querySelector('.lista')).toBeNull();
  });

  it('lista os envios com estado, link do PR e link do mod no catálogo', async () => {
    const { el } = await setup(ANA, [ENVIO]);
    expect(text(el, '.envio-id')).toContain('PainelDigital');
    expect(text(el, '.envio-op')).toBe('publicar');
    expect(text(el, '.badge')).toBe('Em publicação');
    expect(el.querySelector('.envio-pr')?.getAttribute('href')).toContain('/pull/5');
    expect(el.querySelector('.envio-id a')?.getAttribute('href')).toBe(
      '/mods/gh-fulana/PainelDigital',
    );
  });

  it('envio falhado ganha o botão que repete com a mesma chave e o mesmo payload', async () => {
    const { fixture, el, http } = await setup(ANA, [{ ...ENVIO, status: 'failed', prNumber: null }]);
    const badge = text(el, '.badge');
    expect(badge).toContain('Falhou');
    (el.querySelector('.envio-acoes button') as HTMLButtonElement).click();
    const req = http.expectOne('/api/submissions');
    const body = req.request.body as Record<string, unknown>;
    expect(body['operation']).toBe('publish');
    expect(body['idempotencyKey']).toBe('chave-0001');
    expect((body['mod'] as Record<string, unknown>)['id']).toBe('PainelDigital');
    req.flush({ submission: { id: 'sub-1', modId: 'PainelDigital', status: 'pending', prNumber: 6 } });
    // Depois do reenvio, a lista recarrega e mostra o estado novo.
    await flushMicrotasks();
    http
      .expectOne('/api/me/submissions')
      .flush({ submissions: [{ ...ENVIO, status: 'pending', prNumber: 6 }] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el, '.badge')).toBe('Em publicação');
  });

  it('sem envios, convida a enviar o primeiro', async () => {
    const { el } = await setup(ANA, []);
    expect(text(el, '.panel p')).toContain('Você ainda não enviou nada');
    expect(el.querySelector('.panel a')?.getAttribute('href')).toBe('/enviar');
  });
});
