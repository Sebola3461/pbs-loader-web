import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModBrowser } from '../../components/mod-browser/mod-browser';
import { SITE_LINKS } from '../../site-links';

@Component({
  selector: 'app-home',
  imports: [ModBrowser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- O título visível saiu por decisão de design; o h1 oculto preserva a hierarquia de headings. -->
    <h1 class="visually-hidden">Mods do PBS Loader</h1>
    <p class="lead">
      Plugins, ônibus, mapas e skins feitos pela comunidade. Os plugins instalam pelo
      <a [href]="links.loader" rel="noopener">PBS Loader</a>.
    </p>
    <app-mod-browser ngSkipHydration />
  `,
  styles: `
    .lead {
      max-width: 60ch;
      margin-block: var(--space-4) var(--space-5);
      color: var(--color-muted-foreground);
    }
  `,
})
export class Home {
  protected readonly links = SITE_LINKS;
}
