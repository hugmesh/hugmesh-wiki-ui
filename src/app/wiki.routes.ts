import { Routes } from '@angular/router';
import { WikiConsoleComponent } from './wiki-console.component';
import { WikiPagesComponent } from './wiki-pages.component';
import { WikiPageViewComponent } from './wiki-page-view.component';
import { WikiEditorComponent } from './wiki-editor.component';
import { WikiAccessComponent } from './wiki-access.component';
import { WikiManageComponent } from './wiki-manage.component';
import { WikiForbiddenComponent } from './wiki-forbidden.component';
import { wikiReadGuard, wikiWriteGuard, wikiManageGuard } from './wiki.guard';

/**
 * The exposed `./Wiki` module — mounted by the hugmesh.systems host at the
 * apex path /wiki (the federation-api wiki module row #16: mountAt '/wiki',
 * remote_entry_url http://hugmesh-wiki-ui:8080/remoteEntry.json,
 * requiresRole 'wiki', visibility internal). The host gates the WHOLE /wiki mount
 * behind route-access ROLE_WIKI; THESE child guards then enforce the per-VIEW
 * role boundary so a MOD sees only content-read, an ADMIN sees content+grants,
 * and a SUPERADMIN sees everything incl. manage/history/audit.
 *
 * View → role gate (mirrors hugmesh-wiki-bff-api @PreAuthorize):
 *   ''                 WikiConsole  — shell + role-aware nav (no extra gate beyond /wiki)
 *   pages              WikiPages    — list (wikiReadGuard:  WIKI_READ)
 *   pages/:slug        WikiPageView — rendered page (wikiReadGuard: WIKI_READ)
 *   pages/:slug/edit   WikiEditor   — edit  (wikiWriteGuard: WIKI_WRITE)
 *   new                WikiEditor   — create(wikiWriteGuard: WIKI_WRITE)
 *   access             WikiAccess   — grant/timeout/ban console (wikiWriteGuard: WIKI_WRITE)
 *   manage             WikiManage   — list-all + history + audit (wikiManageGuard: WIKI_MANAGE)
 *   forbidden          WikiForbidden— the within-wiki privilege-boundary screen
 *
 * The guard `false`-paths route to /forbidden (NOT /login): the host already
 * authgated the user in; a denial here is a wiki privilege boundary.
 */
export const WIKI_ROUTES: Routes = [
  {
    path: '',
    component: WikiConsoleComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pages' },
      { path: 'pages', component: WikiPagesComponent, canActivate: [wikiReadGuard] },
      { path: 'new', component: WikiEditorComponent, canActivate: [wikiWriteGuard] },
      { path: 'pages/:slug', component: WikiPageViewComponent, canActivate: [wikiReadGuard] },
      { path: 'pages/:slug/edit', component: WikiEditorComponent, canActivate: [wikiWriteGuard] },
      { path: 'access', component: WikiAccessComponent, canActivate: [wikiWriteGuard] },
      { path: 'manage', component: WikiManageComponent, canActivate: [wikiManageGuard] },
      { path: 'forbidden', component: WikiForbiddenComponent },
    ],
  },
];
