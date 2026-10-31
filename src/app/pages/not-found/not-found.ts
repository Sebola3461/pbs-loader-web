import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

const DEFAULT_HEADING = 'Página não encontrada';
const DEFAULT_MESSAGE = 'O endereço pode estar errado, ou a página saiu do ar.';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="not-found">
      <h1>{{ heading() }}</h1>
      <p>{{ message() }}</p>
      <a class="button" routerLink="/">Ver todos os mods</a>
    </section>
  `,
  styles: `
    .not-found {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
      margin-block: var(--space-7);
      padding-top: var(--space-4);
      border-top: 3px solid var(--color-primary);
    }
  `,
})
export class NotFound {
  // Como página de rota, withComponentInputBinding passa undefined para os inputs que a rota não define.
  readonly heading = input(DEFAULT_HEADING, {
    transform: (value: string | undefined) => value ?? DEFAULT_HEADING,
  });
  readonly message = input(DEFAULT_MESSAGE, {
    transform: (value: string | undefined) => value ?? DEFAULT_MESSAGE,
  });
}
