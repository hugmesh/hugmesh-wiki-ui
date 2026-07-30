import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { WikiService, WikiPage, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';
import { sanitizeContentHtml } from './markdown';
import { WikiAttachmentsComponent } from './wiki-attachments.component';

/**
 * The page VIEW — GET /bff/wiki/pages/{slug} → WikiDto.Page; renders the
 * bff-rendered content_html (re-sanitized at the browser boundary, defence-in-
 * depth). Read-gated (wikiReadGuard: WIKI_READ). The Edit + Publish controls are
 * shown role-responsively (canWrite = WIKI_WRITE); a MOD reader sees neither.
 *
 * a11y: the page title is the h2; the rendered body is a labelled region; the
 * Publish action announces its result in a role="status" live region and a 403
 * (the bff @PreAuthorize denial) is surfaced in a role="alert".
 */
@Component({
  selector: 'hug-wiki-page-view',
  standalone: true,
  imports: [CommonModule, RouterLink, WikiAttachmentsComponent],
  templateUrl: './wiki-page-view.component.html',
  styleUrl: './wiki-page-view.component.scss',
})
export class WikiPageViewComponent implements OnInit {
  private readonly wiki = inject(WikiService);
  private readonly session = inject(SessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  readonly slug = signal('');
  readonly page = signal<WikiPage | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly publishing = signal(false);
  readonly publishMsg = signal('');

  /** WIKI_WRITE gate: show the Edit and Publish controls. */
  readonly canWrite = this.session.canWrite;

  /**
   * Subscribe to the `:slug` route param and reload the page on navigation.
   * Handles in-app navigation between wiki pages without a full route change.
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.slug.set(p.get('slug') ?? '');
      void this.reload();
    });
  }

  /**
   * The BFF-rendered `contentHtml`, re-sanitized at the browser boundary with
   * DOMPurify (defence-in-depth) before being trusted for `[innerHTML]` binding.
   * The allow-list is a superset of the editor preview (the BFF renderer may
   * emit richer structure such as tables and headings).
   *
   * @returns A {@link SafeHtml} value safe for `[innerHTML]`.
   */
  bodyHtml(): SafeHtml {
    const html = sanitizeContentHtml(this.page()?.contentHtml ?? '');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /**
   * Fetch the wiki page by slug.
   * Calls GET /bff/wiki/pages/{slug} (WIKI_READ gated).
   * Resets the publish message on each reload so stale success banners clear.
   * Sets `error` on failure with action-specific wording.
   */
  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.publishMsg.set('');
    try {
      this.page.set(await this.wiki.getPage(this.slug()));
    } catch (e) {
      this.page.set(null);
      this.error.set(this.message(e, 'load'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Trigger a publish action for the current page.
   * Calls POST /bff/wiki/admin/pages/{slug}/publish (WIKI_WRITE gated).
   * On success: sets `publishMsg` with the new version number so the ZIM
   * rebuild note is visible. On failure: sets `error` with a specific message
   * for 403 (role denied) vs. generic network error.
   */
  async publish(): Promise<void> {
    if (!this.canWrite() || !this.page()) return;
    this.publishing.set(true);
    this.publishMsg.set('');
    this.error.set('');
    try {
      const res = await this.wiki.publishPage(this.slug());
      this.publishMsg.set(`Published version ${res.version}. The next ZIM rebuild will package it.`);
    } catch (e) {
      this.error.set(this.message(e, 'publish'));
    } finally {
      this.publishing.set(false);
    }
  }

  /**
   * Map a caught error to a user-friendly message, branching on the HTTP
   * status from the BFF and the action that failed.
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   * @param action - `'load'` or `'publish'`, used to pick the right copy.
   * @returns A localized error string for the template.
   */
  private message(e: unknown, action: 'load' | 'publish'): string {
    if (e instanceof WikiApiError) {
      if (e.isForbidden) {
        return action === 'publish'
          ? 'The server denied publish — your role does not permit authoring this page.'
          : 'You no longer have permission to read this page (the server denied access).';
      }
      if (e.isNotFound) return 'That wiki page does not exist (it may have been removed).';
    }
    return action === 'publish'
      ? 'Could not publish the page. Please try again.'
      : 'Could not load the page. Please try again.';
  }
}
