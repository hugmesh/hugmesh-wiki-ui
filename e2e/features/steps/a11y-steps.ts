// Accessibility step definitions. The wiki-ui carries the org a11y standard:
// a skip-link that moves focus to the main region, named ARIA landmarks, a
// roving-tabindex menubar (WAI-ARIA APG) over the role-gated views, and focus
// restoration after a route change. These steps assert those contracts against
// the real shell markup:
//   - app.component.html renders `<a class="skip" href="#wiki-main">` →
//     `<main id="wiki-main" tabindex="-1">` (the skip-link + focus target).
//   - wiki-console.component.html renders the menubar as
//     `<nav role="menubar" aria-label="Wiki console" aria-describedby=
//     "wiki-console-help">` with roving-tabindex `role="menuitem"` links
//     (data-testid="wiki-nav-<path>") and per-item aria-label + aria-describedby.

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/** The single live page an "ambient" a11y assertion acts on. These steps are
 *  phrased WITHOUT a username in the feature files (each such scenario seeds
 *  exactly one session), so they resolve the sole registered page rather than a
 *  named one. Throws if no session/navigation step ran first. */
function currentPage() {
  const pages = [...pageRegistry.values()];
  if (pages.length === 0) throw new Error('No page registered — add a session step first.');
  return pages[pages.length - 1];
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#wiki-main');
});

Then('activating the skip link moves focus to the main region', async ({}) => {
  const page = currentPage();
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#wiki-main');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / labels ──────────────────────────────────────────────────

Then('the wiki menubar has an accessible name', async ({}) => {
  const page = currentPage();
  const nav = page.locator('nav.wiki-nav[role="menubar"]');
  await expect(nav).toBeVisible();
  await expect(nav).toHaveAttribute('aria-label', 'Wiki console');
  // It is also described by the console help line so assistive tech reads the
  // purpose alongside the name.
  await expect(nav).toHaveAttribute('aria-describedby', 'wiki-console-help');
});

Then('each wiki nav item has an accessible name and help', async ({}) => {
  const page = currentPage();
  const items = page.locator('nav.wiki-nav a[role="menuitem"]');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    await expect(item).toHaveAttribute('aria-label', /.+/);
    // aria-describedby points at the sr-only help span rendered next to it.
    // The attribute is an ID *list* (space separated), so resolve each id on its
    // own — `#a b` would be read as a descendant selector and silently stop
    // asserting what the step claims.
    const describedby = await item.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    const ids = (describedby ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  }
});

Then('the {string} region has an accessible name', async ({}, selector: string) => {
  const page = currentPage();
  const region = page.locator(selector);
  await expect(region.first()).toBeVisible();
  const labelledby = await region.first().getAttribute('aria-labelledby');
  const ariaLabel = await region.first().getAttribute('aria-label');
  expect(
    Boolean(labelledby) || Boolean(ariaLabel),
    `${selector} must carry aria-labelledby or aria-label`,
  ).toBe(true);
  // An aria-labelledby pointing at a missing/empty element leaves the region with
  // NO accessible name, so resolve every referenced id and require real text —
  // otherwise this step would pass on a dangling reference.
  for (const id of (labelledby ?? '').split(/\s+/).filter(Boolean)) {
    const target = page.locator(`[id="${id}"]`);
    await expect(target).toHaveCount(1);
    await expect(target).toHaveText(/\S/);
  }
  if (!labelledby) expect(ariaLabel?.trim()).toBeTruthy();
});

// ── Roving tabindex on the menubar ───────────────────────────────────────────

Then('only one wiki nav item is in the tab order', async ({}) => {
  const page = currentPage();
  // Roving tabindex (WAI-ARIA menubar): exactly one menuitem carries tabindex=0;
  // the rest are -1 and reached with Arrow keys.
  const tabbable = page.locator('nav.wiki-nav a[role="menuitem"][tabindex="0"]');
  await expect(tabbable).toHaveCount(1);
});

When('{string} focuses the first wiki nav item', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('nav.wiki-nav a[role="menuitem"]').first().focus();
});

Then('arrow-key navigation moves focus along the wiki nav items', async ({}) => {
  const page = currentPage();
  const links = page.locator('nav.wiki-nav a[role="menuitem"]');
  await expect(links.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  // Roving tabindex: focus advances to the next item without leaving the menu.
  await expect(links.nth(1)).toBeFocused();
  // Home returns to the first item.
  await page.keyboard.press('Home');
  await expect(links.first()).toBeFocused();
});

// ── Focus restoration after a route change ───────────────────────────────────

Then('focus is restored to the main region after navigation', async ({}) => {
  const page = currentPage();
  await expect(page.locator('main#wiki-main')).toBeFocused();
});

// ── Editor form a11y (labels + error wiring) ─────────────────────────────────

Then('every wiki editor field is labelled', async ({}) => {
  const page = currentPage();
  // Each input/textarea has a <label for> and an aria-describedby pointing at a
  // visible help id — assert the title + body controls are wired.
  for (const id of ['wiki-title', 'wiki-body']) {
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    const field = page.locator(`#${id}`);
    const describedby = await field.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
  }
});
