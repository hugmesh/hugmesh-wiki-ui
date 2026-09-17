import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { WikiAccessComponent } from './wiki-access.component';
import { WikiService, WikiAccess, WikiApiError, BrandCatalog } from './wiki.service';
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
    wiki = jasmine.createSpyObj<WikiService>('WikiService',
      ['grant', 'timeout', 'ban', 'revoke', 'observedBrands', 'brandCatalog']);
    // The brand suggestions are a convenience the field works without; default the
    // double to "nothing observed" so every pre-existing spec keeps exercising the
    // free-text path exactly as before.
    wiki.observedBrands.and.resolveTo([]);
    // ...and default the CATALOGUE read to DENIED, so those same pre-existing specs are
    // explicitly the catalogue-unavailable fallback rather than accidentally it. The
    // authoritative-picker specs opt in by resolving this instead (see `catalog()` below).
    wiki.brandCatalog.and.rejectWith(new WikiApiError(403, 'not a superadmin'));
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

    it('is offered to a SUPERADMIN, with a label + describedby help (a11y)', async () => {
      // Rendered as a SUPERADMIN from the start: the control's shape is decided by the
      // catalogue read that ngOnInit fires, so flipping the role afterwards on an ADMIN
      // fixture would assert against a control that had never been decided.
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await fixture.whenStable();
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

  // ── brand picker: the OBSERVED FALLBACK (issue #3 item 2) ──
  //
  // Every spec in here runs with the catalogue read DENIED (the beforeEach default),
  // which is the branch that keeps a SUPERADMIN able to act when
  // GET /bff/wiki/superadmin/brands cannot be read. There the suggestions are OBSERVED
  // (WikiService.observedBrands unions the two SUPERADMIN cross-domain reads): a subset
  // of the server's registry, which is exactly why THIS mode is a datalist combobox and
  // not a <select> — an unobserved brand must stay typeable, and the bff's 400 stays the
  // real gate. The authoritative picker is the describe below.
  describe('target-brand picker — observed fallback (catalogue unavailable)', () => {
    /** Re-create the fixture with canManage already true, so ngOnInit sees the
     *  SUPERADMIN role (the beforeEach above renders as a scoped ADMIN).
     *
     *  Settled TWICE on purpose: this mode is reached by two SEQUENTIAL reads — the
     *  catalogue read has to fail before the observed read is even started — so one
     *  stabilisation lands between them, with the datalist still empty. */
    async function renderAsSuperadmin(): Promise<void> {
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
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

    it('says the suggestions are still loading, rather than looking like there are none', async () => {
      // The combobox is on screen the moment the catalogue is known unavailable, with its
      // suggestions still outstanding. Without this line the operator cannot tell "not read
      // yet" from "this console has never seen a brand" — and `brandsLoading` was left
      // write-only dead state when the template was rewritten around the five modes.
      wiki.brandCatalog.and.rejectWith(new WikiApiError(503, 'upstream down'));
      wiki.observedBrands.and.returnValue(new Promise<string[]>(() => {}));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-brands-loading-suggestions"]'))
        .withContext('brandsLoading is rendered again, in the one mode that has a second read')
        .not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-brands-none"]'))
        .withContext('"none observed" is a different fact from "not read yet"').toBeNull();
    });
  });

  // ── brand picker: the AUTHORITATIVE catalogue (issue #3 item 2, unblocked by the
  //    operator's "yes — multi-brand wiki IS in launch scope") ──
  //
  // GET /bff/wiki/superadmin/brands (hugmesh-wiki-bff-api#12) serves the registry the bff
  // validates a submitted targetDomain against, so the control can finally be a CLOSED
  // select. The one rule every spec here defends: never offer a brand the server will not
  // honour — a picker whose choice is discarded is worse than no picker.
  describe('target-brand picker — authoritative catalogue', () => {
    function catalog(over: Partial<BrandCatalog> = {}): BrandCatalog {
      return { brands: [], launchDomain: null, targetDomainHonoured: true, ...over };
    }

    /** Settled twice so the one spec in here that takes the FALLBACK branch (two
     *  sequential reads) settles on the same helper as the rest. */
    async function renderAsSuperadmin(): Promise<void> {
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function selectOptions(): string[] {
      return Array.from(
        el().querySelectorAll('[data-testid="wiki-access-target-domain-select"] option'),
      ).map((o) => (o as HTMLOptionElement).value);
    }

    it('does not read the catalogue for a scoped ADMIN (it would 403, and the field is inert)', () => {
      expect(wiki.brandCatalog).not.toHaveBeenCalled();
    });

    it('renders a CLOSED select over the catalogue, not a typeable combobox', async () => {
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'] }));
      await renderAsSuperadmin();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]'))
        .withContext('the server list is complete, so the control can be closed').not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]'))
        .withContext('and the free-text fallback must NOT also be on screen').toBeNull();
      expect(selectOptions()).toEqual(['', 'acme', 'globex']);
    });

    it('does not fall back to observation when the catalogue answered', async () => {
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme'] }));
      await renderAsSuperadmin();
      expect(wiki.observedBrands)
        .withContext('a complete list must not be diluted with a partial one')
        .not.toHaveBeenCalled();
    });

    it('preselects the domain the wiki is LAUNCHED on, and marks it', async () => {
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['acme', 'hugmesh'], launchDomain: 'hugmesh' }),
      );
      await renderAsSuperadmin();
      expect(fixture.componentInstance.targetDomain()).toBe('hugmesh');
      const marked = Array.from(
        el().querySelectorAll('[data-testid="wiki-access-target-domain-select"] option'),
      ).find((o) => (o as HTMLOptionElement).value === 'hugmesh')!;
      expect(marked.textContent).toContain('this wiki');
    });

    it('does NOT preselect a launch domain the server would reject', async () => {
      // 2+ brands: there is no single launch domain, so the bff reports its `hugmesh`
      // fallback — which is not a configured brand here. Preselecting it would preselect a
      // guaranteed 400, which is exactly the failure this whole control exists to prevent.
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['acme', 'globex'], launchDomain: 'hugmesh' }),
      );
      await renderAsSuperadmin();
      expect(fixture.componentInstance.targetDomain()).toBe('');
      expect(selectOptions()).not.toContain('hugmesh');
    });

    it('DECISION 33a: the picker is REQUIRED and blocks submit inline, before the round-trip', async () => {
      // RATIFIED as built (operator, 2026-09-17, hugmesh-generator#347). The question put to
      // the operator was whether to keep converting the bff's fail-closed 400 into a
      // client-side error, or let the round-trip carry it. They kept it — so this pins the
      // three parts that make it true, and a "just let the server say no" simplification
      // turns it red.
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'], launchDomain: 'hugmesh' }));
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');

      // 1. required — the control advertises it, so AT announces it before submit.
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')!
        .getAttribute('aria-required')).toBe('true');
      // 2. blocks — formValid() is false with a complete form but no brand.
      expect(c.formValid())
        .withContext('a complete form with no brand must not be submittable').toBeFalse();
      // 3. INLINE and BEFORE the round-trip — no request is made at all.
      await c.submit();
      expect(wiki.grant).not.toHaveBeenCalled();
      expect(wiki.ban).not.toHaveBeenCalled();
      expect(wiki.timeout).not.toHaveBeenCalled();
      fixture.detectChanges();
      const err = el().querySelector('#wiki-access-target-domain-err');
      expect(err).withContext('the refusal is rendered next to the field').not.toBeNull();
      expect(err!.getAttribute('role')).toBe('alert');

      // …and it stops blocking the moment a brand is chosen.
      c.targetDomain.set('acme');
      expect(c.formValid()).toBeTrue();
      expect(c.targetInvalid()).toBeFalse();
    });

    it('DECISION 33a: required ONLY where the server said it reads the field', async () => {
      // The other half of the ratified answer, and the reason it is not simply "always
      // required": in every mode but `picker` the bff ignores targetDomain, so requiring one
      // would block a write the server would have accepted.
      wiki.brandCatalog.and.rejectWith(new WikiApiError(503, 'upstream down'));
      wiki.observedBrands.and.resolveTo([]);
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      expect(c.brandMode()).toBe('observed');
      c.userSubject.set('u');
      expect(c.formValid())
        .withContext('the fallback combobox must never block a write on a blank brand').toBeTrue();
      expect(c.targetInvalid()).toBeFalse();
    });

    it('DECISION 33c: the degrade deadline is EIGHT seconds', async () => {
      // RATIFIED as built (operator, 2026-09-17). It is one number, and it is the only thing
      // bounding how long a superadmin looks at a control they cannot use — so it is pinned
      // as a literal rather than inferred from a timing test.
      // Read off a freshly constructed component (the beforeEach fixture is a scoped ADMIN,
      // so no catalogue read has been fired and no spec has had a chance to drive it down).
      expect(fixture.componentInstance.catalogueDeadlineMs)
        .withContext('decision 33c: 8 seconds before the console degrades to free text')
        .toBe(8_000);
    });

    it('blocks submit until a brand is chosen, inline — the bff 400s without one', async () => {
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['acme', 'globex'], launchDomain: 'hugmesh' }),
      );
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      await c.submit();
      expect(wiki.grant).not.toHaveBeenCalled();
      expect(c.targetInvalid()).toBeTrue();
      fixture.detectChanges();
      expect(el().querySelector('#wiki-access-target-domain-err')).not.toBeNull();
    });

    it('sends the chosen brand once one is picked', async () => {
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'] }));
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('globex');
      wiki.grant.and.resolveTo(access({ domain: 'globex' }));
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({
        userSubject: 'u', reason: undefined, targetDomain: 'globex',
      });
    });

    it("keeps an operator's own pick when the catalogue lands after it", async () => {
      let land!: (c: BrandCatalog) => void;
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>((res) => { land = res; }));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      fixture.componentInstance.targetDomain.set('globex');
      land(catalog({ brands: ['acme', 'globex'], launchDomain: 'acme' }));
      await fixture.whenStable();
      expect(fixture.componentInstance.targetDomain())
        .withContext('a valid pick outranks the launch-domain default')
        .toBe('globex');
    });

    it('says so, and blocks, when the server accepts a brand but reports none', async () => {
      // Reachable: two issuers both mapped to `default` are two entries but zero offerable
      // brands. A superadmin genuinely cannot apply a change there, and an empty select
      // that silently never submits would be worse than saying it.
      wiki.brandCatalog.and.resolveTo(catalog({ brands: [] }));
      await renderAsSuperadmin();
      expect(el().querySelector('[data-testid="wiki-access-brands-catalog-empty"]')).not.toBeNull();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      await c.submit();
      expect(wiki.grant).not.toHaveBeenCalled();
    });

    // ── the two INERT shapes: the bff does not read targetDomain at all ──

    it('renders NO control, and sends no brand, on a single-brand deployment', async () => {
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: [], launchDomain: 'hugmesh', targetDomainHonoured: false }),
      );
      await renderAsSuperadmin();
      expect(el().querySelector('[data-testid="wiki-access-brands-inert"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]')).toBeNull();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access());
      await c.submit();
      expect(wiki.grant).toHaveBeenCalledWith({ userSubject: 'u', reason: undefined });
    });

    it('WARNS instead of offering a control when the server has a brand but discards the field', async () => {
      // Exactly one configured issuer: users resolve `hugmesh`, but a superadmin write is
      // stamped `default`, so the change never matches them (hugmesh-wiki-bff-api#21).
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['hugmesh'], launchDomain: 'hugmesh', targetDomainHonoured: false }),
      );
      await renderAsSuperadmin();
      const warn = el().querySelector('[data-testid="wiki-access-brands-inert-mismatch"]')!;
      expect(warn).not.toBeNull();
      expect(warn.textContent).toContain('hugmesh');
      expect(warn.textContent).toContain('may not take effect');
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]'))
        .withContext('a control here would promise a choice the server throws away').toBeNull();
    });

    it('does not send a brand the server has told us it discards, even if one is set', async () => {
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['hugmesh'], targetDomainHonoured: false }),
      );
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.targetDomain.set('hugmesh');   // as if left over from before the catalogue answered
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access({ domain: 'default' }));
      await c.submit();
      expect(wiki.grant)
        .withContext('sending it would make the audit log read as a targeted write')
        .toHaveBeenCalledWith({ userSubject: 'u', reason: undefined });
    });

    it('clears a stale typed brand when the catalogue says the field is discarded', async () => {
      let land!: (c: BrandCatalog) => void;
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>((res) => { land = res; }));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      fixture.componentInstance.targetDomain.set('hugmesh');
      land(catalog({ brands: ['hugmesh'], targetDomainHonoured: false }));
      await fixture.whenStable();
      expect(fixture.componentInstance.targetDomain()).toBe('');
    });

    it('does not grow the authoritative list from an applied row', async () => {
      // learnBrand exists for the observed fallback. Folding into a complete list could only
      // ADD something the server deliberately left out of it.
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme'] }));
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      c.targetDomain.set('acme');
      wiki.grant.and.resolveTo(access({ domain: 'smuggled' }));
      await c.submit();
      fixture.detectChanges();
      expect(selectOptions()).toEqual(['', 'acme']);
    });

    it('falls back to the observed combobox when the catalogue read fails', async () => {
      wiki.brandCatalog.and.rejectWith(new WikiApiError(503, 'upstream down'));
      wiki.observedBrands.and.resolveTo(['branda']);
      await renderAsSuperadmin();
      expect(wiki.observedBrands).toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]'))
        .withContext('losing the control entirely would leave a superadmin unable to act')
        .not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-error"]'))
        .withContext('a missing brand list is not an error the operator can act on').toBeNull();
    });

    it('shows the fallback combobox as soon as the catalogue is known unavailable, before its suggestions land', async () => {
      // The mode is decided by the catalogue read FAILING, not by the observed read
      // finishing. Waiting for the suggestions would leave the operator staring at a
      // loading placeholder with a perfectly usable free-text field withheld behind it.
      wiki.brandCatalog.and.rejectWith(new WikiApiError(503, 'upstream down'));
      wiki.observedBrands.and.returnValue(new Promise<string[]>(() => {}));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]'))
        .withContext('usable now, with the suggestions still outstanding').not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-brands-loading"]')).toBeNull();
    });

    it('DECISION 33b: renders a DISABLED control while the catalogue is still in flight', async () => {
      // Operator decision 33b (2026-09-17, hugmesh-generator#347), taken AGAINST the
      // recommendation. What shipped was NO control at all; the point of the change is that
      // the SHAPE OF THE FORM stops moving under the operator. Reverting to "render nothing"
      // turns this red.
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>(() => {}));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();

      const loading = el().querySelector<HTMLSelectElement>(
        '[data-testid="wiki-access-target-domain-loading-select"]');
      expect(loading)
        .withContext('decision 33b: a control is rendered while the read is in flight')
        .not.toBeNull();
      expect(loading!.tagName)
        .withContext('the SAME kind of control the picker becomes, so it is filled in place')
        .toBe('SELECT');
      expect(loading!.disabled)
        .withContext('DISABLED, not merely empty: nothing can be typed or chosen yet, so the '
          + 'half-typed-value hazard the previous design avoided is avoided here too')
        .toBeTrue();
      expect(loading!.getAttribute('aria-busy')).toBe('true');

      // A disabled control is skipped by keyboard and screen-reader traversal, so the state
      // has to be ANNOUNCED, not merely drawn.
      const help = el().querySelector('[data-testid="wiki-access-brands-loading"]');
      expect(help).not.toBeNull();
      expect(help!.getAttribute('role')).toBe('status');
      expect(help!.getAttribute('aria-live')).toBe('polite');
      expect(loading!.getAttribute('aria-describedby')).toBe(help!.id);

      // Still NOT the real picker and NOT the typeable fallback — those are decided by the
      // catalogue, and neither may be reachable before it answers.
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]')).toBeNull();
    });

    it('DECISION 33b: the disabled control is replaced IN PLACE when the catalogue answers', async () => {
      // The whole gain is that the field does not appear from nowhere: the loading control and
      // the picker occupy the same slot, so the form below it does not jump.
      let land!: (c: BrandCatalog) => void;
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>((res) => { land = res; }));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();

      const fieldsBefore = el().querySelectorAll('.wiki-field').length;
      expect(el().querySelector('[data-testid="wiki-access-target-domain-loading-select"]')).not.toBeNull();

      land(catalog({ brands: ['acme', 'globex'], launchDomain: 'acme' }));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el().querySelector('[data-testid="wiki-access-target-domain-loading-select"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).not.toBeNull();
      expect(el().querySelectorAll('.wiki-field').length)
        .withContext('the same number of fields before and after: nothing was pushed down')
        .toBe(fieldsBefore);
    });

    it('DECISION 33b, the COST: the shape still changes on the degrade path', async () => {
      // Recorded, not hidden. 33b stabilises the path that ends in `picker`; on 33c's
      // deadline the control still changes TYPE, from a <select> to a typeable <input>.
      // A future change that claims to have stabilised every path has to move this test.
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>(() => {}));
      wiki.observedBrands.and.resolveTo(['branda']);
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.componentInstance.catalogueDeadlineMs = 10;
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-loading-select"]')!.tagName)
        .toBe('SELECT');

      await new Promise((r) => setTimeout(r, 40));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el().querySelector('[data-testid="wiki-access-target-domain"]')!.tagName)
        .withContext('the measured residual cost of 33b: SELECT -> INPUT on the degrade path')
        .toBe('INPUT');
    });

    // ── the control must never be LOST: `loading` renders nothing, so every way of
    //    staying in it forever is a superadmin with less than the pre-catalogue console
    //    gave them. Two ways existed, and both are closed below. ──

    it('renders the control when the SESSION gains SUPERADMIN after this component initialised', async () => {
      // showTargetDomain is session.canManage, a LIVE signal: SessionService re-reads
      // hug.session on its same-document broadcast and on a cross-tab `storage` event. An
      // ngOnInit `if` sampled it exactly once, so a role that arrived a moment later left
      // the template's @if on with the mode stuck at `loading` — no control, forever.
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'], launchDomain: 'acme' }));
      expect(wiki.brandCatalog)
        .withContext('the beforeEach fixture is a scoped ADMIN: no field, no read')
        .not.toHaveBeenCalled();

      canManage.set(true);          // the host shell (or another tab) writes a superadmin session
      fixture.detectChanges();
      await fixture.whenStable();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(wiki.brandCatalog).toHaveBeenCalled();
      expect(fixture.componentInstance.brandMode()).toBe('picker');
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-brands-loading"]')).toBeNull();
    });

    it('stops waiting for a catalogue that never answers, and falls back to the combobox', async () => {
      // A REJECTED read already fell back. A HUNG one (no response, connection held open)
      // had no timeout and no retry, so the field stayed at "Loading the brands this server
      // accepts…" with no control at all — strictly worse than before the endpoint existed.
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>(() => {}));
      wiki.observedBrands.and.resolveTo(['branda']);
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.componentInstance.catalogueDeadlineMs = 10;   // drive it; do not wait out the real one
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-access-brands-loading"]'))
        .withContext('still honestly loading before the deadline').not.toBeNull();

      await new Promise((r) => setTimeout(r, 40));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.brandMode()).toBe('observed');
      expect(el().querySelector('[data-testid="wiki-access-target-domain"]'))
        .withContext('a usable free-text field, exactly what main gave a superadmin')
        .not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-brands-loading"]')).toBeNull();
    });

    it('does not swap the combobox out from under a half-typed brand when the catalogue answers late', async () => {
      // The deadline decided the shape. Letting a late answer re-decide it would recreate
      // the exact hazard `loading` renders no control to avoid.
      let land!: (c: BrandCatalog) => void;
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>((res) => { land = res; }));
      wiki.observedBrands.and.resolveTo([]);
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.componentInstance.catalogueDeadlineMs = 10;
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 40));
      await fixture.whenStable();
      fixture.detectChanges();

      fixture.componentInstance.targetDomain.set('half-typed');
      land(catalog({ brands: ['acme'], launchDomain: 'acme' }));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.brandMode()).toBe('observed');
      expect(fixture.componentInstance.targetDomain()).toBe('half-typed');
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).toBeNull();
    });

    it('REPLACES a brand learnt while the catalogue was loading — it never folds into it', async () => {
      // learnBrand is deliberately allowed during `loading` (the read is not awaited, so a
      // write can land first). The catalogue's answer is AUTHORITATIVE and must SET the
      // list over it: folding would leave an option the server deliberately left out.
      let land!: (c: BrandCatalog) => void;
      wiki.brandCatalog.and.returnValue(new Promise<BrandCatalog>((res) => { land = res; }));
      canManage.set(true);
      fixture = TestBed.createComponent(WikiAccessComponent);
      fixture.detectChanges();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      wiki.grant.and.resolveTo(access({ domain: 'learnt-while-loading' }));
      await c.submit();
      expect(c.brandOptions()).toContain('learnt-while-loading');

      land(catalog({ brands: ['acme'], launchDomain: 'acme' }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(c.brandOptions()).toEqual(['acme']);
      expect(selectOptions())
        .withContext('an option the server did not offer is a guaranteed 400')
        .toEqual(['', 'acme']);
    });

    it('renders the PICKER, not the warning, as soon as the server honours ONE brand', async () => {
      // FORWARD COMPATIBILITY with hugmesh-wiki-bff-api#21, which the operator answered on
      // 2026-09-16 ("Fix: stamp the configured brand"): at exactly one configured pair the
      // bff's targetDomainHonoured moves from false to TRUE, and this console must follow
      // it into `picker` with no code change here. That holds only because the mode is
      // derived from the FLAG first — a count is used solely to tell the two inert shapes
      // apart — which is precisely the risk the #21 hand-off asked this repo to pin.
      wiki.brandCatalog.and.resolveTo(
        catalog({ brands: ['acme'], launchDomain: 'acme', targetDomainHonoured: true }),
      );
      await renderAsSuperadmin();
      expect(fixture.componentInstance.brandMode()).toBe('picker');
      expect(el().querySelector('[data-testid="wiki-access-brands-inert-mismatch"]'))
        .withContext('warning that the server discards a field it now honours')
        .toBeNull();
      expect(el().querySelector('[data-testid="wiki-access-target-domain-select"]')).not.toBeNull();
      expect(fixture.componentInstance.targetDomain()).toBe('acme');
    });

    // ── a11y of the required picker ──

    it('advertises the requirement up front, and stays quiet until the operator acts', async () => {
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'] }));
      await renderAsSuperadmin();
      const select = el().querySelector('[data-testid="wiki-access-target-domain-select"]')!;
      expect(select.getAttribute('aria-required'))
        .withContext('the requirement lived only in formValid(), so a screen reader got no '
          + 'advance signal at all')
        .toBe('true');
      expect(select.getAttribute('aria-invalid'))
        .withContext('nothing is wrong yet — the operator has not interacted').toBe('false');
      expect(select.getAttribute('aria-describedby'))
        .withContext('must not name the error id while that element does not exist')
        .toBe('wiki-access-target-domain-help');
      expect(el().querySelector('#wiki-access-target-domain-err')).toBeNull();
    });

    it('marks the select invalid and points at the error once a submit is refused', async () => {
      wiki.brandCatalog.and.resolveTo(catalog({ brands: ['acme', 'globex'] }));
      await renderAsSuperadmin();
      const c = fixture.componentInstance;
      c.userSubject.set('u');
      await c.submit();
      fixture.detectChanges();
      const select = el().querySelector('[data-testid="wiki-access-target-domain-select"]')!;
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(select.getAttribute('aria-describedby'))
        .toBe('wiki-access-target-domain-help wiki-access-target-domain-err');
      expect(el().querySelector('#wiki-access-target-domain-err')).not.toBeNull();
    });
  });
});
