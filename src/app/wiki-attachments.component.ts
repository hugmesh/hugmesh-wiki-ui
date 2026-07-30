import { Component, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { WikiService, WikiAttachment, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

/**
 * The per-page ATTACHMENTS panel — the UI over hugmesh-wiki-bff-api's
 * WikiAttachmentController (/bff/wiki/.../attachments, wiki_attachment table).
 * Embedded by {@link WikiPageViewComponent} below the rendered page body.
 *
 * Role gating mirrors the bff EXACTLY (the server @PreAuthorize is the
 * AUTHORITATIVE gate; this is defence-in-depth presentation):
 *   list / download — authenticated read (the same WikiAccessGuard overlay as
 *                     pages; the view is already wikiReadGuard-gated), so every
 *                     reader who can see the page can list + download;
 *   upload / delete — WIKI_WRITE (ADMIN | SUPERADMIN).
 *
 * For a non-writer the upload/delete controls are rendered VISIBLY DISABLED
 * (aria-disabled, tab-reachable so AT reaches the explanation) with helptext
 * naming the required role — the platform disabled+helptext rule; nothing is
 * silently hidden and nothing fakes capability. A 403 the server returns
 * anyway (role drift) is surfaced truthfully in a role="alert".
 *
 * a11y: the panel is a labelled section; each control carries an aria-label
 * with the filename; results are announced via role="status"/"alert".
 */
@Component({
  selector: 'hug-wiki-attachments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wiki-attachments.component.html',
  styleUrl: './wiki-attachments.component.scss',
})
export class WikiAttachmentsComponent {
  private readonly wiki = inject(WikiService);
  private readonly session = inject(SessionService);

  /** The page the attachments belong to (route param, passed by the page view). */
  readonly slug = input.required<string>();

  readonly attachments = signal<WikiAttachment[]>([]);
  readonly loading = signal(true);
  /** A list-load failure (the panel body is replaced by this alert). */
  readonly loadError = signal('');
  /** An upload/delete/download failure (announced; the list stays). */
  readonly actionError = signal('');
  readonly notice = signal('');
  readonly uploading = signal(false);
  /** The filename with an in-flight download/delete (disables that row's controls). */
  readonly busyFile = signal('');
  /** The file picked in the upload input (null until chosen). */
  readonly file = signal<File | null>(null);

  /** WIKI_WRITE = ADMIN | SUPERADMIN — the upload/delete gate (mirrors the bff). */
  readonly canWrite = this.session.canWrite;

  constructor() {
    // Reload whenever the page slug changes (the page view stays mounted across
    // /pages/:slug param-only navigations, and so does this panel).
    effect(() => {
      const slug = this.slug();
      void this.reload(slug);
    });
  }

  async reload(slug: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    this.notice.set('');
    this.actionError.set('');
    try {
      const list = await this.wiki.listAttachments(slug);
      this.attachments.set(list.attachments ?? []);
    } catch (e) {
      this.attachments.set([]);
      this.loadError.set(this.message(e, 'list'));
    } finally {
      this.loading.set(false);
    }
  }

  onFileChange(event: Event): void {
    const el = event.target as HTMLInputElement;
    this.file.set(el.files?.[0] ?? null);
  }

  /** Upload the picked file. Guarded on WIKI_WRITE (the control is disabled for
   *  a non-writer; this guard keeps a programmatic click honest too). */
  async upload(fileInput: HTMLInputElement): Promise<void> {
    if (!this.canWrite() || this.uploading()) return;
    this.actionError.set('');
    this.notice.set('');
    const file = this.file();
    if (!file) {
      this.actionError.set('Choose a file to upload first.');
      return;
    }
    this.uploading.set(true);
    try {
      const saved = await this.wiki.uploadAttachment(this.slug(), file);
      this.notice.set(`Uploaded ${saved.filename}.`);
      this.file.set(null);
      fileInput.value = '';
      await this.refreshList();
    } catch (e) {
      this.actionError.set(this.message(e, 'upload'));
    } finally {
      this.uploading.set(false);
    }
  }

  /** Delete an attachment by filename. Guarded on WIKI_WRITE (see upload). */
  async remove(filename: string): Promise<void> {
    if (!this.canWrite() || this.busyFile()) return;
    this.actionError.set('');
    this.notice.set('');
    this.busyFile.set(filename);
    try {
      await this.wiki.deleteAttachment(this.slug(), filename);
      this.notice.set(`Deleted ${filename}.`);
      await this.refreshList();
    } catch (e) {
      this.actionError.set(this.message(e, 'delete'));
    } finally {
      this.busyFile.set('');
    }
  }

  /** Fetch the bytes through the bff (the HttpOnly bff_ cookie rides the
   *  request) and hand them to the browser as a file save. */
  async download(att: WikiAttachment): Promise<void> {
    if (this.busyFile()) return;
    this.actionError.set('');
    this.notice.set('');
    this.busyFile.set(att.filename);
    try {
      const blob = await this.wiki.downloadAttachment(this.slug(), att.filename);
      this.saveBlob(blob, att.filename);
    } catch (e) {
      this.actionError.set(this.message(e, 'download'));
    } finally {
      this.busyFile.set('');
    }
  }

  /** Re-fetch the list after a successful mutation WITHOUT clearing the
   *  success notice the mutation just set (reload() resets all messaging). */
  private async refreshList(): Promise<void> {
    try {
      const list = await this.wiki.listAttachments(this.slug());
      this.attachments.set(list.attachments ?? []);
    } catch {
      // The mutation succeeded; a refresh failure must not mask that. Say so.
      this.actionError.set('The change was applied, but the attachment list could not be refreshed.');
    }
  }

  /** The standard client-side save: a transient object-URL download anchor. */
  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private message(e: unknown, action: 'list' | 'upload' | 'delete' | 'download'): string {
    if (e instanceof WikiApiError) {
      if (e.isForbidden) {
        return action === 'upload' || action === 'delete'
          ? 'The server denied this action — uploading or deleting attachments requires the ADMIN or SUPERADMIN role.'
          : 'The server denied access to this page’s attachments.';
      }
      if (e.isNotFound) {
        return action === 'list'
          ? 'That wiki page does not exist (it may have been removed).'
          : 'That attachment no longer exists (it may have been deleted).';
      }
    }
    switch (action) {
      case 'upload': return 'Could not upload the attachment. Please try again.';
      case 'delete': return 'Could not delete the attachment. Please try again.';
      case 'download': return 'Could not download the attachment. Please try again.';
      default: return 'Could not load the attachments. Please try again.';
    }
  }
}
