import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  WikiService,
  WikiApiError,
  WIKI_BASE_URL,
  PageList,
  WikiPage,
  WikiAccess,
  WikiAuditEntry,
  DOMAIN_SENTINELS,
  suggestableBrand,
} from './wiki.service';
import { authInterceptor } from './auth.interceptor';
import { SessionService, SnapSession } from './session.service';

/** One typed audit row as the bff emits it (WikiDto.AuditEntry). */
function auditRow(over: Partial<WikiAuditEntry> = {}): WikiAuditEntry {
  return {
    id: 'a-1',
    domain: 'brandx',
    actorSubject: 'actor-1',
    action: 'wiki.page.create',
    target: 'home',
    detail: 'v1',
    createdAt: '2026-08-20T10:15:30Z',
    ...over,
  };
}

function adminSession(): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: ['admin'],
    registrationComplete: true,
  };
}

/**
 * The CONTENT feature (list/get/create/update/publish) was migrated to DELEGATE
 * to the generated, typed content client (src/app/api) over Angular HttpClient;
 * the HttpOnly `bff_` session cookie is sent (withCredentials) by the
 * {@link authInterceptor} wired in bootstrap.ts — the browser holds no Bearer.
 * These specs therefore assert the wire calls via the {@link HttpTestingController}
 * (URL / method / body / withCredentials) rather than spying on `fetch` — the
 * SAME same-origin /bff/wiki/** paths the old fetch transport hit (generated
 * rootUrl = WIKI_BASE_URL = ''). The public method signatures, return types and
 * the WikiApiError(409/403) contract are unchanged.
 */
describe('WikiService — content (delegates to the generated client over HttpClient)', () => {
  let service: WikiService;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(adminSession());

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [
        WikiService,
        { provide: SessionService, useValue: { session: sessionSig } },
        { provide: WIKI_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WikiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listPages → GET /bff/wiki/pages with the bff_ cookie and no Bearer', async () => {
    const list: PageList = {
      pages: [{ id: '1', slug: 'a', title: 'A', authorSubject: 's', version: 1, updatedAt: '' }],
    };
    const promise = service.listPages();
    const req = httpMock.expectOne('/bff/wiki/pages');
    expect(req.request.method).toBe('GET');
    // The browser sends the HttpOnly bff_ cookie (withCredentials), NOT a Bearer.
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(list);
    const res = await promise;
    expect(res.pages.length).toBe(1);
  });

  it('getPage → GET /bff/wiki/pages/{slug}', async () => {
    const pg = { slug: 'getting-started', contentHtml: '<p>hi</p>' } as WikiPage;
    const promise = service.getPage('getting-started');
    const req = httpMock.expectOne('/bff/wiki/pages/getting-started');
    expect(req.request.method).toBe('GET');
    req.flush(pg);
    const res = await promise;
    expect(res.slug).toBe('getting-started');
  });

  it('createPage → POST /bff/wiki/admin/pages with the body', async () => {
    const promise = service.createPage({ slug: 'x', title: 'X', contentMarkdown: '# x' });
    const req = httpMock.expectOne('/bff/wiki/admin/pages');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ slug: 'x', title: 'X', contentMarkdown: '# x' });
    req.flush({ slug: 'x' });
    await promise;
  });

  it('createPage surfaces a 409 duplicate-slug as WikiApiError.isConflict', async () => {
    const promise = service.createPage({ slug: 'dup', title: 'T', contentMarkdown: 'c' });
    const req = httpMock.expectOne('/bff/wiki/admin/pages');
    req.flush({ error: 'slug exists' }, { status: 409, statusText: 'Conflict' });
    try {
      await promise;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof WikiApiError).toBeTrue();
      expect((e as WikiApiError).status).toBe(409);
      expect((e as WikiApiError).isConflict).toBeTrue();
    }
  });

  it('updatePage → PUT /bff/wiki/admin/pages/{slug} with expectedVersion; 409 = stale edit', async () => {
    const promise = service.updatePage('s', { title: 'T', contentMarkdown: 'c', expectedVersion: 2 });
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.expectedVersion).toBe(2);
    req.flush({ slug: 's', version: 3 });
    await promise;
  });

  it('publishPage → POST /bff/wiki/admin/pages/{slug}/publish', async () => {
    const promise = service.publishPage('s');
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s/publish');
    expect(req.request.method).toBe('POST');
    req.flush({ state: 'published', slug: 's', version: 2 });
    const res = await promise;
    expect(res.state).toBe('published');
  });

  it('deletePage → DELETE /bff/wiki/admin/pages/{slug} (204, no body)', async () => {
    const promise = service.deletePage('s');
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('deletePage surfaces a 404 (slug already gone) as WikiApiError.isNotFound', async () => {
    const promise = service.deletePage('gone');
    const req = httpMock.expectOne('/bff/wiki/admin/pages/gone');
    req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
    try {
      await promise;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof WikiApiError).toBeTrue();
      expect((e as WikiApiError).isNotFound).toBeTrue();
    }
  });

  it('surfaces a 403 as WikiApiError.isForbidden (the bff @PreAuthorize denial)', async () => {
    const promise = service.listPages();
    const req = httpMock.expectOne('/bff/wiki/pages');
    req.flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    try {
      await promise;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof WikiApiError).toBeTrue();
      expect((e as WikiApiError).isForbidden).toBeTrue();
    }
  });
});

/**
 * The ACCESS / AUDIT overlay methods (grant / timeout / ban / revoke /
 * listActiveAccess / accessHistory / auditTrail) now DELEGATE to the generated
 * clients too (WikiAccessService + the audit operation on the content client) —
 * the hand-rolled `fetch` transport is gone. Same assertion style as the
 * content specs: the EXACT path/method/body per bff endpoint via the
 * {@link HttpTestingController}, plus the cookie-not-Bearer credential shape.
 */
describe('WikiService — access/audit overlay (delegates to the generated client over HttpClient)', () => {
  let service: WikiService;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(adminSession());

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [
        WikiService,
        { provide: SessionService, useValue: { session: sessionSig } },
        { provide: WIKI_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WikiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('grant/timeout/ban → POST the right /bff/wiki/admin/access/* endpoints with the bff_ cookie and no Bearer', async () => {
    const row = { accessType: 'read', state: 'active' } as WikiAccess;

    const grant = service.grant({ userSubject: 'u', reason: 'r' });
    const greq = httpMock.expectOne('/bff/wiki/admin/access/grant');
    expect(greq.request.method).toBe('POST');
    expect(greq.request.body).toEqual({ userSubject: 'u', reason: 'r' });
    // The call carries the HttpOnly bff_ cookie (withCredentials), NOT a Bearer.
    expect(greq.request.withCredentials).toBeTrue();
    expect(greq.request.headers.has('Authorization')).toBeFalse();
    greq.flush(row);
    expect((await grant).accessType).toBe('read');

    const timeout = service.timeout({ userSubject: 'u', ttlSeconds: 3600 });
    const treq = httpMock.expectOne('/bff/wiki/admin/access/timeout');
    expect(treq.request.method).toBe('POST');
    expect(treq.request.body).toEqual({ userSubject: 'u', ttlSeconds: 3600 });
    treq.flush({ accessType: 'banned', state: 'active' });
    await timeout;

    const ban = service.ban({ userSubject: 'u' });
    const breq = httpMock.expectOne('/bff/wiki/admin/access/ban');
    expect(breq.request.method).toBe('POST');
    breq.flush({ accessType: 'banned', state: 'active' });
    await ban;
  });

  // The bff (WikiAccessService.writeDomain) REQUIRES a known `targetDomain` from a
  // SUPERADMIN on a multi-brand deployment and fails closed 400 without one, so the
  // field must survive the facade -> generated-client -> wire hop verbatim. Asserting
  // the request BODY (not just that the method was called) is what makes this bite:
  // dropping the field from the wrapper types silently strips it from the JSON.
  it('grant/timeout/ban → carry targetDomain verbatim in the POST body (SUPERADMIN cross-brand write)', async () => {
    const row = { accessType: 'read', state: 'active', domain: 'brandx' } as WikiAccess;

    const grant = service.grant({ userSubject: 'u', reason: 'r', targetDomain: 'brandx' });
    const greq = httpMock.expectOne('/bff/wiki/admin/access/grant');
    expect(greq.request.body).toEqual({ userSubject: 'u', reason: 'r', targetDomain: 'brandx' });
    greq.flush(row);
    expect((await grant).domain).toBe('brandx');

    const timeout = service.timeout({ userSubject: 'u', ttlSeconds: 3600, targetDomain: 'brandy' });
    const treq = httpMock.expectOne('/bff/wiki/admin/access/timeout');
    expect(treq.request.body).toEqual({ userSubject: 'u', ttlSeconds: 3600, targetDomain: 'brandy' });
    treq.flush({ accessType: 'banned', state: 'active' });
    await timeout;

    const ban = service.ban({ userSubject: 'u', targetDomain: 'brandz' });
    const breq = httpMock.expectOne('/bff/wiki/admin/access/ban');
    expect(breq.request.body).toEqual({ userSubject: 'u', targetDomain: 'brandz' });
    breq.flush({ accessType: 'banned', state: 'active' });
    await ban;
  });

  // The bff's fail-closed 400 (a SUPERADMIN write naming no/unknown brand) must reach
  // the operator verbatim rather than as a generic failure — it is actionable.
  it('surfaces the bff fail-closed 400 for a SUPERADMIN write with no resolvable brand', async () => {
    const promise = service.grant({ userSubject: 'u' });
    const req = httpMock.expectOne('/bff/wiki/admin/access/grant');
    req.flush(
      { message: 'a SUPERADMIN grant must target a known brand via targetDomain' },
      { status: 400, statusText: 'Bad Request' },
    );
    await expectAsync(promise).toBeRejectedWithError(
      WikiApiError,
      'a SUPERADMIN grant must target a known brand via targetDomain',
    );
  });

  it('revoke → DELETE /bff/wiki/admin/access/{type}/{user} (subject percent-encoded, as before)', async () => {
    const promise = service.revoke('banned', 'google:bob@x.com');
    const req = httpMock.expectOne('/bff/wiki/admin/access/banned/google%3Abob%40x.com');
    expect(req.request.method).toBe('DELETE');
    req.flush({ state: 'revoked' });
    await promise;
  });

  it('listActiveAccess + accessHistory → the superadmin endpoints', async () => {
    const list = service.listActiveAccess();
    const lreq = httpMock.expectOne('/bff/wiki/superadmin/access');
    expect(lreq.request.method).toBe('GET');
    lreq.flush({ access: [] });
    expect((await list).access).toEqual([]);

    const history = service.accessHistory('u');
    const hreq = httpMock.expectOne('/bff/wiki/superadmin/access/u/history');
    expect(hreq.request.method).toBe('GET');
    hreq.flush({ access: [] });
    await history;
  });

  it('auditTrail → GET /bff/wiki/superadmin/audit (no ?limit ⇒ the bff default)', async () => {
    const promise = service.auditTrail();
    // Exact-URL match: an omitted limit must send NO query param at all.
    const req = httpMock.expectOne('/bff/wiki/superadmin/audit');
    expect(req.request.method).toBe('GET');
    req.flush({ actions: [auditRow()] });
    expect((await promise).actions?.length).toBe(1);
  });

  it('auditTrail(limit) → GET /bff/wiki/superadmin/audit?limit=… (the bff re-clamps to [1, 1000])', async () => {
    const promise = service.auditTrail(500);
    const req = httpMock.expectOne('/bff/wiki/superadmin/audit?limit=500');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('500');
    req.flush({ actions: [] });
    await promise;
  });

  // ── the TYPED parse (wiki-ui#2) ──────────────────────────────────────
  //
  // The bff used to return an untyped Map<String,Object>, springdoc rendered it
  // as an open object, and the generated client typed it `{[key: string]: {}}` —
  // so this wrapper cast the body to Record<string, unknown> and every consumer
  // was on its own. With the real AuditList/AuditEntry schema on the bff the
  // wrapper returns the GENERATED model and does no cast at all.

  it('auditTrail parses the response into the typed AuditList (every AuditEntry field carried)', async () => {
    const promise = service.auditTrail(50);
    const req = httpMock.expectOne('/bff/wiki/superadmin/audit?limit=50');
    req.flush({
      actions: [
        auditRow(),
        // `detail` is nullable in wiki_audit_log — the bff sends a literal null,
        // which the OpenAPI schema (no `nullable`) cannot express, so flush the
        // real wire value rather than the model's optional-string stand-in.
        { ...auditRow({ id: 'a-2', action: 'wiki.page.update', target: 'faq' }), detail: null },
      ],
    });

    const body = await promise;
    const rows: WikiAuditEntry[] = body.actions ?? [];
    expect(rows.length).toBe(2);
    // Field-for-field: a schema that renamed or dropped a column would fail here
    // AND would have failed to compile, which is the whole point of typing it.
    expect(rows[0]).toEqual(auditRow());
    expect(rows[0].createdAt).toBe('2026-08-20T10:15:30Z');
    expect(rows[0].actorSubject).toBe('actor-1');
    // `detail` is the nullable column — it must survive as null/undefined, not
    // throw and not be substituted.
    expect(rows[1].detail == null).toBeTrue();
  });

  it('auditTrail tolerates a body with no actions key (the generated model marks it optional)', async () => {
    const promise = service.auditTrail();
    httpMock.expectOne('/bff/wiki/superadmin/audit').flush({});
    expect((await promise).actions).toBeUndefined();
  });

  it('surfaces a 403 as WikiApiError.isForbidden (the bff @PreAuthorize denial)', async () => {
    const promise = service.listActiveAccess();
    const req = httpMock.expectOne('/bff/wiki/superadmin/access');
    req.flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    try {
      await promise;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof WikiApiError).toBeTrue();
      expect((e as WikiApiError).isForbidden).toBeTrue();
    }
  });
});

/**
 * The ATTACHMENTS feature (WikiAttachmentController) — list/download at the
 * read tier (the WikiAccessGuard overlay applies server-side), upload/delete
 * at WIKI_WRITE under /bff/wiki/admin/**. Asserted at the wire: the multipart
 * 'file' part for upload, the blob responseType for download.
 */
describe('WikiService — attachments (delegates to the generated client over HttpClient)', () => {
  let service: WikiService;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(adminSession());

  beforeEach(() => {
    sessionSig.set(adminSession());
    TestBed.configureTestingModule({
      providers: [
        WikiService,
        { provide: SessionService, useValue: { session: sessionSig } },
        { provide: WIKI_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WikiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listAttachments → GET /bff/wiki/pages/{slug}/attachments (metadata only)', async () => {
    const promise = service.listAttachments('getting-started');
    const req = httpMock.expectOne('/bff/wiki/pages/getting-started/attachments');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ attachments: [{ id: '1', filename: 'a.png', mimeType: 'image/png', createdAt: '' }] });
    const res = await promise;
    expect(res.attachments.length).toBe(1);
    expect(res.attachments[0].filename).toBe('a.png');
  });

  it('uploadAttachment → POST /bff/wiki/admin/pages/{slug}/attachments as multipart with the "file" part (filename preserved)', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const promise = service.uploadAttachment('s', file);
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s/attachments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    const part = (req.request.body as FormData).get('file');
    expect(part instanceof File).toBeTrue();
    expect((part as File).name).toBe('notes.txt');
    req.flush({ id: '1', filename: 'notes.txt', mimeType: 'text/plain', createdAt: '' });
    expect((await promise).filename).toBe('notes.txt');
  });

  it('deleteAttachment → DELETE /bff/wiki/admin/pages/{slug}/attachments/{filename}', async () => {
    const promise = service.deleteAttachment('s', 'a.png');
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s/attachments/a.png');
    expect(req.request.method).toBe('DELETE');
    req.flush({ state: 'deleted', slug: 's', filename: 'a.png' });
    await promise;
  });

  it('downloadAttachment → GET .../attachments/{filename} with responseType blob; resolves the Blob', async () => {
    const promise = service.downloadAttachment('s', 'a.png');
    const req = httpMock.expectOne('/bff/wiki/pages/s/attachments/a.png');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['bytes'], { type: 'image/png' }));
    const res = await promise;
    expect(res instanceof Blob).toBeTrue();
    expect(res.type).toBe('image/png');
  });

  it('surfaces an upload 403 as WikiApiError.isForbidden (WIKI_WRITE is the server gate)', async () => {
    const promise = service.uploadAttachment('s', new File(['x'], 'x.bin'));
    const req = httpMock.expectOne('/bff/wiki/admin/pages/s/attachments');
    req.flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    try {
      await promise;
      fail('expected rejection');
    } catch (e) {
      expect(e instanceof WikiApiError).toBeTrue();
      expect((e as WikiApiError).isForbidden).toBeTrue();
    }
  });
});

/**
 * BRAND CATALOGUE — {@link WikiService.brandCatalog}, the AUTHORITATIVE half of the issue-#3
 * picker. `GET /bff/wiki/superadmin/brands` (hugmesh-wiki-bff-api#12) serves the very
 * registry the bff validates a submitted `targetDomain` against, which is what lets the
 * console render a closed select instead of free text.
 *
 * The specs pin the properties the picker depends on, and they are the OPPOSITE of
 * {@link WikiService.observedBrands}' on two counts: this list is COMPLETE, and this read
 * REJECTS. "The server denied the catalogue" and "the server says there are no brands" are
 * different facts that the console renders differently, so they must not collapse into one.
 */
describe('WikiService — brand catalogue (the authority behind the picker)', () => {
  let service: WikiService;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(adminSession());

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WikiService,
        { provide: SessionService, useValue: { session: sessionSig } },
        { provide: WIKI_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WikiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the catalogue with the session cookie and returns all three fields', async () => {
    const promise = service.brandCatalog();
    const req = httpMock.expectOne('/bff/wiki/superadmin/brands');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials)
      .withContext('the HttpOnly bff_ cookie is the only credential the browser holds')
      .toBeTrue();
    req.flush({ brands: ['acme', 'globex'], launchDomain: 'hugmesh', targetDomainHonoured: true });
    expect(await promise).toEqual({
      brands: ['acme', 'globex'], launchDomain: 'hugmesh', targetDomainHonoured: true,
    });
  });

  it('applies the SAME sentinel filter as the observed source', async () => {
    // The server already filters these out, so this is defence in depth — but if a
    // server-side regression ever started emitting `default`, the picker would offer a
    // guaranteed 400, which is the one thing it exists to prevent.
    const promise = service.brandCatalog();
    httpMock.expectOne('/bff/wiki/superadmin/brands')
      .flush({ brands: ['default', '__deny__', '  ', ' acme ', 7], targetDomainHonoured: true });
    expect((await promise).brands).toEqual(['acme']);
  });

  it('treats every field as optional, because the generated model marks them so', async () => {
    const promise = service.brandCatalog();
    httpMock.expectOne('/bff/wiki/superadmin/brands').flush({});
    expect(await promise).toEqual({ brands: [], launchDomain: null, targetDomainHonoured: false });
  });

  it('only honours targetDomain on a literal true, never on a truthy value', async () => {
    const promise = service.brandCatalog();
    httpMock.expectOne('/bff/wiki/superadmin/brands')
      .flush({ brands: ['acme'], targetDomainHonoured: 'yes' });
    expect((await promise).targetDomainHonoured)
      .withContext('rendering a live picker on a coerced string would offer a discarded choice')
      .toBeFalse();
  });

  it('REJECTS on a denial — unlike observedBrands, which degrades silently', async () => {
    const promise = service.brandCatalog();
    httpMock.expectOne('/bff/wiki/superadmin/brands')
      .flush({ message: 'Access Denied' }, { status: 403, statusText: 'Forbidden' });
    await expectAsync(promise).toBeRejectedWithError(WikiApiError, /Access Denied/);
  });

  it('rejects on a transient failure too, so the console can fall back rather than show none', async () => {
    const promise = service.brandCatalog();
    httpMock.expectOne('/bff/wiki/superadmin/brands')
      .flush('boom', { status: 503, statusText: 'Service Unavailable' });
    await expectAsync(promise).toBeRejected();
  });
});

/**
 * BRAND SUGGESTIONS — {@link WikiService.observedBrands}, now the FALLBACK half of the
 * issue-#3 picker: what the console uses when the catalogue above cannot be read. It unions
 * the server-stamped `domain` of the two SUPERADMIN cross-domain reads the console already
 * makes. The specs pin the two properties that mode depends on: it is a SUBSET (so the field
 * must stay typeable there) and it NEVER rejects (so absent suggestions are not an error the
 * operator is asked to act on).
 */
describe('WikiService — observed brands (the picker source, not an authority)', () => {
  let service: WikiService;
  let httpMock: HttpTestingController;
  const sessionSig = signal<SnapSession | null>(adminSession());

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WikiService,
        { provide: SessionService, useValue: { session: sessionSig } },
        { provide: WIKI_BASE_URL, useValue: '' },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WikiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function accessRow(domain: string): WikiAccess {
    return {
      id: domain, domain, userSubject: 'u', accessType: 'read', state: 'active',
      grantedBySubject: 'a', reason: null, createdAt: '', expiresAt: null, revokedAt: null,
    };
  }

  it('unions both SUPERADMIN cross-domain reads, de-duplicated and sorted', async () => {
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access')
      .flush({ access: [accessRow('brandx'), accessRow('branda')] });
    httpMock.expectOne('/bff/wiki/superadmin/audit')
      .flush({ actions: [{ domain: 'brandx' }, { domain: 'brandm' }] });
    expect(await promise).toEqual(['branda', 'brandm', 'brandx']);
  });

  it('picks up a brand only the audit trail has seen (no override rows yet)', async () => {
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access').flush({ access: [] });
    httpMock.expectOne('/bff/wiki/superadmin/audit').flush({ actions: [{ domain: 'brandonly' }] });
    expect(await promise).toEqual(['brandonly']);
  });

  it('drops blank/absent/non-string domains rather than offering them', async () => {
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access')
      .flush({ access: [accessRow('  '), accessRow(' brandt ')] });
    httpMock.expectOne('/bff/wiki/superadmin/audit')
      .flush({ actions: [{ action: 'wiki.page.create' }, { domain: 7 }] });
    expect(await promise).toEqual(['brandt']);
  });

  it('never suggests the bff sentinels "default"/"__deny__" (isKnownDomain rejects them)', async () => {
    // A SUPERADMIN's OWN content actions stamp `default` audit rows
    // (WikiAuditLogRepository#record coerces their null scope), and a
    // fail-closed `__deny__` scope is written through onto an access row
    // (PrincipalDomain#forScope). Both 400 as a targetDomain, so neither may
    // ever reach the datalist — a suggestion the server always rejects is worse
    // than no suggestion at all.
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access')
      .flush({ access: [accessRow('default'), accessRow('__deny__'), accessRow('brandt')] });
    httpMock.expectOne('/bff/wiki/superadmin/audit')
      .flush({ actions: [{ domain: 'default' }, { domain: 'brandt' }] });
    expect(await promise)
      .withContext('a sentinel always 400s as a targetDomain, so it must never be offered')
      .toEqual(['brandt']);
  });

  it('resolves EMPTY when the only observed domain is the default sentinel', async () => {
    // The single-issuer-migrated cluster: every legacy row is `default`. The
    // honest state is "no brands observed yet", NOT one unusable suggestion.
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access').flush({ access: [accessRow('default')] });
    httpMock.expectOne('/bff/wiki/superadmin/audit').flush({ actions: [{ domain: 'default' }] });
    expect(await promise).toEqual([]);
  });

  it('still returns the other source when ONE read is denied (403)', async () => {
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne('/bff/wiki/superadmin/audit').flush({ actions: [{ domain: 'brandb' }] });
    expect(await promise).toEqual(['brandb']);
  });

  it('resolves EMPTY rather than rejecting when BOTH reads fail (a convenience, not a gate)', async () => {
    const promise = service.observedBrands();
    httpMock.expectOne('/bff/wiki/superadmin/access')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne('/bff/wiki/superadmin/audit')
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    await expectAsync(promise).toBeResolvedTo([]);
  });
});

/**
 * The shared "may this be offered as a brand suggestion?" rule. It has TWO call
 * sites now — {@link WikiService.observedBrands} (brands read back from the two
 * SUPERADMIN cross-domain surfaces) and the access console's learn-from-the-applied-row
 * path — so it is pinned directly, not only through one of them: a sentinel that
 * slipped past either site would be a suggestion the bff answers 400 to, forever.
 */
describe('suggestableBrand (the one filter both suggestion sources use)', () => {
  it('accepts and trims a real brand', () => {
    expect(suggestableBrand('  brandx  ')).toBe('brandx');
  });

  it('rejects every DOMAIN_SENTINEL, including with surrounding whitespace', () => {
    for (const sentinel of DOMAIN_SENTINELS) {
      expect(suggestableBrand(sentinel)).withContext(sentinel).toBeNull();
      expect(suggestableBrand(` ${sentinel} `)).withContext(`padded ${sentinel}`).toBeNull();
    }
  });

  it('rejects blank, absent and non-string values (every generated field is optional)', () => {
    expect(suggestableBrand('')).toBeNull();
    expect(suggestableBrand('   ')).toBeNull();
    expect(suggestableBrand(undefined)).toBeNull();
    expect(suggestableBrand(null)).toBeNull();
    expect(suggestableBrand(7)).toBeNull();
  });
});
