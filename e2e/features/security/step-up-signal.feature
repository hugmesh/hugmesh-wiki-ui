# hugmesh-wiki-ui#4 — the platform MFA step-up reaching this remote. The wiki BFF
# gates its privileged paths with D8 step-up (hugmesh-wiki-bff-api commit 15ccef0,
# 2026-09-09; SecurityConfig on origin/main 64e5f44):
#   /bff/wiki/superadmin/**  stepUp(hasRole('SUPERADMIN'))          (WIKI_MANAGE)
#   /bff/wiki/admin/**       stepUp(hasAnyRole('ADMIN','SUPERADMIN')) (WIKI_WRITE)
# stepUp(base) = base AND MFA_SATISFIED while app.mfa.enabled=true, and is `base`
# unchanged while it is false (the org default).
#
# THE GAP (re-checked 2026-09-23): unlike hugmesh-mod-bff-api (X-Mod-StepUp) and
# hugmesh-forum-bff-api (X-Forum-StepUp), wiki-bff installs no access-denied handler
# and emits no `X-Step-Up-Required` header, so an ARMED step-up refusal is
# byte-identical to a plain role 403. Issue #4's 2026-09-18 comment names exactly
# this as the blocker for the decision-21/35 consumer here: "a structured step-up
# signal from the BFF … the same class of gap applies here". No consumer can tell
# WHEN to mount the federated dialog until it lands. The server half is filed as
# hugmesh-wiki-bff-api#35 (2026-09-23), which the `@fixme` row also carries.
#
# So:
#   - the ROLE rows run on any stack today: a caller refused by the role half never
#     carries a step-up signal (it must not, or the consumer would offer a challenge
#     that can never let them through);
#   - the ARMED row with `@fixme` asserts the CORRECT behaviour: the refusal names
#     its flavour in `X-Step-Up-Required`, matching the platform detector's rule
#     `^X-[A-Za-z0-9-]{1,60}-StepUp$` (mod-ui mfa/step-up-error.ts, forum-ui
#     step-up.ts). It turns green, unmodified, the day wiki-bff emits any
#     conforming signal — the header VALUE is deliberately not pinned, because
#     wiki-bff has not chosen one;
#   - the ARMED row without `@fixme` pins what an armed gate already does (403).
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

  @fixme @issue:wiki-bff-api-35
  Scenario: with the gate armed, a superadmin's refusal names its step-up flavour
    Given the platform MFA step-up gate is armed on this stack
    And "superadmin" is logged in
    When "superadmin" GETs "/bff/wiki/superadmin/audit" capturing the step-up signal
    Then the captured response was a 403 carrying a conforming step-up signal
