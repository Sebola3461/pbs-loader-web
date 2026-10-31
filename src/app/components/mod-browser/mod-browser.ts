import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  EMPTY_FILTERS,
  filterMods,
  filtersFromParams,
  filtersToParams,
  hasActiveFilters,
  MAX_QUERY_LENGTH,
  MOD_TYPE_LABELS,
  ModFilters,
  SORT_KEYS,
  SORT_LABELS,
  sortMods,
} from '../../catalog/catalog';
import { MOD_TYPES } from '../../catalog/catalog.model';
import { CatalogStore } from '../../catalog/catalog.store';
import { RatingsStore } from '../../session/ratings.store';
import { SITE_LINKS } from '../../site-links';
import { ModCard } from '../mod-card/mod-card';

/** Marca as navegações feitas por este componente, para ele não reler a própria URL. */
const OWN_NAVIGATION = 'modBrowser';

/**
 * Busca, filtros e resultados. Os filtros ficam na URL (?q=&tipo=&autor=&versao=&ordem=) para o link poder ser
 * compartilhado. Quem usa o componente põe ngSkipHydration: o HTML pré-renderizado não tem filtro, e o cliente
 * monta a lista com os filtros da URL.
 */
@Component({
  selector: 'app-mod-browser',
  imports: [ModCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mod-browser.html',
  styleUrl: './mod-browser.css',
})
export class ModBrowser {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(CatalogStore);
  private readonly ratings = inject(RatingsStore);

  // Só os tipos que existem no catálogo: uma opção que sempre dá zero resultado só atrapalha.
  protected readonly types = MOD_TYPES.map((value) => ({
    value,
    label: MOD_TYPE_LABELS[value],
    count: this.store.mods.filter((m) => m.tipo === value).length,
  })).filter((type) => type.count > 0);
  protected readonly sorts = SORT_KEYS.map((value) => ({ value, label: SORT_LABELS[value] }));
  protected readonly links = SITE_LINKS;
  protected readonly maxQueryLength = MAX_QUERY_LENGTH;

  // O estado local é a fonte; a URL é só o espelho. Se o campo de busca seguisse a URL, uma navegação atrasada
  // ("ab") sobrescreveria o que já foi digitado ("abc").
  private readonly state = signal(this.fromParams(this.route.snapshot.queryParamMap));
  protected readonly filters = this.state.asReadonly();
  protected readonly results = computed(() =>
    sortMods(
      filterMods(this.store.mods, this.filters()),
      this.filters().sort,
      this.ratings.stats(),
    ),
  );
  protected readonly filtered = computed(() => hasActiveFilters(this.filters()));
  protected readonly panelFilterCount = computed(() => {
    const { type, author, gameVersion } = this.filters();
    return [type, author, gameVersion].filter(Boolean).length;
  });
  /** No celular, os filtros ficam fechados atrás de um botão; no desktop, sempre à mostra. */
  protected readonly filtersOpen = signal(false);

  constructor() {
    // Voltar/avançar e links de fora (o "Mods" do menu) trazem filtros novos; as navegações daqui, não.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (!this.router.currentNavigation()?.extras.state?.[OWN_NAVIGATION]) {
        this.state.set(this.fromParams(params));
      }
    });
  }

  protected update(change: Partial<ModFilters>): void {
    const next = { ...this.state(), ...change };
    this.state.set(next);
    // Só o texto troca a URL a cada tecla; sem replaceUrl, o "voltar" passaria por cada letra.
    const typing = Object.keys(change).length === 1 && 'query' in change;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersToParams(next),
      replaceUrl: typing,
      state: { [OWN_NAVIGATION]: true },
    });
  }

  protected updateFrom(field: keyof ModFilters, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.update({ [field]: value } as Partial<ModFilters>);
  }

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected clear(): void {
    this.update({ ...EMPTY_FILTERS, sort: this.state().sort });
  }

  private fromParams(params: ParamMap): ModFilters {
    return filtersFromParams(params, this.store);
  }
}
