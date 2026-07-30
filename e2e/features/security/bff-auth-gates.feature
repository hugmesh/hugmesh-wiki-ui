# SECURITY — the wiki-bff is the authoritative gate; the UI is defence-in-depth.
# These scenarios assert the BFF rejects unauthenticated callers and re-enforces
# the role boundary independently of the client guards, so bypassing the UI
# changes nothing.
#
# HONESTY (why this differs from an earlier revision): the role-403 scenarios now
# use REAL Casdoor logins — a seeded localStorage session never obtains the
# HttpOnly bff_ cookie, so an authenticated fetch would return 401, not the
# asserted 403, and the role-specific assertions could never hold live. And the
# probes hit REAL routes with REAL verbs: there is no GET /bff/wiki/admin/access
# (admin access is POST grant/timeout/ban + DELETE revoke), so the MOD read-only
# check is a POST to /bff/wiki/admin/access/grant. The anonymous 401 trio probes
# three real GET surfaces (content, superadmin access, superadmin audit).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @cross-user @security
Feature: Wiki BFF auth gates — the server re-enforces every wiki role boundary
  As the wiki platform
  I must reject unauthenticated and under-privileged calls at the BFF
  So the client guards are never the only line of defence

  Scenario: an unauthenticated client is rejected by the wiki content surface (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/wiki/pages"
    Then the response status is 401

  Scenario: an unauthenticated client is rejected by the superadmin access surface (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/wiki/superadmin/access"
    Then the response status is 401

  Scenario: an unauthenticated client is rejected by the wiki superadmin audit surface (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/wiki/superadmin/audit"
    Then the response status is 401

  Scenario: a plain user is rejected by the wiki content read API (403)
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/wiki/pages"
    Then the response status is 403

  Scenario: a granted MOD reader is rejected by the wiki write API (403 — read-only)
    Given "mod-wiki" is logged in
    When "mod-wiki" attempts to grant wiki access via the API
    Then the response status is 403

  Scenario: a domain admin is rejected by the wiki superadmin access API (403)
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/wiki/superadmin/access"
    Then the response status is 403
