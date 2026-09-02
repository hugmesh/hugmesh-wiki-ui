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
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['grant', 'timeout', 'ban', 'revoke', 'observedBrands']);
    // The brand suggestions are a convenience the field works without; default the
    // double to "nothing observed" so every pre-existing spec keeps exercising the
    // free-text path exactly as before.
    wiki.observedBrands.and.resolveTo([]);
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

  // ── brand PICKER (issue #3 item 2) ──
  //
  // The bff serves no known-brands endpoint, so the suggestions are OBSERVED
  // (WikiService.observedBrands unions the two SUPERADMIN cross-domain reads).
  // That is a subset of the server's registry, which is exactly why this is a
  // datalist combobox and not a <select>: an unobserved brand must stay typeable,
  // and the bff's 400 stays the real gate.
  describe('target-brand picker', () => {
    /** Re-create the fixture with canManage already true, so ngOnInit sees the
     *  SUPERADMIN role (the beforeEach above renders as a scoped ADMIN). */
    async function renderAsSuperadmin(): Promise<void> {
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('does NOT read the brand sources for a scoped ADMIN (they would 403)', () => {
      expect(wiki.observedBrands)
        .withContext('the field is not even rendered for an admin')
        .not.toHaveBeenCalled();
    });

    it('loads the observed brands for a SUPERADMIN and offers them as datalist options', async () => {
      wiki.observedBrands.and.resolveTo(['branda', 'brandx']);
      await renderAsSuperadmin();
      expect(wiki.observedBrands).toHaveBeenCalled();
      const opts = Array.from(
        el().querySelectorAll('[data-testid="wiki-access-brand-options"] option'),
      ).map((o) => (o as HTMLOptionElement).value);
      expect(opts).toEqual(['branda', 'brandx']);
    });

    it('binds the input to that datalist so it is a combobox, not free text', async () => {
      wiki.observedBrands.and.resolveTo(['brandx']);
      await renderAsSuperadmin();
      const input = el().querySelector('[data-testid="wiki-access-target-domain"]')!;
      expect(input.getAttribute('list')).toBe('wiki-access-brand-options');
    });

    it('keeps the field TYPEABLE — a brand that was never observed still submits', async () => {
      wiki.observedBrands.and.resolveTo(['branda']);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brand-never-seen');
      wiki.grant.and.resolveTo(access({ domain: 'brand-never-seen' }));
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({
        userSubject: 'u', reason: undefined, targetDomain: 'brand-never-seen',
      });
    });

    it('says the list is incomplete rather than implying it is the whole registry', async () => {
      wiki.observedBrands.and.resolveTo(['branda', 'brandx']);
      await renderAsSuperadmin();
      const hint = el().querySelector('[data-testid="wiki-access-brands-hint"]')!;
      expect(hint).not.toBeNull();
      expect(hint.textContent).toContain('2 brand');
      expect(hint.textContent).toContain('will not be listed');
    });

    it('degrades to a usable free-text field when nothing is observed', async () => {
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      expect(el().querySelector('[data-testid="wiki-access-brands-none"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-error"]'))
        .withContext('absent suggestions are not an error the operator can act on')
        .toBeNull();
    });
  });
});
