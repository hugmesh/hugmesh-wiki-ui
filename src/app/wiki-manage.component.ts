import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { WikiService, WikiAccess, WikiApiError, WikiAuditEntry } from './wiki.service';
import { WikiStepUpComponent } from './wiki-step-up.component';

/**
 * The MANAGE view — the superadmin-only surface over /bff/wiki/superadmin/**
 * (WikiAccessController list/history + WikiController audit). Manage-gated
 * (wikiManageGuard: WIKI_MANAGE = SUPERADMIN); an ADMIN or MOD never reaches it.
 *
 *   active list → GET /bff/wiki/superadmin/access
 *   history     → GET /bff/wiki/superadmin/access/{user}/history
 *   audit trail → GET /bff/wiki/superadmin/audit?limit=… (bounded, newest first)
 *
 * a11y: each section is a labelled region; the tables are real <table> with
 * scope'd headers + captions; the history lookup form has labelled controls +
 * describedby help; loading/empty/error states are announced.
 */
@Component({
  selector: 'hug-wiki-manage',
  standalone: true,
  imports: [CommonModule, FormsModule, WikiStepUpComponent],
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

  /** The audit rows, TYPED against the generated client (wiki-ui#2). Before the
   *  bff grew a real AuditList/AuditEntry schema this was
   *  `Array<Record<string, unknown>>` and the table had to discover its own
   *  columns from `Object.keys(row)` — which meant an empty trail rendered no
   *  header at all, and a bff-side rename showed up as a silently missing column
   *  instead of a build failure. */
  readonly audit = signal<WikiAuditEntry[]>([]);
  readonly auditLoading = signal(true);
  readonly auditError = signal('');

  /** The bff's own bound on `?limit` (WikiAuditLogRepository clamps to [1, 1000]).
   *  Mirrored here so an out-of-range value is refused BEFORE the round-trip; the
   *  server re-clamps regardless, so this is convenience, never the real gate. */
  static readonly AUDIT_LIMIT_MIN = 1;
  static readonly AUDIT_LIMIT_MAX = 1000;

  /** The bff's default page size when `?limit` is omitted — also this control's
   *  starting value, so the first read matches what the server would have done. */
  static readonly AUDIT_LIMIT_DEFAULT = 200;

  /** The page sizes the audit-trail control offers. The bff clamps ?limit to
   *  [1, 1000] and defaults to 200 when unset, so these are the useful stops
   *  inside that bound — 1000 is the server's ceiling, not ours. */
  readonly auditLimits: readonly number[] = [50, 100, 200, 500, 1000];

  /** Selected audit page size; starts at the bff's own default (200). */
  readonly auditLimit = signal(WikiManageComponent.AUDIT_LIMIT_DEFAULT);

  /** Inline validation message for the limit control ('' = valid). Rendered as
   *  text next to the field — never a modal/alert, which would hang a headless
   *  test and block the page. */
  readonly auditLimitError = signal('');

  /** True while a step-up refusal is waiting on the identity check
   *  (hugmesh-wiki-ui#4). One offer serves every section that was refused. */
  readonly stepUpOpen = signal(false);

  /** The reads the bff refused for want of an MFA stamp, by section, so a satisfied
   *  check re-runs exactly those and nothing else. */
  private readonly stepUpRetries = new Map<string, () => Promise<void>>();

  /** The audit columns, in render order, now that the row shape is known. Keyed
   *  on {@link WikiAuditEntry} so a bff-side rename is a COMPILE error here. */
  readonly auditColumns: ReadonlyArray<{ key: keyof WikiAuditEntry; label: string }> = [
    { key: 'createdAt', label: 'When' },
    { key: 'actorSubject', label: 'Actor' },
    { key: 'action', label: 'Action' },
    { key: 'target', label: 'Target' },
    { key: 'domain', label: 'Brand' },
    { key: 'detail', label: 'Detail' },
  ];

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
    this.stepUpRetries.delete('active');
    try {
      const res = await this.wiki.listActiveAccess();
      this.active.set(res.access ?? []);
    } catch (e) {
      this.noteStepUp(e, 'active', () => this.reloadActive());
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
    this.stepUpRetries.delete('history');
    try {
      const res = await this.wiki.accessHistory(user);
      this.history.set(res.access ?? []);
    } catch (e) {
      this.noteStepUp(e, 'history', () => this.loadHistory());
      this.history.set(null);
      this.historyError.set(this.message(e, 'history'));
    } finally {
      this.historyLoading.set(false);
    }
  }

  /**
   * Fetch the wiki content-edit audit trail at the selected page size.
   * Calls GET /bff/wiki/superadmin/audit?limit={@link auditLimit} (newest first).
   * The response is the generated {@link AuditTrail} model, so `actions` is a
   * typed {@link WikiAuditEntry} list rather than an open record.
   */
  async reloadAudit(): Promise<void> {
    this.auditLoading.set(true);
    this.auditError.set('');
    this.stepUpRetries.delete('audit');
    try {
      const res = await this.wiki.auditTrail(this.auditLimit());
      // `actions` is optional on the generated model (springdoc marks no field
      // required), so an absent key is still normalized to an empty trail.
      this.audit.set(res.actions ?? []);
    } catch (e) {
      this.noteStepUp(e, 'audit', () => this.reloadAudit());
      this.auditError.set(this.message(e, 'audit trail'));
    } finally {
      this.auditLoading.set(false);
    }
  }

  /**
   * Validate and apply a requested audit page size, then re-read the trail.
   *
   * The select can only emit one of {@link auditLimits}, but this is also the
   * seam a host, a spec, or a future free-entry field reaches — so the value is
   * validated here rather than trusted: a non-numeric or fractional request is
   * REFUSED (the current limit stands, an inline message says why, and no request
   * is made), and a numeric one outside the bff's own [1, 1000] bound is CLAMPED
   * to the nearest end rather than sent. The bff re-clamps whatever it receives,
   * so this can never be the only bound — it just stops the console from spending
   * a round-trip to learn what it already knows.
   *
   * @param limit - The requested row count (a number, or the string an
   *                `[value]`-bound select would emit).
   */
  setAuditLimit(limit: number | string): void {
    const requested = typeof limit === 'string' ? Number(limit.trim()) : limit;

    if (!Number.isInteger(requested)) {
      this.auditLimitError.set('Rows to load must be a whole number.');
      return;
    }

    const min = WikiManageComponent.AUDIT_LIMIT_MIN;
    const max = WikiManageComponent.AUDIT_LIMIT_MAX;
    const clamped = Math.min(Math.max(requested, min), max);
    this.auditLimitError.set(
      clamped === requested ? '' : `Rows to load must be between ${min} and ${max} — using ${clamped}.`,
    );

    // An unchanged limit is not a reason to re-read; the Retry button is the
    // explicit refresh. (A rejected value above returned before reaching here.)
    if (clamped === this.auditLimit()) return;

    this.auditLimit.set(clamped);
    void this.reloadAudit();
  }

  /**
   * Coerce an audit cell to a display string.
   *
   * @param row - One typed audit row.
   * @param key - The column to read.
   * @returns The cell text, or `''` when the column is null/absent (`detail` is
   *          nullable in wiki_audit_log, and every field is optional on the
   *          generated model).
   */
  auditCell(row: WikiAuditEntry, key: keyof WikiAuditEntry): string {
    const v = row[key];
    return v == null ? '' : String(v);
  }

  /**
   * The identity check passed: the session now carries a fresh MFA stamp, so
   * re-run exactly the reads the bff refused, unchanged.
   */
  onStepUpSatisfied(): void {
    const retries = [...this.stepUpRetries.values()];
    this.stepUpRetries.clear();
    this.stepUpOpen.set(false);
    for (const retry of retries) void retry();
  }

  /** The user chose "Not now": drop the offer and retry nothing. Each refused
   *  section keeps its message and its Retry, which re-offers the check. */
  onStepUpDismissed(): void {
    this.stepUpRetries.clear();
    this.stepUpOpen.set(false);
  }

  /** Remember a read the bff refused for want of an MFA stamp and open the offer.
   *  Any other failure, a role 403 included, is none of this method's business. */
  private noteStepUp(e: unknown, section: string, retry: () => Promise<void>): void {
    if (!(e instanceof WikiApiError) || !e.isStepUpRequired) return;
    this.stepUpRetries.set(section, retry);
    this.stepUpOpen.set(true);
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
    if (e instanceof WikiApiError && e.isStepUpRequired) {
      return `The ${what} needs a fresh identity check.`;
    }
    if (e instanceof WikiApiError && e.isForbidden) {
      return `The server denied access to the ${what} — superadmin is required.`;
    }
    return `Could not load the ${what}. Please try again.`;
  }
}
