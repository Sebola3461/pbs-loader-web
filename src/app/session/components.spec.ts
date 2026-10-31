import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { externalMod, githubMod, SITE_OWNER } from '../../testing/catalog-fixtures';
import { CatalogMod } from '../catalog/catalog.model';
import { GoogleButton, loadGoogleIdentity, resetGoogleIdentity } from './google-button';
import { NicknameForm } from './nickname-form';
import { RatingsStore } from './ratings.store';
import { SessionStore, SessionUser } from './session.store';
import { formatAverage, StarRating } from './star-rating';
import { UserMenu } from './user-menu';

const ANA: SessionUser = { id: 'u-ana', nickname: 'Ana', role: 'user' };
const conflict = (code: string) => new HttpErrorResponse({ status: 409, error: { error: code } });
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeSession(
  initial: { loaded?: boolean; user?: SessionUser | null; clientId?: string } = {},
) {
  const user = signal<SessionUser | null>(initial.user ?? null);
  const clientId = signal(initial.clientId ?? '');
  return {
    user,
    clientId,
    store: {
      loaded: signal(initial.loaded ?? true),
      user,
      googleClientId: clientId,
      needsNickname: () => user()?.nickname === null,
      signIn: vi.fn(async () => user.set(ANA)),
      signOut: vi.fn(async () => user.set(null)),
      setNickname: vi.fn(async (nickname: string) => user.set({ ...ANA, nickname })),
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
    const { el } = render(githubMod(), fakeSession({ loaded: false, clientId: 'cid' }));
    expect(el.querySelector('fieldset')).toBeNull();
    expect(el.querySelector('.hint')).toBeNull();
  });

  it('deslogado com login disponível convida a entrar; sem login, não', () => {
    let { el } = render(githubMod(), fakeSession({ clientId: 'cid' }));
    expect(el.querySelector('.hint')?.textContent).toContain('Entre com sua conta Google');
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

describe('NicknameForm', () => {
  function render(session = fakeSession({ user: { ...ANA, nickname: null } })) {
    provide(session);
    const fixture = TestBed.createComponent(NicknameForm);
    const done = vi.fn();
    fixture.componentInstance.done.subscribe(done);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = async (value: string) => {
      el.querySelector<HTMLInputElement>('#apelido')!.value = value;
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      fixture.detectChanges();
    };
    return { el, done, submit, session };
  }

  it('salva e avisa que terminou; sem apelido anterior não há "Cancelar"', async () => {
    const { el, done, submit, session } = render();
    expect(el.querySelector('.button-secondary')).toBeNull();
    await submit('Ana Silva');
    expect(session.store.setNickname).toHaveBeenCalledWith('Ana Silva');
    expect(done).toHaveBeenCalledOnce();
  });

  it('mostra o erro da API e marca o campo', async () => {
    const session = fakeSession({ user: { ...ANA, nickname: null } });
    session.store.setNickname.mockRejectedValueOnce(conflict('nickname_taken'));
    const { el, done, submit } = render(session);
    await submit('Ana');
    expect(el.querySelector('.error')?.textContent).toBe('Esse apelido já está em uso.');
    expect(el.querySelector('#apelido')?.getAttribute('aria-invalid')).toBe('true');
    expect(done).not.toHaveBeenCalled();
  });

  it('com apelido atual, preenche o campo e permite cancelar', () => {
    const { el, done } = render(fakeSession({ user: ANA }));
    expect(el.querySelector<HTMLInputElement>('#apelido')?.value).toBe('Ana');
    el.querySelector<HTMLButtonElement>('.button-secondary')!.click();
    expect(done).toHaveBeenCalledOnce();
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
    expect(el.querySelector('app-google-button')).toBeNull();
    expect(el.querySelector('.user')).toBeNull();
  });

  it('deslogado com client ID mostra o botão do Google', () => {
    const { el } = render(fakeSession({ clientId: 'cid' }));
    expect(el.querySelector('app-google-button')).not.toBeNull();
  });

  it('logado mostra o apelido e sai', async () => {
    const session = fakeSession({ user: ANA, clientId: 'cid' });
    const { el, fixture } = render(session);
    expect(el.querySelector('.nickname')?.textContent?.trim()).toBe('Ana');
    el.querySelector<HTMLButtonElement>('.button-secondary')!.click();
    await settle();
    fixture.detectChanges();
    expect(session.store.signOut).toHaveBeenCalled();
    expect(el.querySelector('app-google-button')).not.toBeNull();
  });

  it('erro ao sair aparece', async () => {
    const session = fakeSession({ user: ANA });
    session.store.signOut.mockRejectedValueOnce(new Error('rede'));
    const { el, fixture } = render(session);
    el.querySelector<HTMLButtonElement>('.button-secondary')!.click();
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.error')?.textContent).toBe('Algo deu errado. Tente de novo.');
  });

  it('sem apelido abre a escolha na hora; salvar fecha', async () => {
    const session = fakeSession({ user: { ...ANA, nickname: null } });
    const { el, fixture } = render(session);
    fixture.detectChanges();
    const dialog = el.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(el.querySelector('.nickname')?.textContent?.trim()).toBe('Escolher apelido');
    el.querySelector<HTMLInputElement>('#apelido')!.value = 'Ana';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(el.querySelector('app-nickname-form')).toBeNull();
  });

  it('clicar no apelido abre a troca', () => {
    const { el, fixture } = render(fakeSession({ user: ANA }));
    el.querySelector<HTMLButtonElement>('.nickname')!.click();
    fixture.detectChanges();
    expect(el.querySelector('dialog')!.open).toBe(true);
    el.querySelector<HTMLButtonElement>('.nickname')!.click();
    expect(el.querySelector('dialog')!.open).toBe(true);
  });
});

describe('GoogleButton', () => {
  beforeEach(() => resetGoogleIdentity());

  interface FakeGoogle {
    callback?: (r: { credential: string }) => void;
    rendered: HTMLElement[];
  }

  function installGoogle(fail = false): FakeGoogle {
    const fake: FakeGoogle = { rendered: [] };
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      const script = node as HTMLScriptElement;
      (window as unknown as { google: unknown }).google = {
        accounts: {
          id: {
            initialize: (o: { callback: FakeGoogle['callback'] }) => (fake.callback = o.callback),
            renderButton: (el: HTMLElement) => fake.rendered.push(el),
          },
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
      return node;
    }) as typeof document.head.appendChild);
    (window as unknown as { google: unknown }).google = { ok: true };
    const first = loadGoogleIdentity(document);
    const second = loadGoogleIdentity(document);
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(append).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  it('desenha o botão e troca o token por sessão', async () => {
    const fake = installGoogle();
    const session = fakeSession({ clientId: 'cid' });
    provide(session);
    const fixture = TestBed.createComponent(GoogleButton);
    fixture.componentRef.setInput('clientId', 'cid');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.rendered).toHaveLength(1);
    fake.callback?.({ credential: 'tok' });
    await settle();
    expect(session.store.signIn).toHaveBeenCalledWith('tok');
  });

  it('script bloqueado avisa e permite tentar de novo depois', async () => {
    installGoogle(true);
    provide(fakeSession({ clientId: 'cid' }));
    const fixture = TestBed.createComponent(GoogleButton);
    fixture.componentRef.setInput('clientId', 'cid');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain('não carregou');
  });

  it('erro no login aparece embaixo do botão', async () => {
    const fake = installGoogle();
    const session = fakeSession({ clientId: 'cid' });
    session.store.signIn.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 401, error: { error: 'invalid_token' } }),
    );
    provide(session);
    const fixture = TestBed.createComponent(GoogleButton);
    fixture.componentRef.setInput('clientId', 'cid');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 10));
    fake.callback?.({ credential: 'tok' });
    await settle();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain(
      'Não deu para confirmar',
    );
  });
});
