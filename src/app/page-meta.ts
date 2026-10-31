import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const SITE_NAME = 'Mods do PBS Loader';
export const DEFAULT_DESCRIPTION =
  'Mods da comunidade do Proton Bus Simulator: plugins, ônibus, mapas e skins.';

/**
 * Título e descrição de cada página, a partir da rota (title e data.description). Fica no TitleStrategy porque o
 * router o chama em toda navegação, inclusive no pré-render, e assim a descrição de um mod não sobra na página
 * seguinte.
 */
@Injectable({ providedIn: 'root' })
export class PageMetaStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(this.buildTitle(snapshot) ?? SITE_NAME);
    let route = snapshot.root;
    while (route.firstChild) route = route.firstChild;
    const description: unknown = route.data['description'];
    this.meta.updateTag({
      name: 'description',
      content: typeof description === 'string' ? description : DEFAULT_DESCRIPTION,
    });
  }
}
