import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModBrowser } from '../../components/mod-browser/mod-browser';
import { SITE_LINKS } from '../../site-links';

@Component({
  selector: 'app-home',
  imports: [ModBrowser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>Mods para o Proton Bus Simulator</h1>
      <p class="lead">
        Plugins, ônibus, mapas e skins feitos pela comunidade. Os plugins instalam pelo
        <a [href]="links.loader" rel="noopener">PBS Loader</a>.
      </p>
    </section>
    <app-mod-browser ngSkipHydration />
  `,
  styles: `
    /* Linha âmbar de painel: o "farol" que ancora a marca (DESIGN.md, hero da home). */
    .hero {
      margin-block: var(--space-6) var(--space-5);
      padding-top: var(--space-4);
      border-top: 3px solid var(--color-primary);
    }
    .hero h1 {
      font-size: clamp(2rem, 1.4rem + 2.5vw, 3rem);
      line-height: 1.1;
    }
    .lead {
      margin-top: var(--space-2);
      max-width: 60ch;
      color: var(--color-muted-foreground);
    }
  `,
})
export class Home {
  protected readonly links = SITE_LINKS;
}
