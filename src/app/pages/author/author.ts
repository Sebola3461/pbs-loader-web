import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { sortMods } from '../../catalog/catalog';
import { CatalogStore } from '../../catalog/catalog.store';
import { ModCard } from '../../components/mod-card/mod-card';
import { NotFound } from '../not-found/not-found';

@Component({
  selector: 'app-author',
  imports: [RouterLink, ModCard, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (author(); as author) {
      <section class="author">
        <nav class="breadcrumb" aria-label="Você está em">
          <a routerLink="/">Mods</a> <span aria-hidden="true">/</span>
          <span aria-current="page">{{ author.nome }}</span>
        </nav>
        <h1>{{ author.nome }}</h1>
        <p class="count">
          {{ author.modCount }} {{ author.modCount === 1 ? 'mod publicado' : 'mods publicados' }}
        </p>
        <ul class="grid" aria-label="Mods de {{ author.nome }}">
          @for (mod of mods(); track mod.id) {
            <li><app-mod-card [mod]="mod" /></li>
          }
        </ul>
      </section>
    } @else {
      <app-not-found
        heading="Autor não encontrado"
        message="Não há mods deste autor no catálogo."
      />
    }
  `,
  styles: `
    .author {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-block: var(--space-5);
    }
    .breadcrumb,
    .count {
      color: var(--color-muted-foreground);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: var(--space-4);
      list-style: none;
      margin-top: var(--space-3);
    }
  `,
})
export class AuthorPage {
  private readonly store = inject(CatalogStore);

  /** Parâmetro :slug da rota (withComponentInputBinding). */
  readonly slug = input.required<string>();

  protected readonly author = computed(() => this.store.findAuthor(this.slug()));
  protected readonly mods = computed(() =>
    sortMods(this.store.modsByAuthor(this.slug()), 'recentes'),
  );
}
