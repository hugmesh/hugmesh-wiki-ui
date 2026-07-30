# MULTIUSER-SITUATIONAL coverage — an admin (writer) authoring content and
# running the access console over THEIR OWN domain, while a granted MOD reader
# of the same domain sees the published content but none of the write surface.
# Two identities coexist in one scenario (each in its own context) so the
# author/reader split is asserted with both users live, not by swapping a single
# session.
#
# The access console (wiki-access.component) is itself a multiuser surface: an
# admin acts ON ANOTHER user's subject (grant / timeout / ban / restore), and the
# copy states the change is "domain-scoped to your brand and recorded for audit".
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser-situational
Feature: Wiki authoring & access — an admin writes; a same-domain reader consumes
  As the wiki platform
  I must let a domain writer author content + control access for their brand
  While a same-domain reader sees only the read surface

  Scenario: a domain writer and a same-domain reader split write vs read
    Given "admin-domain-a" has a seeded session in their own context
    And "mod-wiki" has a seeded session in their own context
    When "admin-domain-a" navigates to "/wiki/pages"
    And "mod-wiki" navigates to "/wiki/pages"
    Then "admin-domain-a" sees the "wiki-new-page" affordance
    And "mod-wiki" does not see the "wiki-new-page" affordance

  Scenario: the access console exposes the grant/timeout/ban actions to a writer
    Given "admin-domain-a" has a seeded session in their own context
    And "mod-wiki" has a seeded session in their own context
    When "admin-domain-a" navigates to "/wiki/access"
    And "mod-wiki" navigates to "/wiki/access"
    Then "admin-domain-a" sees the "wiki-access-action-grant" affordance
    And "admin-domain-a" sees the "wiki-access-action-timeout" affordance
    And "admin-domain-a" sees the "wiki-access-action-ban" affordance
    And "admin-domain-a" sees help text "wiki-access-user-help"
    And "mod-wiki" is sent to the wiki forbidden screen

  Scenario: only the superadmin can audit what the domain writer changed
    Given "admin-domain-a" has a seeded session in their own context
    And "superadmin" has a seeded session in their own context
    When "admin-domain-a" navigates to "/wiki/manage"
    And "superadmin" navigates to "/wiki/manage"
    Then "admin-domain-a" is sent to the wiki forbidden screen
    And "superadmin" sees the "wiki-manage-audit-title" view
