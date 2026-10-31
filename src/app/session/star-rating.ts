import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CatalogMod } from '../catalog/catalog.model';
import { apiErrorMessage } from './api-error';
import { RatingsStore } from './ratings.store';
import { SessionStore } from './session.store';

const STARS = [1, 2, 3, 4, 5] as const;

export function formatAverage(average: number): string {
  return average.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Média do mod e a nota de quem está logado. */
@Component({
  selector: 'app-star-rating',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rating" aria-labelledby="avaliacao-titulo">
      <h2 id="avaliacao-titulo">Avaliação</h2>
      <p class="summary">
        @if (stats(); as s) {
          <span class="average" aria-hidden="true">★ {{ average() }}</span>
          <span class="visually-hidden">Nota média {{ average() }} de 5.</span>
          <span class="count">
            {{ s.count }} {{ s.count === 1 ? 'avaliação' : 'avaliações' }}
          </span>
        } @else {
          <span class="count">Ainda sem avaliações.</span>
        }
      </p>

      @if (!session.loaded()) {
        <!-- O pré-render não sabe quem está logado; o bloco de nota aparece depois de carregar. -->
      } @else if (isOwnMod()) {
        <p class="hint">Você não pode avaliar o próprio mod.</p>
      } @else if (session.user()) {
        <fieldset class="stars" [disabled]="saving()">
          <legend>Sua nota</legend>
          @for (value of stars; track value) {
            <label class="star" [class.filled]="value <= (mine() ?? 0)">
              <input
                type="radio"
                name="nota"
                [value]="value"
                [checked]="mine() === value"
                (change)="rate(value)"
              />
              <span aria-hidden="true">★</span>
              <span class="visually-hidden"
                >{{ value }} {{ value === 1 ? 'estrela' : 'estrelas' }}</span
              >
            </label>
          }
        </fieldset>
        @if (mine()) {
          <button type="button" class="button-link remove" [disabled]="saving()" (click)="unrate()">
            Remover minha nota
          </button>
        }
      } @else if (session.siteKey()) {
        <p class="hint">Crie sua conta ou entre, no topo da página, para avaliar.</p>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </section>
  `,
  styles: `
    .rating {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    h2 {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-muted-foreground);
    }
    .summary {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
    }
    .average {
      font-size: 1.25rem;
      font-weight: 700;
    }
    .count,
    .hint {
      color: var(--color-muted-foreground);
      font-size: 0.875rem;
    }
    .stars {
      display: flex;
      border: 0;
    }
    .stars legend {
      margin-bottom: var(--space-1);
      font-size: 0.875rem;
    }
    .star {
      display: inline-grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      font-size: 1.5rem;
      color: var(--color-border-strong);
      cursor: pointer;
    }
    .star input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
    }
    .star.filled {
      color: var(--color-star);
    }
    .star:has(input:focus-visible) {
      outline: 3px solid var(--color-ring);
      outline-offset: -4px;
      border-radius: var(--radius);
    }
    .remove {
      align-self: flex-start;
      padding: 0;
      font-size: 0.875rem;
    }
    .error {
      font-size: 0.8125rem;
      color: var(--color-warning-fg);
    }
  `,
})
export class StarRating {
  protected readonly session = inject(SessionStore);
  private readonly ratings = inject(RatingsStore);

  readonly mod = input.required<CatalogMod>();

  protected readonly stars = STARS;
  protected readonly stats = computed(() => this.ratings.stats()[this.mod().id] ?? null);
  protected readonly average = computed(() => formatAverage(this.stats()?.average ?? 0));
  protected readonly mine = computed(() => this.ratings.mine()[this.mod().id] ?? null);
  protected readonly isOwnMod = computed(() => {
    const owner = this.mod().dono;
    return 'site' in owner && owner.site === this.session.user()?.id;
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected rate(stars: number): Promise<void> {
    return this.run(() => this.ratings.rate(this.mod().id, stars));
  }

  protected unrate(): Promise<void> {
    return this.run(() => this.ratings.unrate(this.mod().id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }
}
