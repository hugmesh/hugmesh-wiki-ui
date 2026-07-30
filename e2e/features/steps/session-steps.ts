// Session / login / navigation step definitions backing the wiki-ui features.
//
// Two flavours of "logged in":
//   - `Given "X" is logged in`         — full Casdoor round-trip via login()
//     (LIVE; only reached by @cluster scenarios in wave 2b).
//   - `Given "X" has a seeded session` — writes hug.session directly via an
//     addInitScript (OFFLINE-capable; exercises the pure client-side guard
//     behaviour the wiki enforces with wikiReadGuard/wikiWriteGuard/
//     wikiManageGuard).
//
// The navigation steps assert the guard outcome: a guarded wiki view either
// renders (ALLOW) or the guard redirects to the IN-REMOTE /wiki/forbidden screen
// (DENY) — NOT /login, because the host already authgated the user into the
// /wiki mount (route-access ROLE_WIKI); a denial here is a within-wiki privilege
// boundary. All such steps live in @cluster features today because they need the
// host shell to be serving the remote; bddgen still compiles them so `--list`
// proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  // addInitScript must run BEFORE the first navigation, so register the page and
  // seed; the navigation step that follows picks the session up on load.
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix: give each user an isolated context so two identities can
  // coexist in one scenario without sharing localStorage.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u: SeedUser = user(username);
  const page = pageRegistry.get(u.username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

// ── Guard-outcome assertions ────────────────────────────────────────────────

Then('{string} sees the {string} view', async ({ user }, username: string, testid: string) => {
  // ALLOW: the guard passed and the view rendered. Wiki views carry stable
  // data-testids (wiki-editor-title, wiki-access-title, wiki-manage active table,
  // wiki-pages list, etc.) — but several headings use an `id` instead of a
  // data-testid, so the locator accepts either form.
  const page = pageRegistry.get(user(username).username)!;
  const byTestId = page.locator(`[data-testid="${testid}"]`);
  const byId = page.locator(`#${testid}`);
  await expect(byTestId.or(byId).first()).toBeVisible({ timeout: 15_000 });
});

Then('{string} is sent to the wiki forbidden screen', async ({ user }, username: string) => {
  // DENY: wikiReadGuard/wikiWriteGuard/wikiManageGuard returns
  // router.parseUrl('/wiki/forbidden'), so the URL settles on the forbidden
  // route and the in-remote forbidden alert renders.
  const page = pageRegistry.get(user(username).username)!;
  await page.waitForURL(/\/wiki\/forbidden(\?|$)/, { timeout: 15_000 });
  await expect(page.locator('#wiki-forbidden-title')).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the {string} view', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  const byTestId = page.locator(`[data-testid="${testid}"]`);
  const byId = page.locator(`#${testid}`);
  await expect(byTestId).toHaveCount(0);
  await expect(byId).toHaveCount(0);
});

// ── Write-affordance presence (hidden-for-role, the "no leak" surface) ───────
// The wiki console HIDES write affordances a role can't use (defence-in-depth;
// the guard + bff are authoritative). A reader sees no "New page"/"Edit" link
// and no write/manage nav item.

Then('{string} sees the {string} affordance', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the {string} affordance', async ({ user }, username: string, testid: string) => {
  // The component renders the affordance only behind canWrite()/canManage(), so
  // for a reader it is absent from the DOM entirely (not merely disabled).
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── Nav menubar item visibility (role-aware menubar) ─────────────────────────

Then('{string} sees the {string} nav item', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="wiki-nav-${path}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the {string} nav item', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="wiki-nav-${path}"]`)).toHaveCount(0);
});

// ── Helptext (the disabled/hidden-with-explanation surface) ──────────────────

Then('{string} sees help text {string}', async ({ user }, username: string, testid: string) => {
  // A visible helptext span/element (e.g. the forbidden screen's explanation, or
  // an access-console field help) explaining WHY an action is unavailable — the
  // requirement's "disabled/hidden + helptext" pairing.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('the forbidden screen explains the missing role', async ({}) => {
  // wiki-forbidden.component renders a role="alert" panel naming the admin /
  // superadmin requirement — the helptext that pairs with the DENY bounce.
  // Phrased without a username in the feature (single-session scenario), so it
  // resolves the sole live page rather than a named one.
  const pages = [...pageRegistry.values()];
  const page = pages[pages.length - 1];
  if (!page) throw new Error('No page registered — add a session step first.');
  const panel = page.locator('.wiki-forbidden[role="alert"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/admin or superadmin role/i);
});

// ── API-level cross-user / unauth DENY ──────────────────────────────────────
// The console is display-only; the wiki-bff is the real gate. These steps fire a
// same-origin fetch with credentials so the request carries the user's HttpOnly
// `bff_` cookie (the gateway mints the upstream Bearer from it) and exercises the
// actual wiki-bff @PreAuthorize + domain-scope chain, and capture the status.

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return r.status;
    },
    path,
  );
});

When('the unauthenticated client GETs {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p);
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

Then('the response status is one of {int} or {int}', async ({}, a: number, b: number) => {
  expect([a, b]).toContain(responseState.lastStatus);
});
