# CROSS-USER / MULTITENANT KEYSTONE — real CONTENT isolation, victim-creates-first
# with a real POST (not a GET probe against a route that does not exist). The old
# cross-domain feature never created anything in domain A and probed a `?domain=`
# query param absent from openapi.json, so a live run proved nothing about tenant
# isolation of content. Here a domain-A admin really AUTHORS a page (victim creates
# first), then a domain-B admin — with their own live session — must not see it in
# their (domain-scoped) list and must not be able to read it: the boundary the BFF
# derives from the validated JWT issuer, fail-closed.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @cross-user
Feature: Cross-domain content isolation — a brand's pages are invisible to another brand
  As the multi-tenant wiki platform
  I must scope every page to the authoring brand
  So a domain-B admin can neither list nor read domain-A content

  Scenario: a domain-A page is invisible and unreadable to a domain-B admin
    Given "admin-domain-a" is logged in in their own context
    And "admin-domain-b" is logged in in their own context
    When "admin-domain-a" authors the wiki page "a-secret" via the API
    Then "admin-domain-a" sees the page "a-secret" in the wiki list
    And "admin-domain-b" does not see the page "a-secret" in the wiki list
    When "admin-domain-b" GETs "/bff/wiki/pages/a-secret"
    Then the response status is one of 403 or 404
