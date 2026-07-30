// Write-path step definitions — the multi-user MUTATION flows the existing
// suite never exercised: authoring (create → view → edit → publish), the
// optimistic-concurrency conflict (two writers, stale expectedVersion 409,
// reload-latest, resave), the access console acting ON another user (grant /
// timeout / ban / restore / remove-grant), cross-domain CONTENT isolation
// (victim-creates-first, real writes), and the SUPERADMIN cross-brand
// targetDomain contract.
//
// HOUSE LAW honoured here:
//   - REAL Casdoor sessions (bff_ cookie) for every real write/read — these
//     steps use pages registered by `is logged in [in their own context]`, NOT
//     seedSession (which only writes localStorage and never obtains the cookie,
//     so a live authenticated call would 401). seedSession stays reserved for
//     the pure client-side guard/menubar behaviour (the role-change scenario).
//   - VICTIM-CREATES-FIRST: an author really POSTs content, or a reader really
//     proves read access, BEFORE the isolation / ban DENY is asserted — the
//     step that seeds the victim fails loudly (asserts 2xx) so a broken setup
//     never masquerades as a passing isolation proof.
//   - BOUNDED POLLS, never sleeps: the timeout auto-restore uses expect.poll
//     with a deadline, not a fixed wait.
//   - EXACT copy: error/notice/publish assertions match the component strings
//     (wiki-editor 'changed by someone else', wiki-pages 'no longer have
//     permission', wiki-view 'Published version …').
//
// Every scenario driving these steps is @cluster (needs the host shell serving
// the remote + wiki-bff + a Casdoor seed), so the default offline run filters
// them out; bddgen still compiles them so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import { SeedUser, loginInNewContext, subjectFor } from '../../tests/helpers/roles';

/** Resolve the live page a step should act on, failing loudly on a missing
 *  session step (the same contract the session/nav steps use). */
function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// The canned markdown an author writes: carries a link + a code span so the
// authoring-journey can assert the BFF's sanitized render actually contains
// them (the content pipeline, not just "a page exists").
function seedMarkdown(slug: string): string {
  return `# ${slug}\n\nSeed content with a [reference link](https://hugmesh.example) and an \`inline code\` span.`;
}

// ── Real-session login into an isolated context ──────────────────────────────
// Adds a SECOND (or third) live identity to a scenario so a writer and an
// independent auditor / a moderator victim / a cross-domain admin coexist, each
// with their own bff_ cookie.

Given('{string} is logged in in their own context', async ({ browser, user }, username: string) => {
  const u: SeedUser = user(username);
  const { context, page } = await loginInNewContext(browser, u);
  ctxRegistry.set(u.username, context);
  pageRegistry.set(u.username, page);
});

// ── Authoring via the editor UI (create + edit) ──────────────────────────────

When('{string} starts a new wiki page', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.goto('/wiki/new', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="wiki-editor-slug"]')).toBeVisible({ timeout: 15_000 });
});

When('{string} opens the editor for the wiki page {string}', async ({ user }, username: string, slug: string) => {
  const page = pageOf(user(username).username);
  await page.goto(`/wiki/pages/${slug}/edit`, { waitUntil: 'domcontentloaded' });
  // Edit mode pre-loads the page (loadExisting) then shows the title control.
  await expect(page.locator('[data-testid="wiki-editor-title-input"]')).toBeVisible({ timeout: 15_000 });
});

When('{string} sets the editor slug to {string}', async ({ user }, username: string, value: string) => {
  await pageOf(user(username).username).fill('[data-testid="wiki-editor-slug"]', value);
});

When('{string} sets the editor title to {string}', async ({ user }, username: string, value: string) => {
  await pageOf(user(username).username).fill('[data-testid="wiki-editor-title-input"]', value);
});

When('{string} sets the editor body to {string}', async ({ user }, username: string, value: string) => {
  await pageOf(user(username).username).fill('[data-testid="wiki-editor-body"]', value);
});

When('{string} writes the seed markdown in the editor body', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Read the slug the author typed so the body references its own page id.
  const slug = (await page.inputValue('[data-testid="wiki-editor-slug"]')) || 'page';
  await page.fill('[data-testid="wiki-editor-body"]', seedMarkdown(slug));
});

When('{string} saves the editor', async ({ user }, username: string) => {
  await pageOf(user(username).username).click('[data-testid="wiki-editor-save"]');
});

When('{string} reloads the latest version', async ({ user }, username: string) => {
  await pageOf(user(username).username).click('[data-testid="wiki-editor-reload"]');
});

Then('{string} sees the editor error containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-editor-error"]')).toContainText(text, {
    timeout: 15_000,
  });
});

Then('{string} sees the editor notice containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-editor-notice"]')).toContainText(text, {
    timeout: 15_000,
  });
});

// ── Page view (post-save landing / publish) ──────────────────────────────────

Then('{string} lands on the wiki page view for {string}', async ({ user }, username: string, slug: string) => {
  const page = pageOf(user(username).username);
  // On a successful save the editor navigates to the page view (…/pages/{slug},
  // NOT …/edit); assert the URL settles there AND the view title renders.
  await page.waitForURL(new RegExp(`/wiki/pages/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?|$)`), {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="wiki-view-title"]')).toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the wiki page title {string}', async ({ user }, username: string, title: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-view-title"]')).toHaveText(title, {
    timeout: 15_000,
  });
});

Then('{string} sees the rendered wiki body containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('.wiki-view__body')).toContainText(text, { timeout: 15_000 });
});

When('{string} publishes the wiki page', async ({ user }, username: string) => {
  await pageOf(user(username).username).click('[data-testid="wiki-view-publish"]');
});

Then('{string} sees the publish message containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-view-publish-msg"]')).toContainText(text, {
    timeout: 15_000,
  });
});

// ── Superadmin audit verification ────────────────────────────────────────────

Then('{string} sees the audit trail containing {string}', async ({ user }, username: string, text: string) => {
  // The manage view auto-loads the audit trail; assert the table CONTAINS the
  // slug the author acted on (the audit row carries it — see the manage spec's
  // { action, slug, actor } shape), not merely that the region rendered.
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-manage-audit"]')).toContainText(text, {
    timeout: 15_000,
  });
});

// ── Content read consequence (ban/timeout/revoke DENY surfaced in the list) ──

Then('{string} sees the wiki pages error containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-pages-error"]')).toContainText(text, {
    timeout: 15_000,
  });
});

// ── Access console — grant / timeout / ban composites ────────────────────────
// The operator must already be on /wiki/access. Each composite selects the
// action radio, fills the victim's subject (+ a reason for the audit note), and
// submits, leaving the applied result row for the follow-up assertions.

async function fillAccess(
  page: import('@playwright/test').Page,
  action: 'grant' | 'timeout' | 'ban',
  subject: string,
  opts: { reason?: string; targetDomain?: string } = {},
): Promise<void> {
  await page.locator(`[data-testid="wiki-access-action-${action}"]`).check();
  await page.fill('[data-testid="wiki-access-user"]', subject);
  if (opts.reason) await page.fill('[data-testid="wiki-access-reason"]', opts.reason);
  if (opts.targetDomain !== undefined) {
    await page.fill('[data-testid="wiki-access-target-domain"]', opts.targetDomain);
  }
  await page.click('[data-testid="wiki-access-submit"]');
}

When('{string} grants read access to {string}', async ({ user }, actor: string, target: string) => {
  const page = pageOf(user(actor).username);
  await fillAccess(page, 'grant', subjectFor(user(target)), { reason: 'e2e grant' });
});

When('{string} bans {string}', async ({ user }, actor: string, target: string) => {
  const page = pageOf(user(actor).username);
  await fillAccess(page, 'ban', subjectFor(user(target)), { reason: 'e2e ban' });
});

When(
  '{string} grants read access to {string} in brand {string}',
  async ({ user }, actor: string, target: string, brand: string) => {
    const page = pageOf(user(actor).username);
    await fillAccess(page, 'grant', subjectFor(user(target)), { reason: 'e2e cross-brand grant', targetDomain: brand });
  },
);

When('{string} grants read access to {string} in an unknown brand', async ({ user }, actor: string, target: string) => {
  const page = pageOf(user(actor).username);
  // A brand the BFF's trusted DomainRegistry cannot resolve → fail-closed 400.
  await fillAccess(page, 'grant', subjectFor(user(target)), {
    reason: 'e2e unknown-brand',
    targetDomain: 'no-such-brand-zzz',
  });
});

Then(
  '{string} sees the access result type {string} and state {string}',
  async ({ user }, username: string, type: string, state: string) => {
    const result = pageOf(user(username).username).locator('[data-testid="wiki-access-result"]');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText(type);
    await expect(result).toContainText(state);
  },
);

Then('{string} sees the access result brand {string}', async ({ user }, username: string, brand: string) => {
  // The bff-stamped brand the row ACTUALLY landed in — proves the cross-brand
  // write targeted the intended tenant, not `default`.
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-access-result-domain"]')).toHaveText(brand, {
    timeout: 15_000,
  });
});

Then('{string} sees a verbatim server access error', async ({ user }, username: string) => {
  // The fail-closed 400 (WikiAccessService.writeDomain) is surfaced verbatim, so
  // the error is present AND is NOT the generic "try again" fallback the client
  // shows for unclassified failures — that distinction is the whole point of the
  // component's isBadRequest branch.
  const err = pageOf(user(username).username).locator('[data-testid="wiki-access-error"]');
  await expect(err).toBeVisible({ timeout: 15_000 });
  await expect(err).not.toContainText('Please try again');
});

Then('{string} sees the access notice containing {string}', async ({ user }, username: string, text: string) => {
  await expect(pageOf(user(username).username).locator('[data-testid="wiki-access-notice"]')).toContainText(text, {
    timeout: 15_000,
  });
});

When('{string} clicks restore on the result', async ({ user }, username: string) => {
  await pageOf(user(username).username).click('[data-testid="wiki-access-restore"]');
});

When('{string} clicks remove grant on the result', async ({ user }, username: string) => {
  await pageOf(user(username).username).click('[data-testid="wiki-access-remove"]');
});

// ── Real API writes/reads (victim-creates-first, cross-domain isolation) ─────
// Same-origin fetch with credentials so the request carries the actor's bff_
// cookie and hits the real wiki-bff @PreAuthorize + domain-scope chain.

When('{string} authors the wiki page {string} via the API', async ({ user }, username: string, slug: string) => {
  const page = pageOf(user(username).username);
  const status = await page.evaluate(
    async ([s, body]) => {
      const r = await fetch('/bff/wiki/admin/pages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: s, title: `Page ${s}`, contentMarkdown: body }),
      });
      return r.status;
    },
    [slug, seedMarkdown(slug)] as const,
  );
  responseState.lastStatus = status;
  // Victim-creates-first: the author MUST really create the page, or the
  // isolation assertions below prove nothing.
  expect([200, 201]).toContain(status);
});

Then('{string} sees the page {string} in the wiki list', async ({ user }, username: string, slug: string) => {
  const slugs = await pageOf(user(username).username).evaluate(async () => {
    const r = await fetch('/bff/wiki/pages', { credentials: 'include' });
    if (!r.ok) return null;
    const j = (await r.json()) as { pages?: Array<{ slug?: string }> };
    return (j.pages ?? []).map((p) => p.slug);
  });
  expect(slugs, 'the wiki page list should have loaded for this user').not.toBeNull();
  expect(slugs).toContain(slug);
});

Then('{string} does not see the page {string} in the wiki list', async ({ user }, username: string, slug: string) => {
  const { status, slugs } = await pageOf(user(username).username).evaluate(async () => {
    const r = await fetch('/bff/wiki/pages', { credentials: 'include' });
    if (!r.ok) return { status: r.status, slugs: null as string[] | null };
    const j = (await r.json()) as { pages?: Array<{ slug?: string }> };
    return { status: r.status, slugs: (j.pages ?? []).map((p) => p.slug ?? '') };
  });
  responseState.lastStatus = status;
  if (slugs === null) {
    // The whole list was refused — that only proves isolation if it is a real
    // fail-closed DENY. A 401 (never logged in) or a 5xx would otherwise let a
    // broken stack masquerade as a passing isolation assertion.
    expect([403, 404], `the wiki list must be a fail-closed DENY, got ${status}`).toContain(status);
    return;
  }
  expect(slugs).not.toContain(slug);
});

When(
  '{string} attempts to publish the wiki page {string} via the API',
  async ({ user }, username: string, slug: string) => {
    const status = await pageOf(user(username).username).evaluate(async (s) => {
      const r = await fetch(`/bff/wiki/admin/pages/${s}/publish`, { method: 'POST', credentials: 'include' });
      return r.status;
    }, slug);
    responseState.lastStatus = status;
  },
);

// An authenticated WRITE probe against the real POST grant route (a MOD reader
// is read-only): the bff re-enforces WIKI_WRITE even though the UI hides the
// console. Uses the real verb/route — GET /bff/wiki/admin/access is not a route.
When('{string} attempts to grant wiki access via the API', async ({ user }, username: string) => {
  const status = await pageOf(user(username).username).evaluate(async () => {
    const r = await fetch('/bff/wiki/admin/access/grant', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userSubject: 'google:probe@example.test' }),
    });
    return r.status;
  });
  responseState.lastStatus = status;
});

// ── Timeout via the API + bounded auto-restore poll ──────────────────────────
// The console's hours input has a 1-hour floor, so a sub-minute timeout (needed
// to observe auto-restore in an e2e) is only reachable via the raw ttlSeconds
// API — an honest exercise of the SAME timeout access-type the UI writes.

When(
  '{string} times out {string} for {int} seconds via the API',
  async ({ user }, actor: string, target: string, seconds: number) => {
    const subject = subjectFor(user(target));
    const status = await pageOf(user(actor).username).evaluate(
      async ([subj, ttl]) => {
        const r = await fetch('/bff/wiki/admin/access/timeout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userSubject: subj, ttlSeconds: ttl }),
        });
        return r.status;
      },
      [subject, seconds] as const,
    );
    responseState.lastStatus = status;
    expect([200, 201]).toContain(status);
  },
);

Then(
  "{string}'s wiki read is denied at the BFF",
  async ({ user }, username: string) => {
    const status = await pageOf(user(username).username).evaluate(
      async () => (await fetch('/bff/wiki/pages', { credentials: 'include' })).status,
    );
    responseState.lastStatus = status;
    expect(status).toBe(403);
  },
);

Then(
  "{string}'s wiki read succeeds at the BFF",
  async ({ user }, username: string) => {
    const status = await pageOf(user(username).username).evaluate(
      async () => (await fetch('/bff/wiki/pages', { credentials: 'include' })).status,
    );
    responseState.lastStatus = status;
    expect(status).toBe(200);
  },
);

Then(
  "{string}'s wiki read auto-restores within {int} seconds",
  async ({ user }, username: string, seconds: number) => {
    const page = pageOf(user(username).username);
    // Bounded poll (never a fixed sleep): the timeout expires and read returns.
    await expect
      .poll(
        async () => page.evaluate(async () => (await fetch('/bff/wiki/pages', { credentials: 'include' })).status),
        { timeout: seconds * 1_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(200);
  },
);

// ── Per-page attachments — cross-role upload/download/delete ─────────────────
// A real multipart upload (a writer) + a real browser download event (a reader),
// plus the disabled+helptext contract for a non-writer.

When('{string} opens the wiki page {string}', async ({ user }, username: string, slug: string) => {
  const page = pageOf(user(username).username);
  await page.goto(`/wiki/pages/${slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="wiki-view-title"]')).toBeVisible({ timeout: 15_000 });
});

When('{string} uploads an attachment {string} to the current page', async ({ user }, username: string, filename: string) => {
  const page = pageOf(user(username).username);
  // setInputFiles runs in Node (Playwright side): a real multipart body, no temp file.
  await page.setInputFiles('[data-testid="wiki-att-file"]', {
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(`e2e attachment payload for ${filename}\n`),
  });
  await page.click('[data-testid="wiki-att-upload"]');
  await expect(page.locator('[data-testid="wiki-att-notice"]')).toContainText(`Uploaded ${filename}`, {
    timeout: 15_000,
  });
});

Then('{string} sees the attachment {string} in the list', async ({ user }, username: string, filename: string) => {
  await expect(pageOf(user(username).username).locator(`[data-testid="wiki-att-download-${filename}"]`)).toBeVisible({
    timeout: 15_000,
  });
});

Then('{string} downloads the attachment {string}', async ({ user }, username: string, filename: string) => {
  const page = pageOf(user(username).username);
  // saveBlob() builds a real <a download> and clicks it → a browser download
  // event Playwright captures; assert the delivered filename.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.click(`[data-testid="wiki-att-download-${filename}"]`),
  ]);
  expect(download.suggestedFilename()).toBe(filename);
});

Then("{string}'s attachment write controls are disabled with role help", async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  // Non-writer: the file input is really disabled, Upload is aria-disabled (kept
  // tab-reachable so AT reaches the help), and the help names the required role.
  await expect(page.locator('[data-testid="wiki-att-file"]')).toBeDisabled();
  await expect(page.locator('[data-testid="wiki-att-upload"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-testid="wiki-att-write-help"]')).toContainText('ADMIN or SUPERADMIN');
});

When(
  '{string} deletes the attachment {string} from the current page',
  async ({ user }, username: string, filename: string) => {
    const page = pageOf(user(username).username);
    await page.click(`[data-testid="wiki-att-delete-${filename}"]`);
    await expect(page.locator('[data-testid="wiki-att-notice"]')).toContainText(`Deleted ${filename}`, {
      timeout: 15_000,
    });
  },
);

Then(
  '{string} sees no attachments after reloading the wiki page {string}',
  async ({ user }, username: string, slug: string) => {
    const page = pageOf(user(username).username);
    await page.goto(`/wiki/pages/${slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="wiki-att-empty"]')).toBeVisible({ timeout: 15_000 });
  },
);

// ── Role change mid-session (pure client-side broadcast/storage sync) ─────────

When(
  'the session roles for {string} are re-synced to {string}',
  async ({ user }, username: string, rolesCsv: string) => {
    const page = pageOf(user(username).username);
    const roles = rolesCsv.split(',').map((s) => s.trim()).filter(Boolean);
    // Persist the downgraded roles across any LATER full navigation. seedSession
    // registered an addInitScript that re-writes the ORIGINAL roles on every page
    // load, so without this the final `navigates to /wiki/new` (a full page.goto)
    // would resurrect the pre-downgrade admin session and the guard would let the
    // write view render instead of bouncing to forbidden. Init scripts run in
    // registration order, so this one — added after seedSession's — wins on the
    // next load. (No effect on the no-reload assertions above; init scripts only
    // run on navigation.)
    await page.addInitScript((newRoles) => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return;
      const s = JSON.parse(raw);
      s.roles = newRoles;
      window.localStorage.setItem('hug.session', JSON.stringify(s));
    }, roles);
    // Rewrite hug.session.roles on the CURRENT page and fire the same-document
    // broadcast the host dispatches on a role re-sync; every in-page
    // SessionService re-reads it without a reload.
    await page.evaluate((newRoles) => {
      const raw = window.localStorage.getItem('hug.session');
      const s = raw ? JSON.parse(raw) : {};
      s.roles = newRoles;
      window.localStorage.setItem('hug.session', JSON.stringify(s));
      window.dispatchEvent(new Event('hug-session-change'));
    }, roles);
  },
);
