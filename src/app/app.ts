import { ChangeDetectionStrategy, Component, afterNextRender, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RatingsStore } from './session/ratings.store';
import { SessionStore } from './session/session.store';
import { UserMenu } from './session/user-menu';
import { SITE_LINKS } from './site-links';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly links = SITE_LINKS;

  constructor() {
    const session = inject(SessionStore);
    const ratings = inject(RatingsStore);
    // Só no navegador: no pré-render não há API, e a sessão é de quem está vendo a página.
    afterNextRender(() => {
      void session.load();
      void ratings.loadStats();
    });
  }
}
