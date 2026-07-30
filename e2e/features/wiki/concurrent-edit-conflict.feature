# MULTIUSER — the wiki's flagship optimistic-concurrency flow, end to end with
# TWO live writers. The editor loads a page's `version`, sends it back as
# `expectedVersion` on PUT, and the BFF returns 409 if another writer bumped the
# version in between (wiki-editor.component: conflict message + wiki-editor-reload
# affordance + `Reloaded to version N` notice). This is only unit-tested against a
# mocked service today; a live regression in the bff's version check or the reload
# path would ship undetected. Here two REAL writers (each own context, own bff_
# cookie) open the same page at the same version and race — the loser is bounced
# with the conflict, recovers via reload, and re-saves onto the fresh baseline.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser
Feature: Concurrent wiki edit — stale expectedVersion 409, reload-latest, resave
  As the wiki platform
  I must reject a second writer's save that raced a concurrent edit
  And let them reload the latest version and re-apply their change

  Scenario: two writers edit the same page; the stale save conflicts then recovers
    Given "admin-domain-a" is logged in in their own context
    And "superadmin" is logged in in their own context
    And "admin-domain-a" authors the wiki page "concurrent-demo" via the API
    When "admin-domain-a" opens the editor for the wiki page "concurrent-demo"
    And "superadmin" opens the editor for the wiki page "concurrent-demo"
    And "admin-domain-a" sets the editor title to "First writer wins the race"
    And "admin-domain-a" saves the editor
    Then "admin-domain-a" lands on the wiki page view for "concurrent-demo"
    When "superadmin" sets the editor title to "Second writer was stale"
    And "superadmin" saves the editor
    Then "superadmin" sees the editor error containing "changed by someone else"
    And "superadmin" sees the "wiki-editor-reload" affordance
    When "superadmin" reloads the latest version
    Then "superadmin" sees the editor notice containing "Reloaded to version"
    When "superadmin" sets the editor title to "Second writer was stale"
    And "superadmin" saves the editor
    Then "superadmin" lands on the wiki page view for "concurrent-demo"
    And "superadmin" sees the wiki page title "Second writer was stale"
