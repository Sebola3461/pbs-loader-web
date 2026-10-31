import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { authorSlug, formatDate, MOD_TYPE_LABELS } from '../../catalog/catalog';
import { CatalogMod } from '../../catalog/catalog.model';
import { CatalogStore } from '../../catalog/catalog.store';

@Component({
  selector: 'app-mod-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mod-card.html',
  styleUrl: './mod-card.css',
})
export class ModCard {
  private readonly store = inject(CatalogStore);

  readonly mod = input.required<CatalogMod>();

  protected readonly typeLabel = computed(() => MOD_TYPE_LABELS[this.mod().tipo]);
  protected readonly authorSlug = computed(() => authorSlug(this.mod().dono));
  protected readonly coverUrl = computed(() => this.store.coverUrl(this.mod()));
  protected readonly updated = computed(() => formatDate(this.mod().atualizadoEm, 'short'));
  protected readonly versions = computed(() => this.mod().versoesDoJogo.join(', '));
}
