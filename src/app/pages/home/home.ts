import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModBrowser } from '../../components/mod-browser/mod-browser';
import { SITE_LINKS } from '../../site-links';

@Component({
  selector: 'app-home',
  imports: [ModBrowser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>Mods da comunidade do Proton Bus Simulator</h1>
      <p class="lead">
        Encontre plugins, ônibus, mapas e skins feitos pela comunidade. Os plugins instalam pelo
        <a [href]="links.loader" rel="noopener">PBS Loader</a>.
      </p>
    </section>
    <app-mod-browser ngSkipHydration />
  `,
  styles: `
    .hero {
      margin-block: var(--space-6) var(--space-5);
    }
    .lead {
      margin-top: var(--space-2);
      max-width: 60ch;
      color: var(--color-muted-foreground);
      font-size: 1.0625rem;
    }
  `,
})
export class Home {
  protected readonly links = SITE_LINKS;
}
