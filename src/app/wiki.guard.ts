import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Route guards for the wiki console — the UI half of the wiki role model. Each
 * mirrors a hugmesh-wiki-bff-api @PreAuthorize composite (defence-in-depth;
 * the bff is authoritative):
 *
 *   wikiReadGuard   — WIKI_READ  = ADMIN | SUPERADMIN | (MOD AND WIKI). Gates the
 *                     content views (list + view a page). A bare MOD without the
 *                     'wiki' role, or a plain USER, is sent to /wiki/forbidden.
 *   wikiWriteGuard  — WIKI_WRITE = ADMIN | SUPERADMIN. Gates the create/edit and
 *                     the grant/timeout/ban (/bff/wiki/admin/access) console.
 *   wikiManageGuard — WIKI_MANAGE = SUPERADMIN. Gates the list-all + history +
 *                     audit-trail (/bff/wiki/superadmin/**) views.
 *
 * A denied activation routes to the in-remote /forbidden screen (NOT /login):
 * the host already authgated the user in (route-access /wiki=ROLE_WIKI), so a
 * denial here is a within-wiki privilege boundary, not an auth failure. The
 * screen explains the missing role + offers a route back to the content view.
 */
export const wikiReadGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.canRead() ? true : router.parseUrl('/wiki/forbidden');
};

export const wikiWriteGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.canWrite() ? true : router.parseUrl('/wiki/forbidden');
};

export const wikiManageGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.canManage() ? true : router.parseUrl('/wiki/forbidden');
};
