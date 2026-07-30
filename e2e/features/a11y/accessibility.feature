# Accessibility coverage — the org a11y standard the wiki-ui carries: a skip link
# that moves focus to the main region, a named ARIA menubar landmark with
# per-item accessible names + help, a roving tabindex along the menu, labelled
# editor fields, and focus restoration after a route change.
#
# Markup under test (wiki-ui src):
#   app.component.html          — `<a class="skip" href="#wiki-main">` + `<main
#                                 id="wiki-main" tabindex="-1">`.
#   wiki-console.component.html — `<nav role="menubar" aria-label="Wiki console"
#                                 aria-describedby="wiki-console-help">` with
#                                 roving-tabindex `role="menuitem"` links +
#                                 per-item aria-label + aria-describedby help.
#   wiki-editor.component.html  — `<label for>` + aria-describedby help on every
#                                 field; `role="region" aria-label="Content
#                                 preview"`.
#   wiki-manage.component.html  — `role="region" aria-labelledby=...` sections.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @a11y
Feature: wiki-ui accessibility — skip link, named menubar, roving tabindex, focus restore
  As a keyboard / assistive-tech operator
  I want the wiki console to honour the org a11y standard
  So I can reach and operate every surface without a mouse

  Scenario: the skip link is the first tab stop and moves focus to main
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/pages"
    Then "admin-domain-a" can tab to the skip link
    And activating the skip link moves focus to the main region

  Scenario: the wiki menubar is a named landmark with described items
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/pages"
    Then the wiki menubar has an accessible name
    And each wiki nav item has an accessible name and help

  Scenario: the menubar uses a roving tabindex
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/pages"
    Then only one wiki nav item is in the tab order

  Scenario: arrow keys rove focus along the wiki nav items
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/pages"
    And "superadmin" focuses the first wiki nav item
    Then arrow-key navigation moves focus along the wiki nav items

  Scenario: the editor fields are labelled and described
    Given "admin-domain-a" has a seeded session
    When "admin-domain-a" navigates to "/wiki/new"
    Then every wiki editor field is labelled

  Scenario: the management sections are named regions
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/manage"
    Then the "section.wiki-manage__section" region has an accessible name

  Scenario: focus returns to the main region after a guarded navigation
    Given "superadmin" has a seeded session
    When "superadmin" navigates to "/wiki/manage"
    Then "superadmin" sees the "wiki-manage-active-title" view
    And focus is restored to the main region after navigation
