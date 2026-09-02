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

  /** The slug whose inline delete confirmation is armed, or null when none is.
   *  Single-valued on purpose: arming one row disarms any other. */
  readonly confirmingSlug = signal<string | null>(null);

  /** The slug with an in-flight DELETE (disables that row's controls). */
  readonly deletingSlug = signal<string | null>(null);

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
    this.confirmingSlug.set(null);
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
   * @param slug - The slug of the page to confirm deleting.
   */
  askDelete(slug: string): void {
    if (!this.canWrite() || this.deletingSlug()) return;
    this.actionError.set('');
    this.notice.set('');
    this.confirmingSlug.set(slug);
  }

  /** Dismiss the inline delete confirmation WITHOUT calling the bff. */
  cancelDelete(): void {
    this.confirmingSlug.set(null);
  }

  /**
   * Delete one page, once its inline confirmation was accepted.
   * Calls DELETE /bff/wiki/admin/pages/{slug} (WIKI_WRITE gated); the bff
   * cascades to the page's attachments and audits the removal.
   * On success the row is dropped from the list in place — no re-read, since the
   * server already told us the only row that changed.
   * On failure the list is untouched and the reason is announced (403 = role
   * denied, 404 = already gone).
   *
   * @param slug - The slug of the page to delete.
   */
  async remove(slug: string): Promise<void> {
    if (!this.canWrite() || this.deletingSlug()) return;
    this.deletingSlug.set(slug);
    this.actionError.set('');
    this.notice.set('');
    try {
      await this.wiki.deletePage(slug);
      this.pages.update((ps) => ps.filter((p) => p.slug !== slug));
      this.confirmingSlug.set(null);
      this.notice.set(`Deleted ${slug} and its attachments.`);
    } catch (e) {
      this.actionError.set(this.deleteMessage(e));
    } finally {
      this.deletingSlug.set(null);
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
