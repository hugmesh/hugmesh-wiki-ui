# hugmesh-wiki-ui#4 — the platform MFA step-up reaching this remote. The wiki BFF
# gates its privileged paths with D8 step-up (hugmesh-wiki-bff-api commit 15ccef0,
# 2026-09-09; SecurityConfig on origin/main 64e5f44):
#   /bff/wiki/superadmin/**  stepUp(hasRole('SUPERADMIN'))          (WIKI_MANAGE)
#   /bff/wiki/admin/**       stepUp(hasAnyRole('ADMIN','SUPERADMIN')) (WIKI_WRITE)
# stepUp(base) = base AND MFA_SATISFIED while app.mfa.enabled=true, and is `base`
# unchanged while it is false (the org default).
#
# THE SIGNAL (hugmesh-wiki-bff-api#35, merged as PR #38): wiki-bff installs an
# access-denied handler (WikiStepUpAccessDeniedHandler) that renders the step-up
# refusal as 403 + `X-Step-Up-Required: X-Wiki-StepUp` + a body carrying the legacy
# `requires step-up` phrase, and only for the case where the role rule granted and
# the MFA_SATISFIED leg denied. Every other denial keeps Spring's own response. The
# consumer in this repo (src/app/step-up.ts, wiki-step-up.component.ts, mounted by
# the manage view) reads exactly that.
#
# So:
#   - the ROLE rows run on any stack: a caller refused by the role half never
#     carries a step-up signal (it must not, or the consumer would offer a challenge
#     that can never let them through);
#   - the ARMED rows need a stack with app.mfa.enabled=true on wiki-bff-api. The
#     second one asserts the refusal names its flavour in `X-Step-Up-Required`,
#     matching the platform detector's rule `^X-[A-Za-z0-9-]{1,60}-StepUp$`
#     (mod-ui mfa/step-up-error.ts, forum-ui step-up.ts). The header VALUE is
#     deliberately not pinned here; the unit spec step-up.spec.ts pins what this
#     remote accepts.
# Neither armed row has been executed against a live stack by the change that
# removed the `@fixme` tag: that needs an armed mesh, and whether the gateway
# forwards the header is not observed anywhere yet.
# Armed rows skip loudly unless MFA_STEPUP_ARMED=1 (the variable the forum-ui and
# mod-ui armed lanes use, so one armed stack serves all three).
#
# @cluster: real Casdoor logins — only the real login mints the bff_ cookie.
@cluster @wiki-ui @security @issue:wiki-ui-4
Feature: The wiki BFF's step-up refusals are recognisable on the wire
  As a wiki remote that must offer the platform MFA step-up
  I need the wiki BFF to tell a step-up refusal apart from a role refusal
  So a privileged editor is offered the check and nobody else ever is

  Scenario: a domain admin's superadmin-surface read is a role refusal that carries no step-up signal
    Given "admin-domain-a" is logged in
    When "admin-domain-a" GETs "/bff/wiki/superadmin/audit" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: a plain user's superadmin-surface read is a role refusal that carries no step-up signal
    Given "plain-user" is logged in
    When "plain-user" GETs "/bff/wiki/superadmin/audit" capturing the step-up signal
    Then the captured response was a 403 without any step-up signal

  Scenario: with the gate armed, a superadmin without a fresh MFA stamp is refused the audit trail
    Given the platform MFA step-up gate is armed on this stack
    And "superadmin" is logged in
    When "superadmin" GETs "/bff/wiki/superadmin/audit" capturing the step-up signal
    Then the captured response status was 403

  @issue:wiki-bff-api-35
  Scenario: with the gate armed, a superadmin's refusal names its step-up flavour
    Given the platform MFA step-up gate is armed on this stack
    And "superadmin" is logged in
    When "superadmin" GETs "/bff/wiki/superadmin/audit" capturing the step-up signal
    Then the captured response was a 403 carrying a conforming step-up signal
