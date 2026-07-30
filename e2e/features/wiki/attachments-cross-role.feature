# MULTIUSER — the per-page attachments panel (upload/list/download/delete, PR #20)
# has zero e2e; no feature references any wiki-att-* testid. The read-tier download
# by a MOD reader of a writer's upload is a genuine two-user data handoff, and the
# disabled+helptext contract for a non-writer is a platform rule worth pinning in
# the DOM. Here an admin really uploads (multipart), a same-domain granted MOD
# reader lists + downloads it (a real browser download event with the right
# filename) while their upload/delete controls are disabled with the role help, and
# the admin's delete empties the panel on the reader's reload.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @wiki-ui @multiuser @cross-user
Feature: Wiki attachments cross-role — a writer uploads, a reader downloads, a non-writer is blocked
  As the wiki platform
  I must let any reader download a page's attachments
  While only a writer may upload or delete them

  Scenario: an admin uploads; a MOD reader downloads; the non-writer controls are disabled
    Given "admin-domain-a" is logged in in their own context
    And "mod-wiki" is logged in in their own context
    And "admin-domain-a" authors the wiki page "attach-demo" via the API
    When "admin-domain-a" opens the wiki page "attach-demo"
    And "admin-domain-a" uploads an attachment "diagram.png" to the current page
    And "mod-wiki" opens the wiki page "attach-demo"
    Then "mod-wiki" sees the attachment "diagram.png" in the list
    And "mod-wiki" downloads the attachment "diagram.png"
    And "mod-wiki"'s attachment write controls are disabled with role help
    When "admin-domain-a" deletes the attachment "diagram.png" from the current page
    Then "mod-wiki" sees no attachments after reloading the wiki page "attach-demo"
