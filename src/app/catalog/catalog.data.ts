import { Provider } from '@angular/core';
import catalog from '../../generated/catalog.json';
import { CommunityCatalog } from './catalog.model';
import { COMMUNITY_CATALOG } from './catalog.store';

// O JSON foi validado (formato 1) por scripts/lib/catalog-source.mjs antes de ser gravado.
export const generatedCatalog = catalog as CommunityCatalog;

export const provideGeneratedCatalog = (): Provider => ({
  provide: COMMUNITY_CATALOG,
  useValue: generatedCatalog,
});
