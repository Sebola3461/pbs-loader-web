import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiErrorMessage } from './api-error';
import { RatingsStore } from './ratings.store';
import { SessionStore } from './session.store';

const ANA = { id: 'u-ana', username: 'Ana', role: 'user' as const };

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return {
    session: TestBed.inject(SessionStore),
    ratings: TestBed.inject(RatingsStore),
    http: TestBed.inject(HttpTestingController),
  };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('SessionStore', () => {
  it('começa não carregado e carrega usuário e chave do Turnstile', async () => {
    const { session, http } = setup();
    expect(session.loaded()).toBe(false);
    const done = session.load();
    http.expectOne('/api/me').flush({ user: ANA, turnstileSiteKey: 'chave' });
    await done;
    expect(session.loaded()).toBe(true);
    expect(session.user()).toEqual(ANA);
    expect(session.siteKey()).toBe('chave');
  });

  it('sem API, segue sem login e sem formulário', async () => {
    const { session, http } = setup();
    const done = session.load();
    http.expectOne('/api/me').flush('', { status: 404, statusText: 'Not Found' });
    await done;
    expect(session.loaded()).toBe(true);
    expect(session.user()).toBeNull();
    expect(session.siteKey()).toBe('');
  });

  it('cria conta, entra, troca nome, troca senha e sai', async () => {
    const { session, http } = setup();

    let done = session.register('Ana', 'senha-forte-1', 'tok');
    const register = http.expectOne('/api/auth/register');
    expect(register.request.method).toBe('POST');
    expect(register.request.body).toEqual({
      username: 'Ana',
      password: 'senha-forte-1',
      turnstileToken: 'tok',
    });
    register.flush({ user: ANA });
    await done;
    expect(session.user()).toEqual(ANA);

    done = session.login('Ana', 'senha-forte-1', 'tok');
    const login = http.expectOne('/api/auth/login');
    expect(login.request.method).toBe('POST');
    expect(login.request.body).toEqual({
      username: 'Ana',
      password: 'senha-forte-1',
      turnstileToken: 'tok',
    });
    login.flush({ user: ANA });
    await done;
    expect(session.user()).toEqual(ANA);

    done = session.setUsername('Ana Silva');
    const rename = http.expectOne('/api/me/username');
    expect(rename.request.method).toBe('PUT');
    expect(rename.request.body).toEqual({ username: 'Ana Silva' });
    rename.flush({ user: { ...ANA, username: 'Ana Silva' } });
    await done;
    expect(session.user()?.username).toBe('Ana Silva');

    done = session.changePassword('senha-forte-1', 'nova-forte-99');
    const password = http.expectOne('/api/me/password');
    expect(password.request.method).toBe('PUT');
    expect(password.request.body).toEqual({
      currentPassword: 'senha-forte-1',
      newPassword: 'nova-forte-99',
    });
    password.flush({ user: ANA });
    await done;
    expect(session.user()).toEqual(ANA);

    done = session.signOut();
    const out = http.expectOne('/api/session');
    expect(out.request.method).toBe('DELETE');
    out.flush(null);
    await done;
    expect(session.user()).toBeNull();
  });
});

describe('RatingsStore', () => {
  it('carrega estatísticas; falha deixa vazio', async () => {
    const { ratings, http } = setup();
    let done = ratings.loadStats();
    http.expectOne('/api/stats').flush({ mods: { A: { count: 2, average: 4.5 } } });
    await done;
    expect(ratings.stats()).toEqual({ A: { count: 2, average: 4.5 } });
    done = ratings.loadStats();
    http.expectOne('/api/stats').error(new ProgressEvent('offline'));
    await done;
    expect(ratings.stats()).toEqual({ A: { count: 2, average: 4.5 } });
  });

  it('busca as notas do usuário ao logar e limpa ao sair', async () => {
    const { session, ratings, http } = setup();
    const login = session.login('Ana', 'senha-forte-1', 'tok');
    http.expectOne('/api/auth/login').flush({ user: ANA });
    await login;
    TestBed.tick();
    http.expectOne('/api/me/ratings').flush({ ratings: { A: 4 } });
    await flushMicrotasks();
    expect(ratings.mine()).toEqual({ A: 4 });

    const out = session.signOut();
    http.expectOne('/api/session').flush(null);
    await out;
    TestBed.tick();
    expect(ratings.mine()).toEqual({});
  });

  it('erro ao buscar as notas do usuário deixa vazio', async () => {
    const { session, ratings, http } = setup();
    const login = session.login('Ana', 'senha-forte-1', 'tok');
    http.expectOne('/api/auth/login').flush({ user: ANA });
    await login;
    TestBed.tick();
    http.expectOne('/api/me/ratings').flush({}, { status: 500, statusText: 'erro' });
    await flushMicrotasks();
    expect(ratings.mine()).toEqual({});
  });

  it('avaliar e tirar a nota usam a média que volta na resposta, sem buscar /api/stats', async () => {
    const { ratings, http } = setup();
    ratings.stats.set({ Outro: { count: 2, average: 3 } });
    let done = ratings.rate('Meu Mod', 5);
    const put = http.expectOne('/api/mods/Meu%20Mod/rating');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ stars: 5 });
    put.flush({ modId: 'Meu Mod', stars: 5, stats: { count: 1, average: 5 } });
    await done;
    expect(ratings.mine()).toEqual({ 'Meu Mod': 5 });
    expect(ratings.stats()).toEqual({
      Outro: { count: 2, average: 3 },
      'Meu Mod': { count: 1, average: 5 },
    });

    done = ratings.unrate('Meu Mod');
    const del = http.expectOne('/api/mods/Meu%20Mod/rating');
    expect(del.request.method).toBe('DELETE');
    del.flush({ modId: 'Meu Mod', stats: null });
    await done;
    expect(ratings.mine()).toEqual({});
    expect(ratings.stats()).toEqual({ Outro: { count: 2, average: 3 } });
    http.expectNone('/api/stats');
  });
});

describe('apiErrorMessage', () => {
  const error = (body: unknown) => new HttpErrorResponse({ status: 400, error: body });

  it('traduz os códigos conhecidos e cai numa mensagem genérica no resto', () => {
    expect(apiErrorMessage(error({ error: 'username_taken' }))).toBe('Esse nome já está em uso.');
    expect(apiErrorMessage(error({ error: 'invalid_credentials' }))).toBe(
      'Usuário ou senha incorretos.',
    );
    expect(apiErrorMessage(error({ error: 'own_mod' }))).toBe(
      'Você não pode avaliar o próprio mod.',
    );
    expect(apiErrorMessage(error({ error: 'desconhecido' }))).toBe(
      'Algo deu errado. Tente de novo.',
    );
    expect(apiErrorMessage(error(null))).toBe('Algo deu errado. Tente de novo.');
    expect(apiErrorMessage(new Error('x'))).toBe('Algo deu errado. Tente de novo.');
  });
});
