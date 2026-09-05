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

    // The observed reads cannot see a brand until it HAS a row, so the first write
    // into a brand is always typed. The row that comes back carries the brand the
    // bff validated against its registry — so learn from it, and only the second
    // write into that brand needs no typing.
    function options(): string[] {
      return Array.from(
        el().querySelectorAll('[data-testid="wiki-access-brand-options"] option'),
      ).map((o) => (o as HTMLOptionElement).value);
    }

    it('learns the brand an applied row landed in, so the next write can pick it', async () => {
      wiki.observedBrands.and.resolveTo(['branda']);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit();
      fixture.detectChanges();
      expect(options())
        .withContext('sorted, and learnt from the server-stamped row — not from what was typed')
        .toEqual(['branda', 'brandx']);
    });

    it('learns from a ban and a timeout too, not only a grant', async () => {
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.setAction('ban');
      c.userSubject.set('u');
      c.targetDomain.set('brandb');
      wiki.ban.and.resolveTo(access({ accessType: 'banned', domain: 'brandb' }));
      await c.submit();
      c.setAction('timeout');
      c.timeoutHours.set(1);
      c.targetDomain.set('brandt');
      wiki.timeout.and.resolveTo(access({ accessType: 'banned', domain: 'brandt' }));
      await c.submit();
      fixture.detectChanges();
      expect(options()).toEqual(['brandb', 'brandt']);
    });

    it('never learns the "default" sentinel from a single-issuer deployment row', async () => {
      // Single-issuer: the bff ignores targetDomain and stamps every row `default`,
      // which its own isKnownDomain rejects. Learning it would hand the operator a
      // suggestion guaranteed to 400.
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access({ domain: 'default' }));
      await c.submit();
      fixture.detectChanges();
      expect(options()).toEqual([]);
      expect(el().querySelector('[data-testid="wiki-access-brands-none"]')).not.toBeNull();
    });

    it('learns what the server STAMPED, never what was typed', async () => {
      // Single-issuer: the bff ignores targetDomain and stamps `default` regardless.
      // The typed value was accepted by nobody, so it must not become a suggestion —
      // only a brand the server itself put on a row has been validated.
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'default' }));
      await c.submit();
      fixture.detectChanges();
      expect(options())
        .withContext('the write succeeded, but the brand it landed in was `default`')
        .toEqual([]);
    });

    it('does not duplicate a brand that is already suggested', async () => {
      wiki.observedBrands.and.resolveTo(['brandx']);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit();
      fixture.detectChanges();
      expect(options()).toEqual(['brandx']);
    });

    it('does not let a slow suggestion read clobber a brand learnt while it was in flight', async () => {
      // ngOnInit fires loadBrands() WITHOUT awaiting it, so a write can be applied
      // — and its server-stamped brand learnt — while that read is still
      // outstanding. If the read SET the options instead of folding into them, the
      // learnt brand would vanish when the read landed, with nothing to say so.
      // Every other learn-spec awaits whenStable() first, which puts the read in
      // FRONT of the write and cannot see this at all.
      let landRead!: (brands: string[]) => void;
      wiki.observedBrands.and.returnValue(
        new Promise<string[]>((resolve) => {
          landRead = resolve;
        }),
      );
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges(); // ngOnInit → loadBrands() now in flight

      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit(); // learnt while the read is still outstanding

      landRead(['branda']); // ... and the read lands LAST
      await fixture.whenStable();
      fixture.detectChanges();
      expect(options())
        .withContext('the read folds into the options, it does not replace them')
        .toEqual(['branda', 'brandx']);
    });

    it('folds a re-observed brand in ONCE when the read confirms what was just learnt', async () => {
      // The overlap case, which is the LIKELY one: a write lands in brandx, the
      // picker learns it, and the suggestion read then comes back reporting the
      // very same brandx (its row is now observable). learnBrand's own
      // `includes()` guard cannot cover this — the read folds through
      // mergeBrands directly — so this is the only spec that exercises the
      // de-duplication inside mergeBrands. Without it the datalist offers the
      // same brand twice.
      let landRead!: (brands: string[]) => void;
      wiki.observedBrands.and.returnValue(
        new Promise<string[]>((resolve) => {
          landRead = resolve;
        }),
      );
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges(); // ngOnInit → loadBrands() now in flight

      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandx');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit(); // learns brandx

      landRead(['branda', 'brandx']); // ... and the read reports brandx too
      await fixture.whenStable();
      fixture.detectChanges();
      expect(options())
        .withContext('a brand observed AND learnt is still one option')
        .toEqual(['branda', 'brandx']);
    });

    it('never learns a brand for a scoped ADMIN — the picker is not theirs to grow', async () => {
      // Defence-in-depth: the whole target-brand block is behind showTargetDomain(),
      // so a learnt brand could not be displayed to an ADMIN today. The role gate in
      // learnBrand is what keeps that true, and nothing else pins it.
      const c = fixture.componentInstance; // the default fixture is a scoped ADMIN
      expect(c.showTargetDomain()).toBeFalse();
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access({ domain: 'brandx' }));
      await c.submit();
      fixture.detectChanges();
      expect(c.brandOptions()).toEqual([]);
    });

    it('learns nothing when the write FAILED (no row, so no validated brand)', async () => {
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('brandnope');
      wiki.grant.and.rejectWith(
        new WikiApiError(400, 'a SUPERADMIN grant must target a known brand via targetDomain'),
      );
      await c.submit();
      fixture.detectChanges();
      expect(options())
        .withContext('the 400 is precisely the server saying this brand does not exist')
        .toEqual([]);
    });
  });
});
