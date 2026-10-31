import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  authorSlug,
  downloadLink,
  formatDate,
  isInstallable,
  MOD_TYPE_LABELS,
} from '../../catalog/catalog';
import { CatalogStore } from '../../catalog/catalog.store';
import { StarRating } from '../../session/star-rating';
import { SITE_LINKS } from '../../site-links';
import { NotFound } from '../not-found/not-found';

@Component({
  selector: 'app-mod-detail',
  imports: [RouterLink, NotFound, StarRating],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mod-detail.html',
  styleUrl: './mod-detail.css',
})
export class ModDetail {
  private readonly store = inject(CatalogStore);

  /** Parâmetro :autor da rota (withComponentInputBinding): slug do dono, que desambígua ids repetidos. */
  readonly autor = input.required<string>();

  /** Parâmetro :id da rota (withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly links = SITE_LINKS;
  protected readonly view = computed(() => {
    const mod = this.store.findMod(this.id(), this.autor());
    if (!mod) return null;
    return {
      mod,
      typeLabel: MOD_TYPE_LABELS[mod.tipo],
      authorSlug: authorSlug(mod.dono),
      coverUrl: this.store.coverUrl(mod),
      download: downloadLink(mod),
      installable: isInstallable(mod),
      dependencies: mod.dependencias.map((id) => {
        const dep = this.store.findMod(id);
        return {
          id,
          inCatalog: dep !== null,
          slug: dep ? authorSlug(dep.dono) : null,
        };
      }),
      created: formatDate(mod.criadoEm),
      updated: formatDate(mod.atualizadoEm),
    };
  });
}
