import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { WikiAccessComponent } from './wiki-access.component';
import { WikiService, WikiAccess, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

function access(over: Partial<WikiAccess> = {}): WikiAccess {
  return {
    id: '1', domain: 'd', userSubject: 'google:bob@x.com', accessType: 'read',
    state: 'active', grantedBySubject: 'admin', reason: null,
    createdAt: '', expiresAt: null, revokedAt: null, ...over,
  };
}

describe('WikiAccessComponent (grant/timeout/ban console)', () => {
  let fixture: ComponentFixture<WikiAccessComponent>;
  let wiki: jasmine.SpyObj<WikiService>;
  /** WIKI_MANAGE = SUPERADMIN; drives the cross-brand target field. Defaults to
   *  false = a scoped ADMIN, the role every pre-existing spec below exercises. */
  const canManage = signal(false);

  beforeEach(async () => {
    canManage.set(false);
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['grant', 'timeout', 'ban', 'revoke']);
    await TestBed.configureTestingModule({
      imports: [WikiAccessComponent],
      providers: [
        { provide: WikiService, useValue: wiki },
        { provide: SessionService, useValue: { canManage } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiAccessComponent);
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('requires a user subject before submit', async () => {
    const c = fixture.componentInstance;
    await c.submit();
    expect(wiki.grant).not.toHaveBeenCalled();
    expect(c.userInvalid()).toBeTrue();
  });

  it('GRANT → wiki.grant and surfaces the result row', async () => {
    const c = fixture.componentInstance;
    c.userSubject.set('google:bob@x.com');
    wiki.grant.and.resolveTo(access({ accessType: 'read' }));
    await c.submit();
    expect(wiki.grant).toHaveBeenCalledWith({ userSubject: 'google:bob@x.com', reason: undefined });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="wiki-access-result"]')).not.toBeNull();
  });

  it('TIMEOUT → wiki.timeout converting hours to ttlSeconds', async () => {
    const c = fixture.componentInstance;
    c.setAction('timeout');
    c.userSubject.set('u');
    c.timeoutHours.set(2);
    wiki.timeout.and.resolveTo(access({ accessType: 'banned', expiresAt: '2030-01-01' }));
    await c.submit();
    expect(wiki.timeout).toHaveBeenCalledWith({ userSubject: 'u', ttlSeconds: 7200, reason: undefined });
  });

  it('BAN → wiki.ban and shows the ban-precedence note + a Restore action on the result', async () => {
    const c = fixture.componentInstance;
    c.setAction('ban');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="wiki-access-ban-note"]'))
      .withContext('ban precedence surfaced').not.toBeNull();
    c.userSubject.set('u');
    wiki.ban.and.resolveTo(access({ accessType: 'banned', state: 'active' }));
    await c.submit();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="wiki-access-restore"]')).not.toBeNull();
  });

  it('restore → revoke("banned", user)', async () => {
    const c = fixture.componentInstance;
    wiki.revoke.and.resolveTo();
    await c.restore('google:bob@x.com');
    expect(wiki.revoke).toHaveBeenCalledWith('banned', 'google:bob@x.com');
    expect(c.notice()).toContain('restored');
  });

  it('surfaces a 403 access-denial in role="alert"', async () => {
    const c = fixture.componentInstance;
    c.userSubject.set('u');
    wiki.grant.and.rejectWith(new WikiApiError(403, 'no'));
    await c.submit();
    fixture.detectChanges();
    const err = el().querySelector('[data-testid="wiki-access-error"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('denied');
  });

  it('the user-subject input has a programmatic label + describedby help (a11y)', () => {
    const input = el().querySelector('#wiki-access-user')!;
    const label = el().querySelector('label[for="wiki-access-user"]');
    expect(label).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toContain('wiki-access-user-help');
  });

  // ── cross-brand target (SUPERADMIN) — the UI half of wiki-bff-api PR #39 ──
  //
  // The bff REQUIRES a known targetDomain from a SUPERADMIN on a multi-brand
  // deployment and fails closed 400 without one, so a console that cannot set the
  // field leaves a SUPERADMIN unable to grant/timeout/ban at all there.
  describe('cross-brand target brand', () => {
    it('is NOT offered to a scoped ADMIN (the bff ignores the field for them)', () => {
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]'))
        .withContext('an admin always writes to their own issuer-derived brand')
        .toBeNull();
    });

    it('is offered to a SUPERADMIN, with a label + describedby help (a11y)', () => {
      canManage.set(true);
      fixture.detectChanges();
      const input = el().querySelector('[data-testid="wiki-access-target-domain"]')!;
      expect(input).not.toBeNull();
      expect(el().querySelector('label[for="wiki-access-target-domain"]')).not.toBeNull();
      expect(input.getAttribute('aria-describedby')).toContain('wiki-access-target-domain-help');
    });

    it('GRANT as SUPERADMIN → sends targetDomain so the row lands in the victim brand', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.userSubject.set('google:bob@x.com');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({
        userSubject: 'google:bob@x.com', reason: undefined, targetDomain: 'brandx',
      });
    });

    it('BAN as SUPERADMIN → sends targetDomain (trimmed)', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.setAction('ban');
      c.userSubject.set('u');
      c.targetDomain.set('  brandx  ');
      wiki.ban.and.resolveTo(access({ accessType: 'banned', domain: 'brandx' }));
      await c.submit();
      expect(wiki.ban).toHaveBeenCalledWith({
        userSubject: 'u', reason: undefined, targetDomain: 'brandx',
      });
    });

    it('TIMEOUT as SUPERADMIN → sends targetDomain alongside ttlSeconds', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.setAction('timeout');
      c.userSubject.set('u');
      c.timeoutHours.set(2);
      c.targetDomain.set('brandx');
      wiki.timeout.and.resolveTo(access({ accessType: 'banned', domain: 'brandx' }));
      await c.submit();
      expect(wiki.timeout).toHaveBeenCalledWith({
        userSubject: 'u', ttlSeconds: 7200, reason: undefined, targetDomain: 'brandx',
      });
    });

    it('omits targetDomain entirely when a SUPERADMIN leaves it blank (single-brand: bff ignores it)', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access());
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({ userSubject: 'u', reason: undefined });
    });

    it('never sends targetDomain for an ADMIN even if the signal somehow holds one', async () => {
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access());
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({ userSubject: 'u', reason: undefined });
    });

    it('echoes the bff-stamped brand on the applied result (confirms the intended tenant)', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit();
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-result-domain"]')!.textContent)
        .toContain('brandx');
    });

    it('surfaces the bff fail-closed 400 verbatim when no brand is named', async () => {
      canManage.set(true);
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      wiki.grant.and.rejectWith(
        new WikiApiError(400, 'a SUPERADMIN grant must target a known brand via targetDomain'),
      );
      await c.submit();
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-error"]')!.textContent)
        .toContain('must target a known brand');
    });
  });
});
