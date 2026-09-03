import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { WikiService, PageSummary, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

/**
 * The CONTENT view — lists the wiki pages (WikiDto.PageSummary) via
 * GET /bff/wiki/pages. Read-gated (wikiReadGuard: WIKI_READ); the "New page" +
 * per-row "Edit"/"Delete" affordances are shown role-responsively (canWrite =
 * WIKI_WRITE). A MOD+ROLE_WIKI reader sees the list read-only (no New/Edit/Delete).
 *
 * Delete (DELETE /bff/wiki/admin/pages/{slug}) is destructive and cascades to the
 * page's attachments server-side, so it is TWO-STEP here exactly as in the page
 * view: the row's button ARMS an inline confirmation naming the cascade, and only
 * its confirm button calls the bff. The confirmation is inline markup — never a
 * browser modal (a modal in page logic hangs the headless suite). Only ONE row can
 * be armed at a time, so a confirm can never land on a row the operator forgot.
 *
 * The destructive state is keyed on the row's `id`, NOT its slug. `slug` is unique
 * only WITHIN a brand (`UNIQUE(domain, slug)` in the bff's changelog), and this
 * list is cross-brand for a SUPERADMIN (WikiPageRepository#list(null)), so two rows
 * can share a slug. A slug key would arm BOTH of their confirmations and drop BOTH
 * rows on one confirm; `id` is the row identity the trackBy already uses.
 *
 * A completed delete is CONFIRMED by re-reading the list, not assumed: the bff
 * answers 204 even when its DELETE removed no page row (its SUPERADMIN path finds
 * the page cross-brand but scopes the DELETE to `default` —
 * hugmesh-wiki-bff-api issue #15), so a 204 is not
 * evidence the page is gone. If the row is still listed afterwards the operator is
 * told, instead of being shown a success for a page that still exists.
 *
 * a11y: h2 region heading; the list is a labelled role="region"; loading/empty/
 * error states are announced (role="status" / role="alert"); the New page link
 * + each row carry accessibleNames + describedby help; the delete outcome is
 * announced in a role="status" live region.
 */
@Component({
  selector: 'hug-wiki-pages',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './wiki-pages.component.html',
  styleUrl: './wiki-pages.component.scss',
})
export class WikiPagesComponent implements OnInit {
  private readonly wiki = inject(WikiService);
  private readonly session = inject(SessionService);

  readonly pages = signal<PageSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  /** WIKI_WRITE gate: show the "New page" and per-row "Edit"/"Delete" affordances. */
  readonly canWrite = this.session.canWrite;

  /** The page ID whose inline delete confirmation is armed, or null when none is.
   *  Single-valued on purpose: arming one row disarms any other. Keyed on the row
   *  ID, never the slug — a slug is unique only within a brand. */
  readonly confirmingId = signal<string | null>(null);

  /** The page ID with an in-flight DELETE (disables that row's controls). */
  readonly deletingId = signal<string | null>(null);

  /** A delete failure (announced; the list itself stays as it was). */
  readonly actionError = signal('');

  /** A delete success ack (announced; the row is already gone from the list). */
  readonly notice = signal('');

  /**
   * Track-by for the page summary list. Prevents Angular from recreating DOM
   * nodes when the same page appears in a refreshed array.
   *
   * @param _ - Unused list index.
   * @param p - The page summary item.
   * @returns The page's stable string id.
   */
  trackId = (_: number, p: PageSummary): string => p.id;

  /** Load the page list on view init. */
  ngOnInit(): void {
    void this.reload();
  }

  /**
   * Fetch the wiki page summary list.
   * Calls GET /bff/wiki/pages (WIKI_READ gated).
   * Sets `loading` during the request and `error` on failure; surfaces a
   * specific message for a 403 (the BFF denied access server-side).
   */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    this.notice.set('');
    this.confirmingId.set(null);
    try {
      const res = await this.wiki.listPages();
      this.pages.set(res.pages ?? []);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Arm the inline delete confirmation for one row.
   * Guarded on WIKI_WRITE — the control is not rendered for a non-writer, and
   * this keeps a programmatic click honest (the bff @PreAuthorize is the
   * authority either way).
   *
   * @param p - The page summary of the row to confirm deleting; armed by its
   *   `id`, so a same-slug row in another brand is NOT armed with it.
   */
  askDelete(p: PageSummary): void {
    if (!this.canWrite() || this.deletingId()) return;
    this.actionError.set('');
    this.notice.set('');
    this.confirmingId.set(p.id);
  }

  /** Dismiss the inline delete confirmation WITHOUT calling the bff. */
  cancelDelete(): void {
    this.confirmingId.set(null);
  }

  /**
   * Delete one page, once its inline confirmation was accepted.
   * Calls DELETE /bff/wiki/admin/pages/{slug} (WIKI_WRITE gated); the bff
   * cascades to the page's attachments and audits the removal.
   *
   * The delete is then VERIFIED by re-reading the list rather than assumed: the
   * endpoint answers 204 unconditionally, including when it removed no page row
   * (hugmesh-wiki-bff-api WikiService#delete resolves the page cross-brand for a
   * SUPERADMIN but scopes the DELETE to `default`). So the list — not the status
   * code — decides whether this announces a success or a "still listed" warning.
   * If the re-read itself fails, the row we asked to remove is dropped locally and
   * the ack says the list could not be re-checked.
   *
   * On a failed DELETE the list is untouched and the reason is announced (403 =
   * role denied, 404 = already gone).
   *
   * @param p - The page summary of the row to delete.
   */
  async remove(p: PageSummary): Promise<void> {
    if (!this.canWrite() || this.deletingId()) return;
    this.deletingId.set(p.id);
    this.actionError.set('');
    this.notice.set('');
    try {
      await this.wiki.deletePage(p.slug);
    } catch (e) {
      this.actionError.set(this.deleteMessage(e));
      this.deletingId.set(null);
      return;
    }
    try {
      const res = await this.wiki.listPages();
      const pages = res.pages ?? [];
      this.pages.set(pages);
      if (pages.some((row) => row.id === p.id)) {
        this.actionError.set(
          `The server accepted the delete but ${p.slug} is still listed — it may not have been removed.`,
        );
      } else {
        this.notice.set(`Deleted ${p.slug} and its attachments.`);
      }
    } catch {
      // The DELETE itself was accepted; only the confirming re-read failed. Drop
      // the row we asked to remove and say plainly that it is unconfirmed.
      this.pages.update((ps) => ps.filter((row) => row.id !== p.id));
      this.notice.set(`Deleted ${p.slug}. The list could not be re-read to confirm.`);
    } finally {
      this.confirmingId.set(null);
      this.deletingId.set(null);
    }
  }

  /**
   * Map a caught error to a user-friendly message.
   * A {@link WikiApiError}(403) is surfaced explicitly so the user understands
   * it is a permission boundary, not a transient network failure.
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   * @returns A localized error string for the template.
   */
  private message(e: unknown): string {
    if (e instanceof WikiApiError && e.isForbidden) {
      return 'You no longer have permission to read the wiki (the server denied access).';
    }
    return 'Could not load the wiki pages. Please try again.';
  }

  /**
   * Map a caught DELETE failure to a user-friendly message. Wording matches the
   * page view's delete copy so the same denial reads the same in both places.
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   * @returns A localized error string for the template.
   */
  private deleteMessage(e: unknown): string {
    if (e instanceof WikiApiError) {
      if (e.isForbidden) {
        return 'The server denied delete — removing a page requires the ADMIN or SUPERADMIN role.';
      }
      if (e.isNotFound) return 'That wiki page does not exist (it may have been removed).';
    }
    return 'Could not delete the page. Please try again.';
  }
}
