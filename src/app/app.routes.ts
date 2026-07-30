import { Routes } from '@angular/router';
import { WIKI_ROUTES } from './wiki.routes';

/** Dev-shell routes: mount the exposed Wiki routes at the root so the remote is
 *  browsable standalone (`ng serve wiki`). The host ignores this and loads the
 *  exposed `./Wiki` module (WIKI_ROUTES) directly at /wiki. */
export const routes: Routes = [{ path: '', children: WIKI_ROUTES }];
