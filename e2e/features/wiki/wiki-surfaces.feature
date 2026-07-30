# USER-SITUATIONAL coverage — each wiki view, ALLOW + DENY, plus the
# hidden-affordance + helptext surface.
#
# The wiki-ui mounts every view behind a child guard (wiki.routes.ts); the host
# already authgated the user into the whole /wiki mount (route-access ROLE_WIKI),
# so a child-guard DENY is a WITHIN-WIKI privilege boundary — it routes to the
# in-remote /wiki/forbidden screen (NOT /login). The role model
# (session.service.ts, mirroring hugmesh-wiki-bff-api WikiController):
#   wikiReadGuard   WIKI_READ   = ADMIN | SUPERADMIN | (MOD AND WIKI) → content
#   wikiWriteGuard  WIKI_WRITE   = ADMIN | SUPERADMIN                  → new/edit/access
#   wikiManageGuard WIKI_MANAGE  = SUPERADMIN                          → manage
# The role-aware menubar (wiki-console) HIDES nav items + the content list HIDES
# the "New page"/"Edit" affordances a role can't use, so nothing leaks.
#
# @cluster — wave 2b ships DARK. These need the host shell serving the federated
# remote + a live session, so they're tagged @cluster and the config filters them
# out (`tags: 'not @cluster'`) so the default run requires no live stack. They still
# COMPILE + DISCOVER (a no-filter bddgen + `playwright test --list` proves it) — unlike
# playwright-bdd's reserved @skip, which drops a scenario from generation entirely.
@cluster @wiki-ui @user-situational
Feature: Wiki console surfaces — per-role ALLOW, DENY and hidden affordances
  As the wiki-ui remote
  I must render each wiki view only for a role its guard admits
  So content authoring, access control and management never leak to an under-privileged operator

  # ── Content read view (WIKI_READ) ──────────────────────────────────────────
  Scenario: a superadmin reaches the content list (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/pages"
    Then "superadmin" sees the "wiki-pages-title" view

  Scenario: a domain admin reaches the content list (ALLOW)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/pages"
    Then "admin-domain-a" sees the "wiki-pages-title" view

  Scenario: a granted MOD (mod AND wiki) reaches the content list read-only (ALLOW)
    Given "mod-wiki" has a seeded session
    When "mod-wiki" navigates to "/wiki/pages"
    Then "mod-wiki" sees the "wiki-pages-title" view
    And "mod-wiki" does not see the "wiki-new-page" affordance

  Scenario: a bare MOD without the wiki role is bounced from content (DENY)
    Given "mod-no-wiki" has a seeded session
    When "mod-no-wiki" navigates to "/wiki/pages"
    Then "mod-no-wiki" is sent to the wiki forbidden screen
    And the forbidden screen explains the missing role

  Scenario: a plain user is bounced from content (DENY floor)
    Given "plain-user" has a seeded session
    When "plain-user" navigates to "/wiki/pages"
    Then "plain-user" is sent to the wiki forbidden screen

  # ── Editor / create (WIKI_WRITE) ────────────────────────────────────────────
  Scenario: an admin reaches the new-page editor (ALLOW)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/new"
    Then "admin-domain-a" sees the "wiki-editor-title" view
    And every wiki editor field is labelled

  Scenario: a granted MOD reader is bounced from the editor (DENY — read-only)
    Given "mod-wiki" has a seeded session
    When "mod-wiki" navigates to "/wiki/new"
    Then "mod-wiki" is sent to the wiki forbidden screen

  # ── Access console (WIKI_WRITE) ─────────────────────────────────────────────
  Scenario: an admin reaches the access (grant/timeout/ban) console (ALLOW)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/access"
    Then "admin-domain-a" sees the "wiki-access-title" view

  Scenario: a granted MOD reader is bounced from the access console (DENY)
    Given "mod-wiki" has a seeded session
    When "mod-wiki" navigates to "/wiki/access"
    Then "mod-wiki" is sent to the wiki forbidden screen

  # ── Manage view (WIKI_MANAGE — superadmin only) ─────────────────────────────
  Scenario: a superadmin reaches the management view (ALLOW)
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/manage"
    Then "superadmin" sees the "wiki-manage-active-title" view

  Scenario: a domain admin is bounced from the management view (DENY — superadmin only)
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/manage"
    Then "admin-domain-a" is sent to the wiki forbidden screen

  # ── Role-aware menubar — the nav itself never offers a denied destination ───
  Scenario: the menubar offers a superadmin every wiki destination
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/pages"
    Then "superadmin" sees the "pages" nav item
    And "superadmin" sees the "new" nav item
    And "superadmin" sees the "access" nav item
    And "superadmin" sees the "manage" nav item

  Scenario: the menubar offers an admin content + write but not manage
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/pages"
    Then "admin-domain-a" sees the "pages" nav item
    And "admin-domain-a" sees the "new" nav item
    And "admin-domain-a" sees the "access" nav item
    And "admin-domain-a" does not see the "manage" nav item

  Scenario: the menubar offers a granted MOD only content (read-only)
    Given "mod-wiki" has a seeded session
    When "mod-wiki" navigates to "/wiki/pages"
    Then "mod-wiki" sees the "pages" nav item
    And "mod-wiki" does not see the "new" nav item
    And "mod-wiki" does not see the "access" nav item
    And "mod-wiki" does not see the "manage" nav item
