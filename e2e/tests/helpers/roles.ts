import * as fs from 'node:fs';
import * as path from 'node:path';
import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the wiki-ui e2e matrix. Adapted from the
 * proven hugmesh.games/e2e helper, but keyed to THIS app's session model:
 * the wiki-ui (and its host) persist a {@link SnapSession} under the
 * `hug.session` localStorage key (see src/app/session.service.ts), whose
 * `roles: string[]` drives every guard — wikiReadGuard, wikiWriteGuard,
 * wikiManageGuard — via the lowercased, Casdoor-style role flags.
 *
 * ── The wiki role model (mirrors hugmesh-wiki-bff-api WikiController) ──
 *   WIKI_READ   = ADMIN | SUPERADMIN | (MOD AND WIKI)  → see content.
 *   WIKI_WRITE  = ADMIN | SUPERADMIN                   → author + grant/timeout/ban.
 *   WIKI_MANAGE = SUPERADMIN                           → list-all + history + audit.
 *
 * The catalogue is built to exercise the THREE coverage classes the wave demands:
 *   - USER-SITUATIONAL  — each wiki view (content / new+edit / access / manage),
 *                         ALLOW + DENY (denied → in-remote /wiki/forbidden), plus
 *                         the disabled/hidden+helptext surface (a MOD reader sees
 *                         no "New page"/"Edit" affordance).
 *   - MULTIUSER         — an admin authoring + granting over their own domain.
 *   - CROSS-USER        — a domain-A admin DENIED on a domain-B wiki resource at
 *                         the BFF (domain-scoped, fail-closed), and a plain
 *                         user / bare-MOD DENIED on the content view.
 *
 * The `kind` tag selects which role-specific assertions a feature drives. The
 * `domain` tag drives the cross-domain isolation scenarios. Passwords resolve
 * via {@link passwordFor}: a per-user override env var, then the shared
 * `process.env.E2E_PASSWORD`, then the run-state credentials file written by
 * hugmesh-generator's `make stack-seed` — there is no literal fallback.
 */
export type RoleKind = 'superadmin' | 'admin' | 'mod-wiki' | 'mod' | 'user';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — wiki-ui sessions are google- or discord-backed. */
  provider: 'google' | 'discord';
  /** The lowercased Casdoor roles this user carries in `hug.session.roles`
   *  (incl. the per-service 'wiki' access role). */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
  /** Brand/domain this user belongs to — used by the cross-domain DENY specs. */
  domain?: string;
}

export const SEED_USERS: SeedUser[] = [
  // ── Superadmin — the only role that may reach the Manage view (list-all
  //    overrides + a principal's history + the content audit trail). Is also a
  //    reader + writer (the composites add SUPERADMIN where the cascade requires).
  { username: 'superadmin', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google', roles: ['superadmin'], kind: 'superadmin', domain: 'domain-a' },

  // ── Domain admins — WIKI_WRITE. May read, author/edit content, and run the
  //    grant/timeout/ban access console. `admin-domain-a` and `admin-domain-b`
  //    belong to DIFFERENT brands; the cross-user isolation scenarios assert each
  //    is DENIED on the other's domain-scoped wiki resource at the BFF.
  { username: 'admin-domain-a', passwordEnv: 'E2E_ADMIN_A_PASSWORD', provider: 'google',  roles: ['admin'], kind: 'admin', domain: 'domain-a' },
  { username: 'admin-domain-b', passwordEnv: 'E2E_ADMIN_B_PASSWORD', provider: 'discord', roles: ['admin'], kind: 'admin', domain: 'domain-b' },

  // ── Granted MOD — a moderator who additionally carries the per-service 'wiki'
  //    access role: WIKI_READ via the AND-half (MOD AND WIKI). Reads content but
  //    is DENIED on new/edit/access (no "New page"/"Edit" affordance; the write
  //    guard sends a direct nav to /wiki/forbidden). The ALLOW-but-restricted
  //    surface the requirement's "disabled/hidden + helptext" pairing targets.
  { username: 'mod-wiki', passwordEnv: 'E2E_MOD_WIKI_PASSWORD', provider: 'google', roles: ['mod', 'wiki'], kind: 'mod-wiki', domain: 'domain-a' },

  // ── Bare MOD — moderator WITHOUT the 'wiki' role. The AND-half fails, so this
  //    user is NOT a reader: the content guard bounces them to /wiki/forbidden.
  //    The subtle DENY a path-level hasAnyRole could not express.
  { username: 'mod-no-wiki', passwordEnv: 'E2E_MOD_PASSWORD', provider: 'discord', roles: ['mod'], kind: 'mod', domain: 'domain-a' },

  // ── Plain user — no admin/mod role at all. The floor of the DENY matrix:
  //    even the content view sends them to /wiki/forbidden.
  { username: 'plain-user', passwordEnv: 'E2E_USER_PASSWORD', provider: 'google', roles: ['user'], kind: 'user', domain: 'domain-a' },

  // ── Domain-B plain reader — a role-less user in domain-b, the victim of the
  //    SUPERADMIN cross-brand targetDomain grant: denied first, then a superadmin
  //    grant that NAMES brand 'domain-b' must enable exactly this user's read
  //    (proving the write landed in the right tenant, not `default`).
  { username: 'reader-domain-b', passwordEnv: 'E2E_READER_B_PASSWORD', provider: 'discord', roles: ['user'], kind: 'user', domain: 'domain-b' },
];

/**
 * Locate the run-state credentials file written by hugmesh-generator's
 * `tests/stack/e2e-password.sh` (`e2e_password_ensure()`): `$E2E_CREDENTIALS_FILE`
 * if set, else a `.e2e-credentials` found by walking up from `process.cwd()`.
 * This repo is a CONSUMER — it never generates the file, only reads it — so an
 * explicit override plus an upward search covers both "run from the repo root"
 * and "run from e2e/" without hardcoding a single relative path.
 */
function findCredentialsFile(): string | undefined {
  const override = process.env['E2E_CREDENTIALS_FILE'];
  if (override) return override;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.e2e-credentials');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Parse the plain `KEY=value` run-state credentials file (no quotes, no
 * `export` keyword — see CONTRACT rule 3). A missing/unreadable file is NOT an
 * error here: it yields an empty map so {@link passwordFor} falls through to
 * its own explicit error instead of an ENOENT stack trace.
 */
function readCredentialsFile(): Record<string, string> {
  const file = findCredentialsFile();
  if (!file) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return values;
}

/**
 * Resolve a seed user's password. Precedence:
 *   1. the per-user override, `process.env[user.passwordEnv]`
 *   2. the shared `process.env.E2E_PASSWORD` (same-run propagation)
 *   3. the run-state credentials file (role-specific key, then `E2E_PASSWORD`)
 * There is no literal fallback (CONTRACT rule 4) — a run with nothing seeded
 * throws, naming `make stack-seed`, rather than silently authenticating with a
 * guessable default.
 */
export function passwordFor(user: SeedUser): string {
  const fromEnv = process.env[user.passwordEnv] ?? process.env['E2E_PASSWORD'];
  if (fromEnv) return fromEnv;

  const creds = readCredentialsFile();
  const fromFile = creds[user.passwordEnv] ?? creds['E2E_PASSWORD'];
  if (fromFile) return fromFile;

  throw new Error(
    `No e2e password resolved for seed user "${user.username}" ` +
      `(checked process.env.${user.passwordEnv}, process.env.E2E_PASSWORD, and the ` +
      'run-state credentials file — $E2E_CREDENTIALS_FILE or .e2e-credentials ' +
      'walked up from cwd). Run `make stack-seed` in hugmesh-generator first: it ' +
      'generates the e2e password and writes .e2e-credentials for consumers like this suite.',
  );
}

/**
 * The stable Casdoor subject a seed user carries — the value an access-console
 * operator types into the "User subject" field to act ON this user (grant /
 * timeout / ban / restore / remove), and the identity the BFF stamps on the
 * audit + override rows.
 *
 * It is derived the SAME way {@link seedSession} builds `hug.session.id`
 * (`<provider>:<username>@example.test`), so a scenario that bans "mod-wiki" and
 * a scenario that seeds "mod-wiki" agree on one subject. A later wave that wires
 * these @cluster features to a live Casdoor seed only has to make the seeded
 * subjects match this shape (or override this single helper) — no feature file
 * changes.
 */
export function subjectFor(user: SeedUser): string {
  return `${user.provider}:${user.username}@example.test`;
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `hug.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE Casdoor + host shell, so it is only
 * exercised by scenarios tagged `@cluster` today (wave 2b ships dark). It is
 * written now so a later wave can un-cluster a feature without rewriting steps.
 *
 * The host shell renders the login micro-frontend; on success the SessionService
 * writes `hug.session` (see set()/broadcast()) and the BFF sets the HttpOnly
 * `bff_` cookie via Set-Cookie. We wait for that key to carry the session
 * `roles` so a follow-up guarded navigation doesn't race the write.
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // login-ui's form (login.component.html) is template-driven and carries NO
  // formControlName; its selector contract is data-testid login-username /
  // login-password / login-submit. The old formControlName-attribute input and
  // login-btn class selectors matched nothing (measured 2026-09-23 against the
  // compose stack: the username wait timed out on every "is logged in" row).
  await page.locator('[data-testid="login-username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('[data-testid="login-username"]', user.username);
  await page.fill('[data-testid="login-password"]', passwordFor(user));
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return false;
      try {
        return Array.isArray(JSON.parse(raw).roles);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Log a seed user in inside a FRESH, cert-trusting browser context so several
 * real identities can coexist in one scenario (the multi-user write flows:
 * two admins editing the same page, an author + an independent superadmin
 * auditor, a moderator whose read is cut off mid-session by an admin). Mirrors
 * {@link newE2eContext} + {@link login}; the caller registers the returned page.
 *
 * @cluster-only — hits a LIVE Casdoor + host shell, so it is exercised only by
 * @cluster scenarios today (the default run ships dark). Written now so a later
 * wave can un-cluster a feature without rewriting steps.
 */
export async function loginInNewContext(
  browser: Browser,
  user: SeedUser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newE2eContext(browser);
  const page = await context.newPage();
  await login(page, user);
  return { context, page };
}

/**
 * Seed a {@link SnapSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes, so guards reading the
 * `roles` array behave exactly as in production. Used by the offline/dark
 * scenarios that assert pure client-side guard behaviour (forbidden bounce,
 * skip-link focus, roving tabindex, hidden write affordances) without needing
 * the BFF — and by the live scenarios as a faster alternative to a full login
 * where the token is not exercised.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['hug.session', JSON.stringify(session)] as const,
  );
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's guard check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('hug.session'));
}
