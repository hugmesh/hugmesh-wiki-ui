# hugmesh-wiki-ui — e2e (Playwright + playwright-bdd)

Gherkin-driven end-to-end harness for the wiki-ui federated remote, copied from
the proven `hugmesh-games/e2e` pattern (`@playwright/test` +
`playwright-bdd`, single-worker serial, `screenshot:'on'`/`video:'on'`, HTML
reporter, the per-step PNG `AfterStep` hook in
`features/support/fixtures.ts`).

The wiki-ui is a native-federation **remote** mounted by the hugmesh.systems
host at `/wiki` (the host gates the whole mount behind route-access `ROLE_WIKI`);
the **child guards** then enforce the per-view wiki role boundary. The role model
(`src/app/session.service.ts`, mirroring `hugmesh-wiki-bff-api`
`WikiController`):

- `wikiReadGuard`  — `WIKI_READ`  = ADMIN | SUPERADMIN | (MOD AND WIKI) → content
- `wikiWriteGuard` — `WIKI_WRITE` = ADMIN | SUPERADMIN → new / edit / access
- `wikiManageGuard`— `WIKI_MANAGE`= SUPERADMIN → manage (overrides / history / audit)

A child-guard DENY routes to the **in-remote `/wiki/forbidden`** screen (not
`/login`) — the host already authgated the user in, so a denial here is a
within-wiki privilege boundary.

| Class | Feature file | What it asserts |
| --- | --- | --- |
| USER-SITUATIONAL | `features/wiki/wiki-surfaces.feature` | each view (content / editor / access / manage), guard ALLOW + DENY → forbidden; role-aware menubar **hides** denied destinations; reader sees **no** New/Edit affordance |
| MULTIUSER | `features/wiki/wiki-authoring.feature` | an admin authoring + running the grant/timeout/ban console for their own brand, while a same-domain granted MOD sees read-only |
| CROSS-USER | `features/multitenant/cross-domain-isolation.feature` | domain-B admin DENIED on domain-A's wiki access (403/404); admin DENIED on superadmin manage/audit; parallel ALLOW/DENY with both users live |
| SECURITY | `features/security/bff-auth-gates.feature` | the wiki-bff rejection paths (401 anon, 403 under-privileged) behind the display-only console |
| A11Y | `features/a11y/accessibility.feature` | skip-link → focus `#wiki-main`, named menubar landmark + per-item names/help, roving tabindex (one tab stop + Arrow/Home), labelled editor fields, named manage regions, focus restore |

### Multi-user write-path coverage (two live identities per scenario)

The affordance-visibility suite above never mutates anything; these prove the
real write pipeline end to end with a writer + an independent second user:

| Class | Feature file | What it asserts |
| --- | --- | --- |
| MULTIUSER | `features/wiki/concurrent-edit-conflict.feature` | two writers open the same page; the stale save hits the `expectedVersion` 409 (`changed by someone else`), the loser reloads latest (`Reloaded to version …`) and re-saves onto the fresh baseline |
| MULTIUSER | `features/wiki/authoring-journey.feature` | a real create → view (rendered markdown link + code span) → edit → publish (`Published version …`), then an **independent superadmin** confirms the slug in the `wiki-manage-audit` trail |
| MULTIUSER | `features/multitenant/ban-consequence.feature` | victim-creates-first: a MOD reader proves read, then an admin's ban cuts the next read off (`no longer have permission`); a short timeout auto-restores via a bounded poll (never a sleep) |
| MULTIUSER | `features/multitenant/grant-revoke-lifecycle.feature` | a denied reader's read flips to ALLOW on grant, back to DENY on **Remove grant** (`wiki-access-remove`); a ban is lifted by **Restore** (`wiki-access-restore` → `Ban lifted`) so the surviving grant reads again |
| CROSS-USER | `features/multitenant/cross-domain-content-isolation.feature` | a domain-A admin really authors a page (POST); a domain-B admin can neither list nor read it (403/404) — real content isolation, not a `?domain=` probe |
| MULTIUSER | `features/multitenant/cross-brand-target-domain.feature` | a superadmin `targetDomain` grant lands in the named brand (`wiki-access-result-domain` + the victim's read starts succeeding); an unknown brand is rejected with the server's **verbatim** fail-closed 400 |
| MULTIUSER | `features/wiki/attachments-cross-role.feature` | an admin uploads (multipart); a same-domain MOD reader lists + downloads it (real download event, right filename) while their upload/delete controls are `aria-disabled` with the role helptext; the admin's delete empties the panel on reload |
| USER-SITUATIONAL | `features/wiki/role-change-mid-session.feature` | an open admin tab downgraded to granted-MOD (the `hug-session-change` re-sync) drops the New/Access nav + `wiki-new-page` affordance and bounces the next guarded nav — no reload |

The three coverage classes pair ALLOW + DENY for every wiki role
(superadmin / admin / granted-mod / bare-mod / plain-user), exercising the subtle
`(MOD AND WIKI)` AND-gate (a bare MOD without the `wiki` role is **not** a reader)
and the disabled/hidden + helptext surface (the forbidden screen explains the
missing role; the access console field help).

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell serving the remote +
wiki-bff + Casdoor seed) is tagged **`@cluster`** at the feature level. The
default config filters them out (`tags: 'not @cluster'`), so the default run
needs **no cluster** and the GitLab `e2e:bdd` job is `allow_failure: true`.

`@cluster` is used deliberately instead of playwright-bdd's reserved `@skip`:
`@skip` drops a scenario from generation entirely (`bddgen` emits 0 specs for
it), so a `@skip`-tagged suite cannot be *discovered*. `@cluster` is a plain
filter tag — the no-filter validation below generates and lists all 46
scenarios, proving the Gherkin compiles, while the default config keeps them
dark.

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
npx playwright test --list -c pw-validate.config.ts   # → 46 tests in 13 files
rm pw-validate.config.ts
```

## Running against a live stack (later wave)

Drop the `@cluster` tag from a feature (or run with an override config that
omits the `not @cluster` filter), export `E2E_BASE_URL` + the per-role
`E2E_*_PASSWORD` vars, then `npm run bdd`.
