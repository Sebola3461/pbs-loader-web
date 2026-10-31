import { EnvironmentProviders, Provider, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  ResolveFn,
  Routes,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { CatalogStore } from './catalog/catalog.store';
import { PageMetaStrategy, SITE_NAME } from './page-meta';
import { AuthorPage } from './pages/author/author';
import { Home } from './pages/home/home';
import { ModDetail } from './pages/mod-detail/mod-detail';
import { NotFound } from './pages/not-found/not-found';

const NOT_FOUND_TITLE = `Página não encontrada · ${SITE_NAME}`;

const modOf = (route: ActivatedRouteSnapshot) =>
  inject(CatalogStore).findMod(route.params['id'] as string, route.params['autor'] as string);
const authorOf = (route: ActivatedRouteSnapshot) =>
  inject(CatalogStore).findAuthor(route.params['slug'] as string);

export const modTitle: ResolveFn<string> = (route) =>
  `${modOf(route)?.nome ?? 'Mod não encontrado'} · ${SITE_NAME}`;
// Prévias de link (Discord, buscadores) mostram uma linha só e cortam por volta de 160 caracteres.
export const modDescription: ResolveFn<string> = (route) =>
  modOf(route)?.descricao.replace(/\s+/g, ' ').trim().slice(0, 160) ??
  'Mod não encontrado no catálogo.';

export const authorTitle: ResolveFn<string> = (route) =>
  `${authorOf(route)?.nome ?? 'Autor não encontrado'} · ${SITE_NAME}`;
export const authorDescription: ResolveFn<string> = (route) => {
  const author = authorOf(route);
  return author
    ? `Mods de ${author.nome} para o Proton Bus Simulator.`
    : 'Autor não encontrado no catálogo.';
};

export const routes: Routes = [
  { path: '', component: Home, title: SITE_NAME },
  {
    path: 'mods/:autor/:id',
    component: ModDetail,
    title: modTitle,
    resolve: { description: modDescription },
  },
  {
    path: 'autores/:slug',
    component: AuthorPage,
    title: authorTitle,
    resolve: { description: authorDescription },
  },
  { path: '**', component: NotFound, title: NOT_FOUND_TITLE },
];

export function provideAppRouter(): (Provider | EnvironmentProviders)[] {
  return [
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    { provide: TitleStrategy, useClass: PageMetaStrategy },
  ];
}
