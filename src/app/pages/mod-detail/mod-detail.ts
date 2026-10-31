import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  authorSlug,
  downloadLink,
  formatDate,
  isInstallable,
  MOD_TYPE_LABELS,
} from '../../catalog/catalog';
import { CatalogStore } from '../../catalog/catalog.store';
import { SessionStore } from '../../session/session.store';
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
  private readonly session = inject(SessionStore);

  /** Parâmetro :autor da rota (withComponentInputBinding): slug do dono, que desambígua ids repetidos. */
  readonly autor = input.required<string>();

  /** Parâmetro :id da rota (withComponentInputBinding). */
  readonly id = input.required<string>();

  /** Editar pelo site é só para o dono da conta; autores do GitHub mexem direto no catálogo. */
  protected readonly canEdit = computed(() => {
    const user = this.session.user();
    const mod = this.view()?.mod;
    return Boolean(user && mod && 'site' in mod.dono && mod.dono.site === user.id);
  });

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
