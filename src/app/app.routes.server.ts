import { RenderMode, ServerRoute } from '@angular/ssr';
import { authorSlug } from './catalog/catalog';
import { generatedCatalog } from './catalog/catalog.data';

// Cada mod e cada autor vira uma página estática; mod novo entra no próximo build, disparado pelo catálogo.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  {
    path: 'mods/:id',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => generatedCatalog.mods.map((mod) => ({ id: mod.id })),
  },
  {
    path: 'autores/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () =>
      [...new Set(generatedCatalog.mods.map((mod) => authorSlug(mod.dono)))].map((slug) => ({
        slug,
      })),
  },
  // Gera o index.csr.html, que scripts/postbuild.mjs copia para 404.html: sem HTML pré-renderizado, o cliente
  // monta a página certa (mod removido, autor que saiu) sem hidratar sobre o DOM de outro componente.
  { path: '**', renderMode: RenderMode.Client },
];
