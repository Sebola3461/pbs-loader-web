import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ModBrowser } from '../../components/mod-browser/mod-browser';

@Component({
  selector: 'app-home',
  imports: [ModBrowser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Título e subtítulo visíveis saíram por decisão de design; o h1 oculto preserva a hierarquia de headings. -->
    <h1 class="visually-hidden">Mods do PBS Loader</h1>
    <app-mod-browser ngSkipHydration />
  `,
  styles: ``,
})
export class Home {}
