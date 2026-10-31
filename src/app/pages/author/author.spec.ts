import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { externalMod, githubMod, provideCatalog } from '../../../testing/catalog-fixtures';
import { AuthorPage } from './author';

function render(slug: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideCatalog(
        githubMod(),
        githubMod({ id: 'Som', nome: 'Som do Motor', atualizadoEm: '2026-10-25T00:00:00Z' }),
        externalMod(),
      ),
    ],
  });
  const fixture = TestBed.createComponent(AuthorPage);
  fixture.componentRef.setInput('slug', slug);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AuthorPage', () => {
  it('lista os mods do autor, do mais recente para o mais antigo', () => {
    const el = render('gh-fulana');
    expect(el.querySelector('h1')?.textContent).toBe('Fulana');
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 mods publicados');
    expect([...el.querySelectorAll('.title a')].map((a) => a.textContent?.trim())).toEqual([
      'Som do Motor',
      'Painel Digital',
    ]);
  });

  it('usa o singular com um mod só', () => {
    const el = render('site-01928c3e-7b2a-7c4d-8e9f-0123456789ab');
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('1 mod publicado');
  });

  it('autor que não existe mostra a página de não encontrado', () => {
    const el = render('gh-ninguem');
    expect(el.querySelector('h1')?.textContent).toBe('Autor não encontrado');
  });
});
