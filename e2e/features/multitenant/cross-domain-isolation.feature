# CROSS-USER ISOLATION — the multi-tenant keystone for the wiki. The wiki access
# console is domain-scoped ("Changes are domain-scoped to your brand"), and the
# superadmin management surface is above every domain admin. The CLIENT guards are
# role-only (they cannot see another brand's data regardless), so the cross-brand
# and cross-tier boundary is enforced at the BFF: a cross-tier read or a
# cross-domain write returns 403/404 (fail-closed) even if the UI were bypassed.
#
# HONESTY: the API-probe scenarios use REAL Casdoor logins (bff_ cookie) and REAL
# routes/verbs — an earlier revision GET-probed `/bff/wiki/admin/access?domain=…`
# and `…/access/grant?domain=…`, neither of which exists in openapi.json (admin
# access is POST grant/timeout/ban + DELETE revoke), with seeded localStorage
# sessions that never obtain the cookie (so a live call would be 401, not the
# asserted 403/404). Those are replaced below. The two parallel client-nav
# scenarios keep seedSession deliberately — they assert pure client-side guard
# behaviour (no BFF call), the only honest use of a cookieless seeded session.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @cross-user
Feature: Cross-domain wiki isolation — a domain admin cannot reach another brand's wiki
  As the multi-tenant wiki platform
  I must isolate each brand's wiki content + access state from every other brand
  So a compromised domain-A admin token cannot read or mutate domain-B's wiki

  Scenario: a domain-B admin is denied the superadmin access list at the BFF (403)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-b" GETs "/bff/wiki/superadmin/access"
    Then the response status is 403

  Scenario: a domain-B admin cannot publish a domain-A page (cross-domain write DENY)
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" authors the wiki page "iso-a-page" via the API
    And "admin-domain-b" attempts to publish the wiki page "iso-a-page" via the API
    Then the response status is one of 403 or 404

  Scenario: a domain admin cannot reach the superadmin audit surface via the BFF (403)
    Given "admin-domain-a" is logged in in their own context
    When "admin-domain-a" GETs "/bff/wiki/superadmin/audit"
    Then the response status is 403

  Scenario: each domain admin reaches only their own wiki content shell (parallel ALLOW)
    Given "admin-domain-a" has a seeded session in their own context
    And "admin-domain-b" has a seeded session in their own context
    When "admin-domain-a" navigates to "/wiki/pages"
    And "admin-domain-b" navigates to "/wiki/pages"
    Then "admin-domain-a" sees the "wiki-pages-title" view
    And "admin-domain-b" sees the "wiki-pages-title" view

  Scenario: a domain admin is denied the manage view while the superadmin is allowed (parallel DENY+ALLOW)
    Given "admin-domain-a" has a seeded session in their own context
    And "superadmin" has a seeded session in their own context
    When "admin-domain-a" navigates to "/wiki/manage"
    And "superadmin" navigates to "/wiki/manage"
    Then "admin-domain-a" is sent to the wiki forbidden screen
    And "superadmin" sees the "wiki-manage-active-title" view
