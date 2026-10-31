import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideAppRouter } from './app.routes';
import { provideGeneratedCatalog } from './catalog/catalog.data';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppRouter(),
    provideClientHydration(),
    provideGeneratedCatalog(),
  ],
};
