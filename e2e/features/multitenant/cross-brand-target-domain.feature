# MULTIUSER / SUPERADMIN CROSS-BRAND — the newest and riskiest access-console
# behaviour (wiki-bff PR #39 fail-closed targetDomain). A scoped ADMIN always
# writes into their own brand (the bff ignores any body domain); a SUPERADMIN has
# no brand of their own, so on a multi-brand deployment they MUST name the victim's
# brand via `targetDomain` and the bff FAILS CLOSED (400) otherwise — rather than
# stamping `default`, where the read guard would never match. Fully unit-tested
# against a mock, referenced by no feature file. Here a real superadmin names a
# brand and the grant lands there (the result echoes the bff-stamped brand AND the
# named victim's read actually starts succeeding), and the control they name it
# with is proved to be the SERVER's own brand list (hugmesh-wiki-ui#3's picker,
# fed by GET /bff/wiki/superadmin/brands) — which is what makes an unknown brand
# unnameable from this screen rather than a 400 to read back.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser @cross-user
Feature: SUPERADMIN cross-brand targetDomain — the grant lands in the named brand or fails closed
  As the multi-brand wiki platform
  I must let a superadmin target a victim's brand explicitly
  And offer only the brands the server itself accepts, so an unknown one cannot be named

  Scenario: a superadmin grant that names the victim's brand lands there and enables read
    Given "reader-domain-b" is logged in in their own context
    And "superadmin" is logged in in their own context
    Then "reader-domain-b"'s wiki read is denied at the BFF
    When "superadmin" navigates to "/wiki/access"
    And "superadmin" grants read access to "reader-domain-b" in brand "domain-b"
    Then "superadmin" sees the access result type "read" and state "active"
    And "superadmin" sees the access result brand "domain-b"
    And "reader-domain-b"'s wiki read succeeds at the BFF

  # REPLACES "a superadmin grant naming an unknown brand is rejected verbatim (fail-closed
  # 400)". That scenario predated the brand PICKER (hugmesh-wiki-ui#3 /
  # hugmesh-wiki-bff-api#12) and its premise is now dead: on a multi-brand stack the control
  # is a CLOSED <select> over the bff's own registry, so an unknown brand cannot be NAMED
  # from this screen and `selectOption` would fail before the server ever saw it. Leaving it
  # tagged-and-active would have handed the next @cluster run a deterministic red whose
  # cause was a comment.
  #
  # The behaviour it used to assert is not lost: the bff's fail-closed 400 is covered by
  # WikiAccessServiceTest/WikiAccessSuperadminCrossBrandBanTest in hugmesh-wiki-bff-api and,
  # through the console's free-text FALLBACK, by wiki-access.component.spec.ts against a
  # mock ("surfaces the bff fail-closed 400 verbatim when no brand is named"). What only a live stack can prove is the
  # property that replaced it — that the options really are the server's registry, fetched
  # through the gateway with the bff_ cookie — so that is what this asserts.
  Scenario: the brand picker offers the server's own brands, and cannot name an unknown one
    Given "superadmin" is logged in in their own context
    When "superadmin" navigates to "/wiki/access"
    Then "superadmin" is offered brand "domain-b" and NOT "no-such-brand-zzz"
