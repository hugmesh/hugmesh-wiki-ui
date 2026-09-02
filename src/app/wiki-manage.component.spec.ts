import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WikiManageComponent } from './wiki-manage.component';
import { WikiService, WikiAccess, WikiApiError, WikiAuditEntry } from './wiki.service';

function access(over: Partial<WikiAccess> = {}): WikiAccess {
  return {
    id: '1', domain: 'd', userSubject: 'google:bob@x.com', accessType: 'banned',
    state: 'active', grantedBySubject: 'admin', reason: 'spam',
    createdAt: '2026-06-13T00:00:00Z', expiresAt: null, revokedAt: null, ...over,
  };
}

/** One TYPED audit row (WikiDto.AuditEntry via the generated model). Before
 *  wiki-ui#2 this fixture could be any bag of keys — the untyped surface would
 *  accept `{ slug, actor }`, which the bff has never emitted. */
function auditRow(over: Partial<WikiAuditEntry> = {}): WikiAuditEntry {
  return {
    id: 'a-1',
    domain: 'brandx',
    actorSubject: 'google:alice@gmail.com',
    action: 'wiki.page.update',
    target: 'home',
    detail: 'v2',
    createdAt: '2026-08-20T10:15:30Z',
    ...over,
  };
}

describe('WikiManageComponent (superadmin manage view)', () => {
  let fixture: ComponentFixture<WikiManageComponent>;
  let wiki: jasmine.SpyObj<WikiService>;

  beforeEach(async () => {
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['listActiveAccess', 'accessHistory', 'auditTrail']);
    wiki.listActiveAccess.and.resolveTo({ access: [access()] });
    wiki.auditTrail.and.resolveTo({ actions: [auditRow()] });
    await TestBed.configureTestingModule({
      imports: [WikiManageComponent],
      providers: [{ provide: WikiService, useValue: wiki }],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiManageComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads active overrides + audit on init and renders both tables', async () => {
    await render();
    expect(wiki.listActiveAccess).toHaveBeenCalled();
    expect(wiki.auditTrail).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="wiki-manage-active"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="wiki-manage-audit"]')).not.toBeNull();
  });

  it('reads the audit trail at the bff default (200) and re-reads at the picked limit', async () => {
    await render();
    expect(wiki.auditTrail).toHaveBeenCalledWith(200);

    const select = el().querySelector<HTMLSelectElement>('[data-testid="wiki-manage-audit-limit"]')!;
    expect(select.getAttribute('aria-describedby')).toBe('wiki-audit-limit-help');
    expect(select.options.length).toBe(fixture.componentInstance.auditLimits.length);

    // Pick the last stop (1000 — the bff's ceiling) through the real control.
    select.selectedIndex = select.options.length - 1;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(fixture.componentInstance.auditLimit()).toBe(1000);
    expect(wiki.auditTrail).toHaveBeenCalledWith(1000);
  });

  it('looks up a principal history on demand', async () => {
    await render();
    wiki.accessHistory.and.resolveTo({ access: [access({ state: 'revoked', revokedAt: '2026-06-13T01:00:00Z' })] });
    const c = fixture.componentInstance;
    c.historyUser.set('google:bob@x.com');
    await c.loadHistory();
    expect(wiki.accessHistory).toHaveBeenCalledWith('google:bob@x.com');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="wiki-manage-history"]')).not.toBeNull();
  });

  it('renders the empty + error states', async () => {
    wiki.listActiveAccess.and.resolveTo({ access: [] });
    wiki.auditTrail.and.rejectWith(new WikiApiError(403, 'no'));
    await render();
    expect(el().querySelector('[data-testid="wiki-manage-active-empty"]')).not.toBeNull();
    const auditErr = el().querySelector('[data-testid="wiki-manage-audit-error"]')!;
    expect(auditErr.getAttribute('role')).toBe('alert');
    expect(auditErr.textContent).toContain('superadmin');
  });

  // ── the TYPED audit render (wiki-ui#2) ───────────────────────────────

  it('renders the typed audit columns by label, in order, from the generated model', async () => {
    await render();
    const table = el().querySelector('[data-testid="wiki-manage-audit"]')!;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    // The header row used to be Object.keys(rows[0]) — whatever the bff happened
    // to send, in whatever order, and NOTHING at all for an empty trail.
    expect(headers).toEqual(['When', 'Actor', 'Action', 'Target', 'Brand', 'Detail']);

    const cells = Array.from(table.querySelectorAll('tbody td')).map((td) => td.textContent?.trim());
    expect(cells).toEqual([
      '2026-08-20T10:15:30Z', 'google:alice@gmail.com', 'wiki.page.update', 'home', 'brandx', 'v2',
    ]);
  });

  it('renders a null detail as an empty cell, not "null" (the column is nullable)', async () => {
    wiki.auditTrail.and.resolveTo({
      actions: [{ ...auditRow(), detail: null } as unknown as WikiAuditEntry],
    });
    await render();
    const cells = Array.from(
      el().querySelectorAll('[data-testid="wiki-manage-audit"] tbody td'),
    ).map((td) => td.textContent?.trim());
    expect(cells[cells.length - 1]).toBe('');
  });

  it('treats a body with no actions key as an empty trail (the model marks it optional)', async () => {
    wiki.auditTrail.and.resolveTo({});
    await render();
    expect(el().querySelector('[data-testid="wiki-manage-audit-empty"]')).not.toBeNull();
    expect(fixture.componentInstance.audit()).toEqual([]);
  });

  // ── the limit control's validation ───────────────────────────────────

  it('starts at the bff default and exposes exactly the in-bound stops', async () => {
    await render();
    const c = fixture.componentInstance;
    expect(c.auditLimit()).toBe(WikiManageComponent.AUDIT_LIMIT_DEFAULT);
    expect(WikiManageComponent.AUDIT_LIMIT_DEFAULT).toBe(200);
    // Every offered stop must be inside the bff's own [1, 1000] clamp — a stop
    // outside it would be a control that silently lies about what it fetched.
    for (const n of c.auditLimits) {
      expect(n).toBeGreaterThanOrEqual(WikiManageComponent.AUDIT_LIMIT_MIN);
      expect(n).toBeLessThanOrEqual(WikiManageComponent.AUDIT_LIMIT_MAX);
    }
  });

  it('clamps an out-of-bound limit to the bff bound, says so inline, and reads at the clamped value', async () => {
    await render();
    const c = fixture.componentInstance;
    wiki.auditTrail.calls.reset();

    c.setAuditLimit(5000);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.auditLimit()).toBe(WikiManageComponent.AUDIT_LIMIT_MAX);
    expect(wiki.auditTrail).toHaveBeenCalledWith(WikiManageComponent.AUDIT_LIMIT_MAX);
    expect(wiki.auditTrail).not.toHaveBeenCalledWith(5000);
    const msg = el().querySelector('[data-testid="wiki-manage-audit-limit-error"]')!;
    expect(msg).not.toBeNull();
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.textContent).toContain('1000');
  });

  it('clamps a below-range limit up to the minimum rather than requesting 0 rows', async () => {
    await render();
    const c = fixture.componentInstance;
    wiki.auditTrail.calls.reset();

    c.setAuditLimit(0);
    await fixture.whenStable();

    expect(c.auditLimit()).toBe(WikiManageComponent.AUDIT_LIMIT_MIN);
    expect(wiki.auditTrail).toHaveBeenCalledWith(WikiManageComponent.AUDIT_LIMIT_MIN);
  });

  it('refuses a non-integer limit: no request, the current limit stands, inline message', async () => {
    await render();
    const c = fixture.componentInstance;
    wiki.auditTrail.calls.reset();

    c.setAuditLimit(12.5);
    c.setAuditLimit('abc');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(wiki.auditTrail).not.toHaveBeenCalled();
    expect(c.auditLimit()).toBe(WikiManageComponent.AUDIT_LIMIT_DEFAULT);
    expect(el().querySelector('[data-testid="wiki-manage-audit-limit-error"]')?.textContent)
      .toContain('whole number');
  });

  it('accepts the numeric string a [value]-bound control would emit', async () => {
    await render();
    const c = fixture.componentInstance;
    wiki.auditTrail.calls.reset();

    c.setAuditLimit(' 500 ');
    await fixture.whenStable();

    expect(c.auditLimit()).toBe(500);
    expect(wiki.auditTrail).toHaveBeenCalledWith(500);
    expect(c.auditLimitError()).toBe('');
  });

  it('does not re-read when the picked limit is the one already loaded', async () => {
    await render();
    const c = fixture.componentInstance;
    wiki.auditTrail.calls.reset();

    c.setAuditLimit(WikiManageComponent.AUDIT_LIMIT_DEFAULT);
    await fixture.whenStable();

    expect(wiki.auditTrail).not.toHaveBeenCalled();
  });

  it('tables use scoped headers + captions (a11y)', async () => {
    await render();
    const table = el().querySelector('[data-testid="wiki-manage-active"]')!;
    expect(table.querySelector('caption')).not.toBeNull();
    expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
  });
});
