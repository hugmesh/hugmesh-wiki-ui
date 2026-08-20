import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WikiManageComponent } from './wiki-manage.component';
import { WikiService, WikiAccess, WikiApiError } from './wiki.service';

function access(over: Partial<WikiAccess> = {}): WikiAccess {
  return {
    id: '1', domain: 'd', userSubject: 'google:bob@x.com', accessType: 'banned',
    state: 'active', grantedBySubject: 'admin', reason: 'spam',
    createdAt: '2026-06-13T00:00:00Z', expiresAt: null, revokedAt: null, ...over,
  };
}

describe('WikiManageComponent (superadmin manage view)', () => {
  let fixture: ComponentFixture<WikiManageComponent>;
  let wiki: jasmine.SpyObj<WikiService>;

  beforeEach(async () => {
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['listActiveAccess', 'accessHistory', 'auditTrail']);
    wiki.listActiveAccess.and.resolveTo({ access: [access()] });
    wiki.auditTrail.and.resolveTo({ actions: [{ action: 'page.update', slug: 'a', actor: 'admin' }] });
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

  it('tables use scoped headers + captions (a11y)', async () => {
    await render();
    const table = el().querySelector('[data-testid="wiki-manage-active"]')!;
    expect(table.querySelector('caption')).not.toBeNull();
    expect(table.querySelectorAll('th[scope="col"]').length).toBeGreaterThan(0);
  });
});
