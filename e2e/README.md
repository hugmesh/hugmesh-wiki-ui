# hugmesh-wiki-ui — e2e (Playwright + playwright-bdd)

A Gherkin-driven end-to-end harness for the wiki-ui federated remote. It
copies the proven `hugmesh-games/e2e` pattern: `@playwright/test` +
`playwright-bdd`, single worker run serially, `screenshot:'on'`/`video:'on'`,
an HTML reporter, and the per-step PNG `AfterStep` hook in
`features/support/fixtures.ts`.

The hugmesh.net host mounts the wiki-ui, a native-federation **remote**, at
`/wiki`. The host gates the whole mount behind route-access `ROLE_WIKI`. The
**child guards** then enforce the wiki role boundary per view. The role model
lives in `src/app/session.service.ts` and mirrors `hugmesh-wiki-bff-api`
`WikiController`:

- `wikiReadGuard`  — `WIKI_READ`  = ADMIN | SUPERADMIN | (MOD AND WIKI) → content
- `wikiWriteGuard` — `WIKI_WRITE` = ADMIN | SUPERADMIN → new / edit / access
- `wikiManageGuard`— `WIKI_MANAGE`= SUPERADMIN → manage (overrides / history / audit)

A child-guard DENY sends the user to the **in-remote `/wiki/forbidden`** screen,
not `/login`. The host already let the user in, so a denial here is a privilege
boundary inside the wiki.

| Class | Feature file | What it asserts |
| --- | --- | --- |
| USER-SITUATIONAL | `features/wiki/wiki-surfaces.feature` | each view (content / editor / access / manage), guard ALLOW + DENY → forbidden; role-aware menubar **hides** denied destinations; reader sees **no** New/Edit affordance |
| MULTIUSER | `features/wiki/wiki-authoring.feature` | an admin authoring + running the grant/timeout/ban console for their own brand, while a same-domain granted MOD sees read-only |
| CROSS-USER | `features/multitenant/cross-domain-isolation.feature` | domain-B admin DENIED on domain-A's wiki access (403/404); admin DENIED on superadmin manage/audit; parallel ALLOW/DENY with both users live |
| SECURITY | `features/security/bff-auth-gates.feature` | the wiki-bff rejection paths (401 anon, 403 under-privileged) behind the display-only console |
| SECURITY | `features/security/step-up-signal.feature` | a refusal by role (domain admin, plain user) carries no step-up signal; with the platform MFA gate armed (`MFA_STEPUP_ARMED=1`) a superadmin without a fresh MFA stamp gets a 403 on the audit trail. The `@fixme` scenario, which expects a step-up signal header on that 403, stays red until `hugmesh-wiki-bff-api#35` lands |
| A11Y | `features/a11y/accessibility.feature` | skip-link → focus `#wiki-main`, named menubar landmark + per-item names/help, roving tabindex (one tab stop + Arrow/Home), labelled editor fields, named manage regions, focus restore |

### Multi-user write-path coverage (two live identities per scenario)

The affordance-visibility suite above changes nothing. These scenarios prove the
real write pipeline end to end, with a writer and an independent second user:

| Class | Feature file | What it asserts |
| --- | --- | --- |
| MULTIUSER | `features/wiki/concurrent-edit-conflict.feature` | two writers open the same page; the stale save hits the `expectedVersion` 409 (`changed by someone else`), the loser reloads latest (`Reloaded to version …`) and re-saves onto the fresh baseline |
| MULTIUSER | `features/wiki/authoring-journey.feature` | a real create → view (rendered markdown link + code span) → edit → publish (`Published version …`), then an **independent superadmin** confirms the slug in the `wiki-manage-audit` trail |
| MULTIUSER | `features/multitenant/ban-consequence.feature` | victim-creates-first: a MOD reader proves read, then an admin's ban cuts the next read off (`no longer have permission`); a short timeout auto-restores via a bounded poll (never a sleep) |
| MULTIUSER | `features/multitenant/grant-revoke-lifecycle.feature` | a denied reader's read flips to ALLOW on grant, back to DENY on **Remove grant** (`wiki-access-remove`); a ban is lifted by **Restore** (`wiki-access-restore` → `Ban lifted`) so the surviving grant reads again |
| CROSS-USER | `features/multitenant/cross-domain-content-isolation.feature` | a domain-A admin really authors a page (POST); a domain-B admin can neither list nor read it (403/404) — real content isolation, not a `?domain=` probe |
| MULTIUSER | `features/multitenant/cross-brand-target-domain.feature` | a superadmin `targetDomain` grant lands in the named brand (`wiki-access-result-domain` + the victim's read starts succeeding); the Target brand picker offers the server's own brands and cannot name an unknown one (the older "verbatim fail-closed 400" scenario was replaced when the picker landed) |
| MULTIUSER | `features/wiki/attachments-cross-role.feature` | an admin uploads (multipart); a same-domain MOD reader lists + downloads it (real download event, right filename) while their upload/delete controls are `aria-disabled` with the role helptext; the admin's delete empties the panel on reload |
| USER-SITUATIONAL | `features/wiki/role-change-mid-session.feature` | an open admin tab downgraded to granted-MOD (the `hug-session-change` re-sync) drops the New/Access nav + `wiki-new-page` affordance and bounces the next guarded nav — no reload |

The coverage classes pair ALLOW + DENY for every wiki role (superadmin / admin /
granted-mod / bare-mod / plain-user). They exercise the subtle `(MOD AND WIKI)`
AND-gate: a bare MOD without the `wiki` role is **not** a reader. They also
exercise the disabled/hidden + helptext surface: the forbidden screen explains
the missing role, and the access console has field help.

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell serving the remote +
wiki-bff + Casdoor seed) carries the **`@cluster`** tag at the feature level.
The default config filters them out (`tags: 'not @cluster'`). The default run
therefore needs **no cluster**, and the GitLab `e2e:bdd` job is
`allow_failure: true`.

The suite uses `@cluster` on purpose, not playwright-bdd's reserved `@skip`.
`@skip` drops a scenario from generation entirely (`bddgen` emits 0 specs for
it), so nobody can *discover* a `@skip`-tagged suite. `@cluster` is a plain
filter tag. The no-filter validation below generates and lists all 50
scenarios, which proves the Gherkin compiles, while the default config keeps
them dark.

## Offline validation (no cluster)

```sh
npm install
npx bddgen            # default: 'not @cluster' → 0 specs (ships dark, intended)
npx playwright test --list   # → 0 tests (dark, intended)

# Prove every feature compiles + all scenarios are discovered (no filter):
cat > pw-validate.config.ts <<'EOF'
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const d = defineBddConfig({ features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/**/*.ts'] });
export default defineConfig({ reporter: [['list']],
  use: { ignoreHTTPSErrors: true, screenshot: 'on', video: 'on' },
  projects: [{ name: 'bdd', testDir: d, use: { ...devices['Desktop Chrome'] } }] });
EOF
npx bddgen -c pw-validate.config.ts
npx playwright test --list -c pw-validate.config.ts   # → 50 tests in 14 files
rm pw-validate.config.ts
```

## Running against a live stack (later wave)

Drop the `@cluster` tag from a feature (or run with an override config that
omits the `not @cluster` filter), export `E2E_BASE_URL`, then run `npm run bdd`.
Export the per-role `E2E_<ROLE>_PASSWORD` vars too if you want to override the
seeded passwords.

The per-user `E2E_<ROLE>_PASSWORD` and shared `E2E_PASSWORD` env vars are
optional overrides, not requirements. `tests/helpers/roles.ts`
(`passwordFor()`) falls back to the run-state `.e2e-credentials` file that
hugmesh-generator's `make stack-seed` writes (`$E2E_CREDENTIALS_FILE`, or a
`.e2e-credentials` found by walking up from cwd). There is no built-in literal
password. If nothing resolves, the suite throws and names `make stack-seed`,
instead of quietly logging in with a guessable default.
