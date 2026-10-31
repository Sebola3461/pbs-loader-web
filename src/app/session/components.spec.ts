import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { externalMod, githubMod, SITE_OWNER } from '../../testing/catalog-fixtures';
import { CatalogMod } from '../catalog/catalog.model';
import { LoginForm } from './login-form';
import { PasswordForm } from './password-form';
import { RatingsStore } from './ratings.store';
import { SessionStore, SessionUser } from './session.store';
import { formatAverage, StarRating } from './star-rating';
import { loadTurnstile, resetTurnstileLoader } from './turnstile';
import { UserMenu } from './user-menu';
import { UsernameForm } from './username-form';

const ANA: SessionUser = { id: 'u-ana', username: 'Ana', role: 'user' };
const conflict = (code: string) => new HttpErrorResponse({ status: 409, error: { error: code } });
const unauthorized = (code: string) => new HttpErrorResponse({ status: 401, error: { error: code } });
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeSession(
  initial: { loaded?: boolean; user?: SessionUser | null; siteKey?: string } = {},
) {
  const user = signal<SessionUser | null>(initial.user ?? null);
  const siteKey = signal(initial.siteKey ?? '');
  return {
    user,
    siteKey,
    store: {
      loaded: signal(initial.loaded ?? true),
      user,
      siteKey,
      register: vi.fn(async () => user.set(ANA)),
      login: vi.fn(async () => user.set(ANA)),
      signOut: vi.fn(async () => user.set(null)),
      setUsername: vi.fn(async (username: string) => user.set({ ...ANA, username })),
      changePassword: vi.fn(async () => {}),
    },
  };
}

function fakeRatings(stats = {}, mine = {}) {
  return {
    stats: signal<Record<string, { count: number; average: number }>>(stats),
    mine: signal<Record<string, number>>(mine),
    rate: vi.fn(async () => {}),
    unrate: vi.fn(async () => {}),
  };
}

function provide(session: ReturnType<typeof fakeSession>, ratings = fakeRatings()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: SessionStore, useValue: session.store },
      { provide: RatingsStore, useValue: ratings },
    ],
  });
  return ratings;
}

const buttonByText = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;

beforeAll(() => {
  // O jsdom não implementa <dialog>.showModal/close.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('StarRating', () => {
  function render(mod: CatalogMod, session = fakeSession(), ratings = fakeRatings()) {
    provide(session, ratings);
    const fixture = TestBed.createComponent(StarRating);
    fixture.componentRef.setInput('mod', mod);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, ratings, session };
  }

  it('formata a média com uma casa, em pt-BR', () => {
    expect(formatAverage(4.333)).toBe('4,3');
    expect(formatAverage(5)).toBe('5,0');
  });

  it('mostra média e contagem; sem votos, avisa', () => {
    let { el } = render(
      githubMod(),
      fakeSession(),
      fakeRatings({ PainelDigital: { count: 3, average: 4.33 } }),
    );
    expect(el.querySelector('.average')?.textContent).toContain('4,3');
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('3 avaliações');
    TestBed.resetTestingModule();
    ({ el } = render(
      githubMod(),
      fakeSession(),
      fakeRatings({ PainelDigital: { count: 1, average: 5 } }),
    ));
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('1 avaliação');
    TestBed.resetTestingModule();
    ({ el } = render(githubMod()));
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('Ainda sem avaliações.');
  });

  it('antes de carregar a sessão não mostra nada de nota', () => {
    const { el } = render(githubMod(), fakeSession({ loaded: false, siteKey: 'cid' }));
    expect(el.querySelector('fieldset')).toBeNull();
    expect(el.querySelector('.hint')).toBeNull();
  });

  it('deslogado com login disponível convida a entrar; sem login, não', () => {
    let { el } = render(githubMod(), fakeSession({ siteKey: 'cid' }));
    expect(el.querySelector('.hint')?.textContent).toContain('Crie sua conta ou entre');
    TestBed.resetTestingModule();
    ({ el } = render(githubMod(), fakeSession()));
    expect(el.querySelector('.hint')).toBeNull();
  });

  it('dono do mod não avalia o próprio mod', () => {
    const { el } = render(externalMod({ dono: { site: 'u-ana' } }), fakeSession({ user: ANA }));
    expect(el.querySelector('.hint')?.textContent).toContain('próprio mod');
    expect(el.querySelector('fieldset')).toBeNull();
  });

  it('marca a nota atual e avalia ao escolher', async () => {
    const { el, ratings, fixture } = render(
      githubMod(),
      fakeSession({ user: ANA }),
      fakeRatings({}, { PainelDigital: 3 }),
    );
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[name="nota"]')];
    expect(radios.map((r) => r.checked)).toEqual([false, false, true, false, false]);
    expect(el.querySelectorAll('.star.filled')).toHaveLength(3);
    expect(el.querySelector('.star .visually-hidden')?.textContent).toBe('1 estrela');
    radios[4].checked = true;
    radios[4].dispatchEvent(new Event('change'));
    await settle();
    expect(ratings.rate).toHaveBeenCalledWith('PainelDigital', 5);
    el.querySelector<HTMLButtonElement>('.remove')!.click();
    await settle();
    expect(ratings.unrate).toHaveBeenCalledWith('PainelDigital');
    fixture.detectChanges();
    expect(el.querySelector('.error')).toBeNull();
  });

  it('sem nota própria não mostra "Remover"; erro da API aparece', async () => {
    const ratings = fakeRatings();
    ratings.rate.mockRejectedValueOnce(conflict('too_many_changes'));
    const { el, fixture } = render(githubMod(), fakeSession({ user: ANA }), ratings);
    expect(el.querySelector('.remove')).toBeNull();
    const radio = el.querySelector<HTMLInputElement>('input[value="2"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.error')?.textContent).toContain('Muitas mudanças');
  });

  it('autor do GitHub com mesmo id não conta como dono', () => {
    const { el } = render(githubMod({ dono: { github: 'u-ana' } }), fakeSession({ user: ANA }));
    expect(el.querySelector('fieldset')).not.toBeNull();
    expect(SITE_OWNER).toBeTruthy();
  });
});

describe('UsernameForm', () => {
  function render(session = fakeSession({ user: ANA })) {
    provide(session);
    const fixture = TestBed.createComponent(UsernameForm);
    const done = vi.fn();
    fixture.componentInstance.done.subscribe(done);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = async (value: string) => {
      el.querySelector<HTMLInputElement>('#nome')!.value = value;
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      fixture.detectChanges();
    };
    return { el, done, submit, session };
  }

  it('salva e avisa que terminou', async () => {
    const { el, done, submit, session } = render();
    await submit('Ana Silva');
    expect(session.store.setUsername).toHaveBeenCalledWith('Ana Silva');
    expect(done).toHaveBeenCalledOnce();
  });

  it('mostra o erro da API e marca o campo', async () => {
    const session = fakeSession({ user: ANA });
    session.store.setUsername.mockRejectedValueOnce(conflict('username_taken'));
    const { el, done, submit } = render(session);
    await submit('Ana');
    expect(el.querySelector('.error')?.textContent).toBe('Esse nome já está em uso.');
    expect(el.querySelector('#nome')?.getAttribute('aria-invalid')).toBe('true');
    expect(done).not.toHaveBeenCalled();
  });

  it('preenche o campo com o nome atual e permite cancelar', () => {
    const { el, done } = render(fakeSession({ user: ANA }));
    expect(el.querySelector<HTMLInputElement>('#nome')?.value).toBe('Ana');
    el.querySelector<HTMLButtonElement>('.button-secondary')!.click();
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('PasswordForm', () => {
  function render(session = fakeSession({ user: ANA })) {
    provide(session);
    const fixture = TestBed.createComponent(PasswordForm);
    const done = vi.fn();
    fixture.componentInstance.done.subscribe(done);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = async (current: string, next: string) => {
      el.querySelector<HTMLInputElement>('#senha-atual')!.value = current;
      el.querySelector<HTMLInputElement>('#nova-senha')!.value = next;
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      fixture.detectChanges();
    };
    return { el, done, submit, session };
  }

  it('manda atual e nova e avisa que terminou', async () => {
    const { done, submit, session } = render();
    await submit('velha-forte-1', 'nova-forte-99');
    expect(session.store.changePassword).toHaveBeenCalledWith('velha-forte-1', 'nova-forte-99');
    expect(done).toHaveBeenCalledOnce();
  });

  it('senha atual errada aparece como erro e não fecha', async () => {
    const session = fakeSession({ user: ANA });
    session.store.changePassword.mockRejectedValueOnce(conflict('wrong_password'));
    const { el, done, submit } = render(session);
    await submit('errada-total', 'nova-forte-99');
    expect(el.querySelector('.error')?.textContent).toBe('A senha atual não confere.');
    expect(done).not.toHaveBeenCalled();
  });
});

describe('UserMenu', () => {
  function render(session: ReturnType<typeof fakeSession>) {
    provide(session);
    const fixture = TestBed.createComponent(UserMenu);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('sem login disponível não mostra nada', () => {
    const { el } = render(fakeSession());
    expect(el.querySelector('app-login-form')).toBeNull();
    expect(el.querySelector('.user')).toBeNull();
  });

  it('deslogado com chave do Turnstile mostra o botão Entrar, que abre o formulário no diálogo', () => {
    const { el, fixture } = render(fakeSession({ siteKey: 'cid' }));
    expect(el.querySelector('app-login-form')).toBeNull();
    buttonByText(el, 'Entrar').click();
    fixture.detectChanges();
    expect(el.querySelector('app-login-form')).not.toBeNull();
    expect(el.querySelector('dialog')!.open).toBe(true);
  });

  it('logado mostra o nome e sai', async () => {
    const session = fakeSession({ user: ANA, siteKey: 'cid' });
    const { el, fixture } = render(session);
    expect(el.querySelector('.username')?.textContent?.trim()).toBe('Ana');
    buttonByText(el, 'Sair').click();
    await settle();
    fixture.detectChanges();
    expect(session.store.signOut).toHaveBeenCalled();
  });

  it('erro ao sair aparece', async () => {
    const session = fakeSession({ user: ANA });
    session.store.signOut.mockRejectedValueOnce(new Error('rede'));
    const { el, fixture } = render(session);
    buttonByText(el, 'Sair').click();
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.error')?.textContent).toBe('Algo deu errado. Tente de novo.');
  });

  it('clicar no nome abre a troca; salvar fecha', async () => {
    const session = fakeSession({ user: ANA });
    const { el, fixture } = render(session);
    el.querySelector<HTMLButtonElement>('.username')!.click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog[aria-labelledby="nome-titulo"]') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    el.querySelector<HTMLInputElement>('#nome')!.value = 'Ana Silva';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    fixture.detectChanges();
    expect(session.store.setUsername).toHaveBeenCalledWith('Ana Silva');
    expect(el.querySelector('app-username-form')).toBeNull();
  });

  it('clicar em Senha abre a troca de senha', () => {
    const { el, fixture } = render(fakeSession({ user: ANA }));
    buttonByText(el, 'Senha').click();
    fixture.detectChanges();
    expect(el.querySelector('app-password-form')).not.toBeNull();
  });
});

describe('Turnstile', () => {
  beforeEach(() => resetTurnstileLoader());

  interface FakeTurnstile {
    rendered: Array<{
      el: HTMLElement;
      options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      };
    }>;
    resets: number;
    removed: number;
  }

  function installTurnstile(fail = false): FakeTurnstile {
    const fake: FakeTurnstile = { rendered: [], resets: 0, removed: 0 };
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      const script = node as HTMLScriptElement;
      (window as unknown as { turnstile: unknown }).turnstile = {
        render: (el: HTMLElement, options: FakeTurnstile['rendered'][0]['options']) => {
          fake.rendered.push({ el, options });
          return `wid-${fake.rendered.length}`;
        },
        reset: () => {
          fake.resets++;
        },
        remove: () => {
          fake.removed++;
        },
      };
      setTimeout(() =>
        fail ? script.onerror?.(new Event('error')) : script.onload?.(new Event('load')),
      );
      return node;
    }) as typeof document.head.appendChild);
    onTestFinished(() => append.mockRestore());
    return fake;
  }

  it('carrega o script uma vez e reaproveita', async () => {
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      setTimeout(() => (node as HTMLScriptElement).onload?.(new Event('load')));
      (window as unknown as { turnstile: unknown }).turnstile = { ok: true };
      return node;
    }) as typeof document.head.appendChild);
    const first = loadTurnstile(document);
    const second = loadTurnstile(document);
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(append).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  function renderForm(session = fakeSession({ siteKey: 'cid' })) {
    provide(session);
    const fixture = TestBed.createComponent(LoginForm);
    fixture.componentRef.setInput('siteKey', 'cid');
    fixture.detectChanges();
    return { session, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('mostra o widget, entra com o token e limpa o widget ao sair da página', async () => {
    const fake = installTurnstile();
    const session = renderForm();
    await session.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.rendered).toHaveLength(1);
    expect(fake.rendered[0].options.sitekey).toBe('cid');
    fake.rendered[0].options.callback('tok');
    await settle();
    session.fixture.detectChanges();
    const el = session.el;
    el.querySelector<HTMLInputElement>('#usuario')!.value = 'Ana';
    el.querySelector<HTMLInputElement>('#senha')!.value = 'senha-forte-1';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(session.session.store.login).toHaveBeenCalledWith('Ana', 'senha-forte-1', 'tok');
    session.fixture.destroy();
    expect(fake.removed).toBe(1);
  });

  it('alternar para criar conta chama register', async () => {
    const fake = installTurnstile();
    const session = renderForm();
    await session.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    fake.rendered[0].options.callback('tok');
    await settle();
    buttonByText(session.el, 'Criar conta').click();
    session.fixture.detectChanges();
    session.el.querySelector<HTMLInputElement>('#usuario')!.value = 'Bia';
    session.el.querySelector<HTMLInputElement>('#senha')!.value = 'senha-forte-1';
    session.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(session.session.store.register).toHaveBeenCalledWith('Bia', 'senha-forte-1', 'tok');
  });

  it('script bloqueado avisa e permite tentar de novo depois', async () => {
    installTurnstile(true);
    const session = renderForm();
    await session.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    session.fixture.detectChanges();
    expect(session.el.querySelector('.error')?.textContent).toContain('não carregou');
  });

  it('erro no login reseta o desafio e pede um token novo', async () => {
    const fake = installTurnstile();
    const session = renderForm();
    await session.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    fake.rendered[0].options.callback('tok');
    await settle();
    session.session.store.login.mockRejectedValueOnce(unauthorized('invalid_credentials'));
    session.el.querySelector<HTMLInputElement>('#usuario')!.value = 'Ana';
    session.el.querySelector<HTMLInputElement>('#senha')!.value = 'senha-errada-9';
    session.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    session.fixture.detectChanges();
    expect(session.el.querySelector('.error')?.textContent).toContain('incorretos');
    expect(fake.resets).toBe(1);
    expect(session.el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
  });
});
