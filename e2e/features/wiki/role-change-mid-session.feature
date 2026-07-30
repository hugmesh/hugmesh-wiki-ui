# USER-SITUATIONAL / SESSION SYNC — SessionService's whole broadcast/storage-sync
# design (the hug-session-change same-document event + cross-tab storage events)
# exists so a role change reaches ALREADY-OPEN guards and menubars without a
# reload. It is only unit-tested today. Here an admin on /wiki/pages has their
# session downgraded to a granted-MOD reader (the host's role re-sync); the open
# tab's menubar must drop the write destinations, the New-page affordance must
# vanish, and the next guarded navigation must bounce — all without a reload.
#
# This is a PURE client-side behaviour (no BFF call), so a seeded localStorage
# session is the honest tool: the scenario asserts the guard/menubar reaction to a
# session mutation, not a server decision.
#
# @cluster — needs the host shell serving the federated remote; ships dark.
@cluster @wiki-ui @user-situational
Feature: Role change mid-session — a revoked capability propagates to an open tab
  As the wiki console
  I must react to a live session role change without a reload
  So a downgraded operator immediately loses the write surface

  Scenario: an admin downgraded to a granted MOD loses write nav + affordance live
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/pages"
    Then "admin-domain-a" sees the "pages" nav item
    And "admin-domain-a" sees the "new" nav item
    And "admin-domain-a" sees the "access" nav item
    And "admin-domain-a" sees the "wiki-new-page" affordance
    When the session roles for "admin-domain-a" are re-synced to "mod,wiki"
    Then "admin-domain-a" does not see the "new" nav item
    And "admin-domain-a" does not see the "access" nav item
    And "admin-domain-a" does not see the "wiki-new-page" affordance
    And "admin-domain-a" sees the "pages" nav item
    When "admin-domain-a" navigates to "/wiki/new"
    Then "admin-domain-a" is sent to the wiki forbidden screen
