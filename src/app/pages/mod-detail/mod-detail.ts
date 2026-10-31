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
import { SITE_LINKS } from '../../site-links';
import { NotFound } from '../not-found/not-found';

@Component({
  selector: 'app-mod-detail',
  imports: [RouterLink, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mod-detail.html',
  styleUrl: './mod-detail.css',
})
export class ModDetail {
  private readonly store = inject(CatalogStore);

  /** Parâmetro :id da rota (withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly links = SITE_LINKS;
  protected readonly view = computed(() => {
    const mod = this.store.findMod(this.id());
    if (!mod) return null;
    return {
      mod,
      typeLabel: MOD_TYPE_LABELS[mod.tipo],
      authorSlug: authorSlug(mod.dono),
      coverUrl: this.store.coverUrl(mod),
      download: downloadLink(mod),
      installable: isInstallable(mod),
      dependencies: mod.dependencias.map((id) => ({
        id,
        inCatalog: this.store.findMod(id) !== null,
      })),
      created: formatDate(mod.criadoEm),
      updated: formatDate(mod.atualizadoEm),
    };
  });
}
