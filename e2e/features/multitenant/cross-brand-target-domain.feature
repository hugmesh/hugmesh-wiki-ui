# MULTIUSER / SUPERADMIN CROSS-BRAND — the newest and riskiest access-console
# behaviour (wiki-bff PR #39 fail-closed targetDomain). A scoped ADMIN always
# writes into their own brand (the bff ignores any body domain); a SUPERADMIN has
# no brand of their own, so on a multi-brand deployment they MUST name the victim's
# brand via `targetDomain` and the bff FAILS CLOSED (400) otherwise — rather than
# stamping `default`, where the read guard would never match. Fully unit-tested
# against a mock, referenced by no feature file. Here a real superadmin names a
# brand and the grant lands there (the result echoes the bff-stamped brand AND the
# named victim's read actually starts succeeding), while an unknown brand is
# rejected with the server's verbatim 400 — not the generic client retry copy.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser @cross-user
Feature: SUPERADMIN cross-brand targetDomain — the grant lands in the named brand or fails closed
  As the multi-brand wiki platform
  I must let a superadmin target a victim's brand explicitly
  And reject an unknown or missing brand fail-closed with the server's own message

  Scenario: a superadmin grant that names the victim's brand lands there and enables read
    Given "reader-domain-b" is logged in in their own context
    And "superadmin" is logged in in their own context
    Then "reader-domain-b"'s wiki read is denied at the BFF
    When "superadmin" navigates to "/wiki/access"
    And "superadmin" grants read access to "reader-domain-b" in brand "domain-b"
    Then "superadmin" sees the access result type "read" and state "active"
    And "superadmin" sees the access result brand "domain-b"
    And "reader-domain-b"'s wiki read succeeds at the BFF

  # NEEDS REWORK, and not verifiable from a workstation: this scenario predates the brand
  # PICKER (hugmesh-wiki-ui#3 / hugmesh-wiki-bff-api#12). On a multi-brand stack the target
  # control is now a CLOSED <select> whose options are exactly what the bff accepts, so an
  # unknown brand cannot be chosen and the server's fail-closed 400 is no longer reachable
  # from this screen — `selectOption` will fail instead. The behaviour it asserts is not
  # gone: it is now (a) covered against a mock by wiki-access.component.spec.ts, and (b)
  # still reachable through the free-text FALLBACK the console renders when the catalogue
  # read fails. Whoever next runs the @cluster lane should either re-point it at that
  # fallback or replace it with "an unknown brand is not offered at all".
  Scenario: a superadmin grant naming an unknown brand is rejected verbatim (fail-closed 400)
    Given "superadmin" is logged in in their own context
    When "superadmin" navigates to "/wiki/access"
    And "superadmin" grants read access to "reader-domain-b" in an unknown brand
    Then "superadmin" sees a verbatim server access error
