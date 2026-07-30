import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import {
  WikiService,
  WikiPage,
  WikiApiError,
  SLUG_PATTERN,
} from './wiki.service';
import { renderMarkdown } from './markdown';

/**
 * The wiki EDITOR — create (route 'new', no slug) and edit (route
 * 'pages/:slug/edit'). Write-gated (wikiWriteGuard: WIKI_WRITE = ADMIN|SUPERADMIN);
 * a MOD reader can never reach it (the guard sends them to /forbidden), and the
 * page VIEW shows them no Edit control.
 *
 *   create → POST /bff/wiki/admin/pages   (WikiDto.CreatePage; the bff renders
 *            markdown→HTML and stamps author+domain from the JWT). A duplicate
 *            slug returns 409, surfaced as a specific inline error.
 *   edit   → PUT  /bff/wiki/admin/pages/{slug} (WikiDto.UpdatePage with
 *            expectedVersion). A stale expectedVersion (a concurrent overwrite)
 *            returns 409, surfaced as a "someone else edited this" message with
 *            a reload affordance.
 *
 * a11y: every field has a <label> + an aria-describedby help hint (sighted +
 * screen-reader); invalid required fields set aria-invalid + announce in a
 * role="alert" live region; the live markdown preview is a labelled region; the
 * submit error/success is announced. Full keyboard operation.
 */
@Component({
  selector: 'hug-wiki-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './wiki-editor.component.html',
  styleUrl: './wiki-editor.component.scss',
})
export class WikiEditorComponent implements OnInit {
  private readonly wiki = inject(WikiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  /** null = create mode; a slug = edit mode. */
  readonly editingSlug = signal<string | null>(null);
  readonly slug = signal('');
  readonly title = signal('');
  readonly body = signal('');
  readonly expectedVersion = signal(0);

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly conflict = signal(false);
  readonly touched = signal(false);

  readonly isEdit = computed(() => this.editingSlug() !== null);

  /**
   * Determine the editor mode from the route:
   * - `pages/:slug/edit` → edit mode: sets `editingSlug` and pre-loads the page.
   * - `new`              → create mode: clears `editingSlug`.
   */
  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const s = p.get('slug');
      if (s) {
        this.editingSlug.set(s);
        void this.loadExisting(s);
      } else {
        // Create mode: no slug in the route.
        this.editingSlug.set(null);
      }
    });
  }

  /**
   * Pre-populate the editor form with the current page content for edit mode.
   * Calls GET /bff/wiki/pages/{slug} and reads `expectedVersion` for the
   * optimistic-concurrency 409 guard on submit.
   * Sets `error` on 403 or network failure.
   *
   * @param slug - The slug of the page to load for editing.
   */
  private async loadExisting(slug: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const pg: WikiPage = await this.wiki.getPage(slug);
      this.slug.set(pg.slug);
      this.title.set(pg.title);
      this.body.set(pg.contentMarkdown);
      // Record the version the BFF holds so PUT can include it for concurrency detection.
      this.expectedVersion.set(pg.version);
    } catch (e) {
      this.error.set(
        e instanceof WikiApiError && e.isForbidden
          ? 'The server denied access to this page for editing.'
          : 'Could not load the page for editing. Please try again.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Live DOMPurify-sanitized Markdown preview of the body draft.
   * The BFF re-renders via its own MarkdownRenderer on submit — this is a
   * visual convenience only.
   *
   * @returns A {@link SafeHtml} value for `[innerHTML]` binding.
   */
  previewHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(this.body()));
  }

  // ── validation (mirrors the bff WikiDto constraints) ──

  /**
   * Whether the slug field should show its `aria-invalid` indicator.
   * Slug is immutable in edit mode (the field is read-only there).
   *
   * @returns `true` when touched, in create mode, and the slug is blank or
   *   does not match {@link SLUG_PATTERN}.
   */
  slugInvalid(): boolean {
    if (this.isEdit()) return false; // slug is immutable on edit
    const v = this.slug().trim();
    return this.touched() && (v.length === 0 || !SLUG_PATTERN.test(v));
  }

  /** @returns `true` when touched and the title field is blank. */
  titleInvalid(): boolean {
    return this.touched() && this.title().trim().length === 0;
  }

  /** @returns `true` when touched and the body field is blank. */
  bodyInvalid(): boolean {
    return this.touched() && this.body().trim().length === 0;
  }

  /**
   * Whether the form is valid and may be submitted.
   * In create mode: slug must be non-empty and match {@link SLUG_PATTERN}.
   * In edit mode: only title and body are required (slug is already on the server).
   *
   * @returns `true` when all required constraints are satisfied.
   */
  formValid(): boolean {
    const slugOk = this.isEdit() || (this.slug().trim().length > 0 && SLUG_PATTERN.test(this.slug().trim()));
    return slugOk && this.title().trim().length > 0 && this.body().trim().length > 0;
  }

  /**
   * Submit the editor form.
   * - Create mode: POST /bff/wiki/admin/pages → navigates to the new page.
   * - Edit mode:   PUT  /bff/wiki/admin/pages/{slug} (with `expectedVersion`)
   *   → navigates to the updated page on success, or surfaces a conflict/403.
   */
  async submit(): Promise<void> {
    // Mark touched so validation hints become visible before any network call.
    this.touched.set(true);
    this.conflict.set(false);
    this.error.set('');
    this.notice.set('');
    if (!this.formValid()) return;
    this.busy.set(true);
    try {
      if (this.isEdit()) {
        const slug = this.editingSlug()!;
        const pg = await this.wiki.updatePage(slug, {
          title: this.title().trim(),
          contentMarkdown: this.body(),
          // Pass the version we loaded so the BFF can detect a concurrent overwrite (409).
          expectedVersion: this.expectedVersion(),
        });
        void this.router.navigate(['../../', pg.slug], { relativeTo: this.route });
      } else {
        const pg = await this.wiki.createPage({
          slug: this.slug().trim(),
          title: this.title().trim(),
          contentMarkdown: this.body(),
        });
        void this.router.navigate(['../pages', pg.slug], { relativeTo: this.route });
      }
    } catch (e) {
      this.handleError(e);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Map a submit failure to the right in-form error state.
   * - 409 in edit mode → stale-edit conflict: sets `conflict` + a reload hint.
   * - 409 in create mode → duplicate slug: prompts for a different slug.
   * - 403 → permission boundary: server denied authoring.
   * - Other → generic save failure.
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   */
  private handleError(e: unknown): void {
    if (e instanceof WikiApiError) {
      if (e.isConflict) {
        this.conflict.set(true);
        this.error.set(
          this.isEdit()
            ? 'This page was changed by someone else since you opened it. Reload to get the latest version, then re-apply your edits.'
            : 'A page with that slug already exists. Choose a different slug.',
        );
        return;
      }
      if (e.isForbidden) {
        this.error.set('The server denied this action — your role does not permit authoring.');
        return;
      }
    }
    this.error.set('Could not save the page. Please try again.');
  }

  /**
   * Recover from a stale-edit 409 conflict: fetch the latest page version and
   * update `expectedVersion`. Keeps the user's body draft intact so they can
   * re-apply their edits against the refreshed baseline.
   * Calls GET /bff/wiki/pages/{slug}.
   */
  async reloadLatest(): Promise<void> {
    const slug = this.editingSlug();
    if (!slug) return;
    try {
      const pg = await this.wiki.getPage(slug);
      this.expectedVersion.set(pg.version);
      this.conflict.set(false);
      this.error.set('');
      this.notice.set(`Reloaded to version ${pg.version}. Re-apply your edits and save again.`);
    } catch {
      this.error.set('Could not reload the latest version. Please try again.');
    }
  }
}
