# MULTIUSER — the core content pipeline the suite never proved end to end:
# create → view → edit → publish, with an INDEPENDENT superadmin auditor
# confirming the writer's action landed in the audit trail. wiki-authoring.feature
# only checks affordance visibility ("despite the name, no page is ever
# authored"), and the manage scenario only checks the audit region renders — never
# that it CONTAINS the writer's slug. Here a real admin authors real content (the
# BFF renders the markdown, sanitizes it, bumps the version, writes the audit row)
# and a separate real superadmin verifies it — writer acts, auditor independently
# confirms.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser
Feature: Wiki authoring journey — create, edit, publish; a superadmin audits it
  As the wiki platform
  I must render, version and audit a writer's content end to end
  So an independent superadmin can confirm what was authored

  Scenario: an admin authors and publishes a page; a superadmin sees it audited
    Given "admin-domain-a" is logged in in their own context
    And "superadmin" is logged in in their own context
    When "admin-domain-a" starts a new wiki page
    And "admin-domain-a" sets the editor slug to "authoring-journey"
    And "admin-domain-a" sets the editor title to "Authoring journey"
    And "admin-domain-a" writes the seed markdown in the editor body
    And "admin-domain-a" saves the editor
    Then "admin-domain-a" lands on the wiki page view for "authoring-journey"
    And "admin-domain-a" sees the wiki page title "Authoring journey"
    And "admin-domain-a" sees the rendered wiki body containing "reference link"
    And "admin-domain-a" sees the rendered wiki body containing "inline code"
    When "admin-domain-a" opens the editor for the wiki page "authoring-journey"
    And "admin-domain-a" sets the editor title to "Authoring journey (revised)"
    And "admin-domain-a" saves the editor
    Then "admin-domain-a" lands on the wiki page view for "authoring-journey"
    And "admin-domain-a" sees the wiki page title "Authoring journey (revised)"
    When "admin-domain-a" publishes the wiki page
    Then "admin-domain-a" sees the publish message containing "Published version"
    When "superadmin" navigates to "/wiki/manage"
    Then "superadmin" sees the audit trail containing "authoring-journey"
