# MULTIUSER — the grant/revoke round trip and the two result-row buttons the
# suite references nowhere: wiki-access-remove (DELETE …/access/read/{user}) and
# wiki-access-restore (DELETE …/access/banned/{user}). A CAS-revoke regression
# (active→revoked) or a grant that never takes effect would pass the whole current
# suite. Here a real victim is DENIED first (victim-creates-first), an admin's
# grant flips their read to ALLOW, Remove-grant flips it back to DENY; and on the
# ban half, a ban (which takes precedence over the grant) is lifted by Restore and
# the surviving grant lets the victim read again — every transition observed at
# the BFF with the victim's own live session.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser @cross-user
Feature: Grant/revoke lifecycle — grant enables read, Remove/Restore reverse it
  As the wiki platform
  I must make a grant enable a denied reader and a revoke/ban take it away
  And let Restore lift a ban so the surviving grant reads again

  Scenario: grant enables a denied reader; Remove grant denies them again
    Given "plain-user" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    Then "plain-user"'s wiki read is denied at the BFF
    When "admin-domain-a" navigates to "/wiki/access"
    And "admin-domain-a" grants read access to "plain-user"
    Then "admin-domain-a" sees the access result type "read" and state "active"
    And "admin-domain-a" sees the "wiki-access-remove" affordance
    And "plain-user"'s wiki read succeeds at the BFF
    When "admin-domain-a" clicks remove grant on the result
    Then "admin-domain-a" sees the access notice containing "Read grant removed"
    And "plain-user"'s wiki read is denied at the BFF

  Scenario: a ban takes precedence over the grant; Restore lifts it and read returns
    Given "plain-user" is logged in in their own context
    And "admin-domain-a" is logged in in their own context
    When "admin-domain-a" navigates to "/wiki/access"
    And "admin-domain-a" grants read access to "plain-user"
    Then "plain-user"'s wiki read succeeds at the BFF
    When "admin-domain-a" bans "plain-user"
    Then "admin-domain-a" sees the access result type "banned" and state "active"
    And "admin-domain-a" sees the "wiki-access-restore" affordance
    And "plain-user"'s wiki read is denied at the BFF
    When "admin-domain-a" clicks restore on the result
    Then "admin-domain-a" sees the access notice containing "Ban lifted"
    And "plain-user"'s wiki read succeeds at the BFF
