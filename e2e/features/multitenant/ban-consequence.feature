# MULTIUSER / VICTIM-CREATES-FIRST — the ban & timeout overlay exists precisely
# to cut off an ACTIVE reader, and wiki-pages.component carries dedicated copy for
# it ("You no longer have permission to read the wiki"). The current suite only
# checks the console renders its radios; no scenario ever applies a ban to a user
# who FIRST proved read access. Here the victim (a granted MOD reader) proves read
# BEFORE the DENY, an admin bans/timeouts them in a second live context, and the
# victim's next read is cut off — the platform's victim-creates-first rule applied
# to the wiki's central moderation feature. The timeout variant uses a bounded
# poll (never a sleep) to prove read auto-restores when the window expires.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser @cross-user
Feature: Mid-session ban/timeout consequence — a live reader is cut off then restored
  As the wiki platform
  I must revoke an active reader's access the moment a ban/timeout is applied
  And auto-restore it when a timeout expires

  Scenario: an admin bans a reader who first proved read; the reader is cut off
    Given "mod-wiki" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "mod-wiki" navigates to "/wiki/pages"
    Then "mod-wiki" sees the "wiki-pages-title" view
    When "admin-domain-a" navigates to "/wiki/access"
    And "admin-domain-a" bans "mod-wiki"
    Then "admin-domain-a" sees the access result type "banned" and state "active"
    When "mod-wiki" navigates to "/wiki/pages"
    Then "mod-wiki" sees the wiki pages error containing "no longer have permission"

  Scenario: a timeout cuts read off then auto-restores when the window expires
    Given "mod-wiki" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "mod-wiki" navigates to "/wiki/pages"
    Then "mod-wiki" sees the "wiki-pages-title" view
    When "admin-domain-a" times out "mod-wiki" for 5 seconds via the API
    Then "mod-wiki"'s wiki read is denied at the BFF
    And "mod-wiki"'s wiki read auto-restores within 30 seconds
