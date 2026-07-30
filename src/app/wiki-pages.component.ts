import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { WikiService, PageSummary, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

/**
 * The CONTENT view — lists the wiki pages (WikiDto.PageSummary) via
 * GET /bff/wiki/pages. Read-gated (wikiReadGuard: WIKI_READ); the "New page" +
 * per-row "Edit" affordances are shown role-responsively (canWrite =
 * WIKI_WRITE). A MOD+ROLE_WIKI reader sees the list read-only (no New/Edit).
 *
 * a11y: h2 region heading; the list is a labelled role="region"; loading/empty/
 * error states are announced (role="status" / role="alert"); the New page link
 * + each row carry accessibleNames + describedby help.
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

  /** WIKI_WRITE gate: show the "New page" and per-row "Edit" affordances. */
  readonly canWrite = this.session.canWrite;

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
}
