import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { WikiService, WikiAccess, WikiApiError } from './wiki.service';

/**
 * The MANAGE view — the superadmin-only surface over /bff/wiki/superadmin/**
 * (WikiAccessController list/history + WikiController audit). Manage-gated
 * (wikiManageGuard: WIKI_MANAGE = SUPERADMIN); an ADMIN or MOD never reaches it.
 *
 *   active list → GET /bff/wiki/superadmin/access
 *   history     → GET /bff/wiki/superadmin/access/{user}/history
 *   audit trail → GET /bff/wiki/superadmin/audit
 *
 * a11y: each section is a labelled region; the tables are real <table> with
 * scope'd headers + captions; the history lookup form has labelled controls +
 * describedby help; loading/empty/error states are announced.
 */
@Component({
  selector: 'hug-wiki-manage',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './wiki-manage.component.html',
  styleUrl: './wiki-manage.component.scss',
})
export class WikiManageComponent implements OnInit {
  private readonly wiki = inject(WikiService);

  readonly active = signal<WikiAccess[]>([]);
  readonly activeLoading = signal(true);
  readonly activeError = signal('');

  readonly historyUser = signal('');
  readonly history = signal<WikiAccess[] | null>(null);
  readonly historyLoading = signal(false);
  readonly historyError = signal('');

  readonly audit = signal<Array<Record<string, unknown>>>([]);
  readonly auditLoading = signal(true);
  readonly auditError = signal('');

  /**
   * Track-by for the active-access and history tables.
   *
   * @param _ - Unused list index.
   * @param a - The access row.
   * @returns The row's stable string id.
   */
  trackAccessId = (_: number, a: WikiAccess): string => a.id;

  /** Load the active overrides and audit trail in parallel on view init. */
  ngOnInit(): void {
    void this.reloadActive();
    void this.reloadAudit();
  }

  /**
   * Fetch all currently active access overrides.
   * Calls GET /bff/wiki/superadmin/access (WIKI_MANAGE = SUPERADMIN gated).
   * Sets `activeError` with a clear 403 message when the BFF denies access.
   */
  async reloadActive(): Promise<void> {
    this.activeLoading.set(true);
    this.activeError.set('');
    try {
      const res = await this.wiki.listActiveAccess();
      this.active.set(res.access ?? []);
    } catch (e) {
      this.activeError.set(this.message(e, 'active overrides'));
    } finally {
      this.activeLoading.set(false);
    }
  }

  /**
   * Fetch the full grant/ban history for a specific user.
   * Calls GET /bff/wiki/superadmin/access/{user}/history.
   * No-ops when the subject field is blank.
   */
  async loadHistory(): Promise<void> {
    const user = this.historyUser().trim();
    if (user.length === 0) return;
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      const res = await this.wiki.accessHistory(user);
      this.history.set(res.access ?? []);
    } catch (e) {
      this.history.set(null);
      this.historyError.set(this.message(e, 'history'));
    } finally {
      this.historyLoading.set(false);
    }
  }

  /**
   * Fetch the wiki content-edit audit trail.
   * Calls GET /bff/wiki/superadmin/audit.
   * The audit DTO is BFF-defined (untyped record list); rendered generically.
   */
  async reloadAudit(): Promise<void> {
    this.auditLoading.set(true);
    this.auditError.set('');
    try {
      const res = await this.wiki.auditTrail();
      this.audit.set(res.actions ?? []);
    } catch (e) {
      this.auditError.set(this.message(e, 'audit trail'));
    } finally {
      this.auditLoading.set(false);
    }
  }

  /**
   * Return the column keys of an audit row for generic table rendering.
   * The audit DTO shape is BFF-defined; we render all keys dynamically.
   *
   * @param row - One audit row from the BFF response.
   * @returns The ordered property names of the row.
   */
  auditKeys(row: Record<string, unknown>): string[] {
    return Object.keys(row);
  }

  /**
   * Coerce an audit cell value to a display string.
   *
   * @param v - The raw cell value (any JSON-compatible type).
   * @returns A string representation, or `''` for null/undefined.
   */
  auditValue(v: unknown): string {
    return v == null ? '' : String(v);
  }

  /**
   * Map a caught error to a section-specific user-friendly message.
   * A 403 always means the BFF denied access (superadmin required for all
   * /bff/wiki/superadmin/** paths).
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   * @param what - Short description of the section (for the error string).
   * @returns A localized error string for the template.
   */
  private message(e: unknown, what: string): string {
    if (e instanceof WikiApiError && e.isForbidden) {
      return `The server denied access to the ${what} — superadmin is required.`;
    }
    return `Could not load the ${what}. Please try again.`;
  }
}
