import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { WikiService as GeneratedWikiService } from './api/services/wiki.service';
import { WikiAccessService as GeneratedWikiAccessService } from './api/services/wiki-access.service';
import { WikiAttachmentsService as GeneratedWikiAttachmentsService } from './api/services/wiki-attachments.service';
import { CreatePage as CreatePageModel } from './api/models/create-page';
import { UpdatePage as UpdatePageModel } from './api/models/update-page';
import { AuditEntry as AuditEntryModel } from './api/models/audit-entry';
import { AuditList as AuditListModel } from './api/models/audit-list';

declare global {
  // eslint-disable-next-line no-var
  var __HUG_WIKI_URL__: string | undefined;
}

/** Base URL of the wiki BFF. The fe-gateway proxies same-origin /bff/wiki/** to
 *  hugmesh-wiki-bff-api (the TIER 1 content store + grant/timeout/ban overlay),
 *  so the default is the empty string = same origin.
 *  `globalThis.__HUG_WIKI_URL__` lets the host override the target at runtime
 *  (mirrors the other remotes' __HUG_*_URL__ globals). */
export const WIKI_BASE_URL = new InjectionToken<string>('WIKI_BASE_URL', {
  factory: () => globalThis.__HUG_WIKI_URL__ ?? '',
});

// ---------------------------------------------------------------------------
// Contract — mirrors hugmesh-wiki-bff-api WikiDto + WikiAccessDto. These are
// the EXACT JSON shapes the bff returns; when its /v3/api-docs is captured,
// `npm run gen` regenerates src/app/api/ from openapi.json (the standard
// HugMesh datastore pattern) and this service becomes the thin wrapper over
// the generated client — the public method signatures here are the stable
// contract. See README "Typed API client".
// ---------------------------------------------------------------------------

/** WikiDto.PageSummary — the list view (omits the heavy content columns). */
export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  authorSubject: string;
  version: number;
  updatedAt: string;
}

/** WikiDto.PageList. */
export interface PageList {
  pages: PageSummary[];
}

/** WikiDto.Page — the full page (markdown + the bff-rendered HTML). */
export interface WikiPage {
  id: string;
  domain: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  contentHtml: string;
  authorSubject: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** WikiDto.CreatePage — POST /bff/wiki/admin/pages (author + domain stamped from JWT). */
export interface CreatePage {
  slug: string;
  title: string;
  contentMarkdown: string;
}

/** WikiDto.UpdatePage — PUT /bff/wiki/admin/pages/{slug}; expectedVersion drives
 *  the optimistic-concurrency 409. */
export interface UpdatePage {
  title: string;
  contentMarkdown: string;
  expectedVersion: number;
}

/** The publish response: { state:'published', slug, version }. */
export interface PublishResult {
  state: string;
  slug: string;
  version: number;
}

/** One wiki_attachment metadata row (WikiAttachmentController list/upload item —
 *  metadata ONLY, never the binary data). */
export interface WikiAttachment {
  id: string;
  filename: string;
  mimeType: string;
  createdAt: string;
}

/** GET /bff/wiki/pages/{slug}/attachments → { attachments: [metadata…] }. */
export interface AttachmentList {
  attachments: WikiAttachment[];
}

/** WikiAccessDto.Access — a wiki_access overlay row. accessType = 'read'|'banned';
 *  state = 'active'|'revoked'. expiresAt set (future) = a timeout; null = permanent. */
export interface WikiAccess {
  id: string;
  domain: string;
  userSubject: string;
  accessType: string;
  state: string;
  grantedBySubject: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** WikiAccessDto.AccessList. */
export interface AccessList {
  access: WikiAccess[];
}

/** WikiDto.AuditEntry — one `wiki_audit_log` row (the content-edit trail).
 *
 *  This is the GENERATED model, re-exported rather than re-declared: it comes from
 *  ng-openapi-gen over hugmesh-wiki-bff-api's committed OpenAPI spec, so it cannot
 *  drift from the bff the way a hand-written mirror can. Every property is optional
 *  because the spec marks no field required (springdoc emits no `required` list for
 *  a Java record) — `detail` really is nullable in the table, and the rest are
 *  populated on every row the bff writes. Read cells through
 *  {@link WikiService.auditTrail}'s consumers with a null-safe coercion.
 *
 *  Before wiki-ui#2 this surface was `Record<string, unknown>`: the bff returned an
 *  untyped `Map<String,Object>`, springdoc rendered it as an open object, and the
 *  generated client typed it as `{[key: string]: {}}`. The fix landed a real
 *  `AuditList`/`AuditEntry` schema on the bff. */
export type WikiAuditEntry = AuditEntryModel;

/** WikiDto.AuditList — `{ actions: [...] }`, newest first, bounded by `?limit`.
 *  The generated model (see {@link WikiAuditEntry}). */
export type AuditTrail = AuditListModel;

/** WikiAccessDto.GrantOrBan — POST .../access/grant and .../access/ban.
 *
 *  `targetDomain` is the VICTIM's brand, and is consulted by the bff ONLY for a
 *  SUPERADMIN cross-brand write (WikiAccessService.writeDomain): a scoped ADMIN's
 *  brand is always issuer-derived server-side, so the field is IGNORED for them and
 *  can never widen their reach. In MULTI-BRAND (multi-issuer) mode a SUPERADMIN MUST
 *  name a known brand — the bff FAILS CLOSED with a 400 rather than stamp the row
 *  `default`, where the read guard would never match it (the silent no-effect ban
 *  wiki-bff-api PR #39 closed). In single-issuer mode every principal is `default`
 *  and the field is ignored, so sending it is always safe. */
export interface GrantOrBan {
  userSubject: string;
  reason?: string;
  /** The victim's brand for a SUPERADMIN cross-brand write; max 64 chars (bff
   *  @Size). Omit for a scoped ADMIN — the bff derives their brand from the JWT. */
  targetDomain?: string;
}

/** WikiAccessDto.Timeout — POST .../access/timeout (banned override, future expiry).
 *  `targetDomain` carries the same contract as {@link GrantOrBan.targetDomain}. */
export interface TimeoutBody {
  userSubject: string;
  ttlSeconds: number;
  reason?: string;
  /** The victim's brand for a SUPERADMIN cross-brand timeout; see
   *  {@link GrantOrBan.targetDomain}. */
  targetDomain?: string;
}

/** The `slug` constraint the bff enforces (WikiDto.SLUG_PATTERN) — re-validated
 *  in the editor so the author gets an inline hint before the round-trip. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A typed error the service raises so components can surface the EXACT failure
 *  the bff returned — the 409 stale-edit / duplicate-slug and the 403 the
 *  @PreAuthorize / WikiAccessGuard returns are both rendered specifically. */
export class WikiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WikiApiError';
  }
  /** A 409 from create (duplicate slug) or update (stale expectedVersion). */
  get isConflict(): boolean {
    return this.status === 409;
  }
  /** A 403 from the @PreAuthorize composite or the WikiAccessGuard ban — the
   *  server-authoritative denial (the UI gating is only convenience). */
  get isForbidden(): boolean {
    return this.status === 403;
  }
  /** A 400 = the bff rejected the request on its merits: body validation, or the
   *  fail-closed "a SUPERADMIN <verb> must target a known brand via targetDomain"
   *  (WikiAccessService.writeDomain). The `message` names the field to fix, so
   *  callers surface it verbatim rather than as a generic failure. */
  get isBadRequest(): boolean {
    return this.status === 400;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Thin reactive wrapper over hugmesh-wiki-bff-api /bff/wiki/**. Auth rides on
 * the HttpOnly `bff_` session cookie (set server-side via Set-Cookie); the
 * gateway's BffCookieToBearerWebFilter mints the upstream Bearer from it, so the
 * browser only sends the cookie (credentials) — it holds no admin-capable token.
 * The host injects nothing and the module never renders a login form.
 *
 * The methods map 1:1 to the bff endpoints (see each method). The role gating is
 * UI-convenience (the views are guarded; the controls are role-shown) — the bff
 * @PreAuthorize + WikiAccessGuard are the AUTHORITATIVE gates, so every method
 * surfaces a 403 as a WikiApiError(403) the caller renders gracefully.
 */
@Injectable({ providedIn: 'root' })
export class WikiService {
  private readonly base = inject(WIKI_BASE_URL);

  /** The generated, typed ng-openapi-gen clients (src/app/api), generated from
   *  hugmesh-wiki-bff-api's committed OpenAPI spec. EVERY feature — content
   *  (list/get/create/update/publish + audit), the access overlay (grant/timeout/
   *  ban/revoke/list/history) and the per-page attachments — DELEGATES to these
   *  clients over Angular HttpClient; the HttpOnly `bff_` cookie is sent by the
   *  authInterceptor (withCredentials) wired in bootstrap.ts — the SAME credential
   *  the old hand-rolled fetch transport sent. The hand-rolled transport is gone. */
  private readonly content = inject(GeneratedWikiService);
  private readonly access = inject(GeneratedWikiAccessService);
  private readonly attachments = inject(GeneratedWikiAttachmentsService);

  constructor() {
    // Honour the runtime __HUG_WIKI_URL__ override (WIKI_BASE_URL) for all the
    // delegated calls: the generated clients' rootUrl defaults to '' (same
    // origin), matching the old fetch transport's default; point every client at
    // the same base so a host-overridden target applies uniformly.
    this.content.rootUrl = this.base;
    this.access.rootUrl = this.base;
    this.attachments.rootUrl = this.base;
  }

  /** Map a generated-client failure to the WikiApiError contract the components
   *  key off (isConflict/isForbidden/isNotFound + the server detail message),
   *  reproducing the old fetch transport's error handling EXACTLY: the bff
   *  returns a JSON {message|error} envelope on a non-2xx, surfaced as the
   *  WikiApiError message; a non-HttpErrorResponse (an unexpected client error)
   *  is rethrown untouched. */
  private mapHttpError(e: unknown): never {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as unknown;
      let detail = '';
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        const j = body as Record<string, unknown>;
        detail = (j['message'] as string) ?? (j['error'] as string) ?? '';
      }
      throw new WikiApiError(e.status, detail || `request failed: ${e.status}`);
    }
    throw e;
  }

  // ----- CONTENT: read (WIKI_READ) ----------------------------------------
  //
  // The CONTENT feature DELEGATES to the generated, typed content client
  // (this.content). The wire calls are identical to the old fetch transport —
  // the SAME same-origin /bff/wiki/** paths (generated rootUrl = this.base) and
  // the SAME HttpOnly bff_ cookie (sent withCredentials by the authInterceptor). The generated
  // models are weakly typed (all fields optional), so they are bridged to this
  // service's stable public types (PageList / WikiPage / PublishResult) with an
  // `as unknown as` cast at the delegation boundary; the consuming components
  // (wiki-pages / wiki-page-view / wiki-editor) need ZERO change.

  /** GET /bff/wiki/pages → WikiDto.PageList. */
  async listPages(): Promise<PageList> {
    const body = await this.content.wikiListPages().catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as PageList;
  }

  /** GET /bff/wiki/pages/{slug} → WikiDto.Page (markdown + rendered HTML). */
  async getPage(slug: string): Promise<WikiPage> {
    const body = await this.content.wikiGetPage({ slug }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as WikiPage;
  }

  // ----- CONTENT: write (WIKI_WRITE = ADMIN|SUPERADMIN) -------------------

  /** POST /bff/wiki/admin/pages → WikiDto.Page (version 1). 409 on duplicate slug. */
  async createPage(body: CreatePage): Promise<WikiPage> {
    const page = await this.content.wikiCreatePage({ body: body as unknown as CreatePageModel })
      .catch((e) => this.mapHttpError(e));
    return page as unknown as WikiPage;
  }

  /** PUT /bff/wiki/admin/pages/{slug} → WikiDto.Page (bumps version).
   *  409 when expectedVersion != the stored version (a stale/concurrent edit). */
  async updatePage(slug: string, body: UpdatePage): Promise<WikiPage> {
    const page = await this.content.wikiUpdatePage({ slug, body: body as unknown as UpdatePageModel })
      .catch((e) => this.mapHttpError(e));
    return page as unknown as WikiPage;
  }

  /** POST /bff/wiki/admin/pages/{slug}/publish → { state, slug, version }. */
  async publishPage(slug: string): Promise<PublishResult> {
    const body = await this.content.wikiPublishPage({ slug }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as PublishResult;
  }

  /** DELETE /bff/wiki/admin/pages/{slug} → 204 no-content. The bff cascades to
   *  the page's attachments and audits the removal; resolve = deleted. 404 when
   *  the slug is not in the caller's brand. */
  async deletePage(slug: string): Promise<void> {
    await this.content.wikiDeletePage({ slug }).catch((e) =>
      this.mapHttpError(e),
    );
  }

  // ----- ATTACHMENTS: read (WIKI_READ + the WikiAccessGuard overlay) -------
  //
  // WikiAttachmentController mirrors the page role model: list/download are
  // authenticated-read (the grant/timeout/ban overlay applies at request time,
  // exactly as for pages); upload/delete are WIKI_WRITE (ADMIN | SUPERADMIN)
  // under /bff/wiki/admin/**.

  /** GET /bff/wiki/pages/{slug}/attachments → { attachments: [metadata…] }. */
  async listAttachments(slug: string): Promise<AttachmentList> {
    const body = await this.attachments.wikiListAttachments({ slug }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as AttachmentList;
  }

  /** GET /bff/wiki/pages/{slug}/attachments/{filename} → the raw bytes. The
   *  generated client requests responseType 'blob', so the resolved body IS a
   *  Blob carrying the stored mime type (the generated signature says `string`
   *  only because the spec models binary as a string schema — bridged here). */
  async downloadAttachment(slug: string, filename: string): Promise<Blob> {
    const body = await this.attachments.wikiDownloadAttachment({ slug, filename }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as Blob;
  }

  // ----- ATTACHMENTS: write (WIKI_WRITE = ADMIN|SUPERADMIN) ----------------

  /** POST /bff/wiki/admin/pages/{slug}/attachments — multipart/form-data with
   *  the binary in the 'file' part (the RequestBuilder appends the File to a
   *  FormData, preserving its filename) → the saved metadata row. */
  async uploadAttachment(slug: string, file: File): Promise<WikiAttachment> {
    const body = await this.attachments.wikiUploadAttachment({ slug, body: { file } }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as WikiAttachment;
  }

  /** DELETE /bff/wiki/admin/pages/{slug}/attachments/{filename} → the bff's
   *  { state:'deleted', slug, filename } ack (not surfaced — resolve = deleted). */
  async deleteAttachment(slug: string, filename: string): Promise<void> {
    await this.attachments.wikiDeleteAttachment({ slug, filename }).catch((e) =>
      this.mapHttpError(e),
    );
  }

  // ----- ACCESS overlay: write (WIKI_WRITE) -------------------------------
  //
  // Delegated to the generated WikiAccessService (the same migration as the
  // content feature above): identical wire calls to the old fetch transport —
  // the SAME paths, bodies and the HttpOnly bff_ cookie (withCredentials) —
  // with the weakly-typed generated models bridged to this service's stable
  // public types at the delegation boundary.

  /** POST /bff/wiki/admin/access/grant → WikiAccessDto.Access (a permanent read grant). */
  async grant(body: GrantOrBan): Promise<WikiAccess> {
    const row = await this.access.wikiAccessGrant({ body }).catch((e) =>
      this.mapHttpError(e),
    );
    return row as unknown as WikiAccess;
  }

  /** POST /bff/wiki/admin/access/timeout → WikiAccessDto.Access (a bounded ban; auto-restores). */
  async timeout(body: TimeoutBody): Promise<WikiAccess> {
    const row = await this.access.wikiAccessTimeout({ body }).catch((e) =>
      this.mapHttpError(e),
    );
    return row as unknown as WikiAccess;
  }

  /** POST /bff/wiki/admin/access/ban → WikiAccessDto.Access (a permanent ban; denies even a role-holder). */
  async ban(body: GrantOrBan): Promise<WikiAccess> {
    const row = await this.access.wikiAccessBan({ body }).catch((e) =>
      this.mapHttpError(e),
    );
    return row as unknown as WikiAccess;
  }

  /** DELETE /bff/wiki/admin/access/{accessType}/{userSubject} — revoke an active
   *  override (CAS active->revoked, row retained = audit). accessType = 'read'
   *  (remove a grant) | 'banned' (restore a banned user). The generated
   *  RequestBuilder percent-encodes the subject path segment exactly as the old
   *  transport's encodeURIComponent did. */
  async revoke(accessType: 'read' | 'banned', userSubject: string): Promise<void> {
    await this.access.wikiAccessRevoke({ accessType, userSubject }).catch((e) =>
      this.mapHttpError(e),
    );
  }

  // ----- ACCESS overlay: manage (WIKI_MANAGE = SUPERADMIN) ----------------

  /** GET /bff/wiki/superadmin/access → WikiAccessDto.AccessList (all ACTIVE overrides). */
  async listActiveAccess(): Promise<AccessList> {
    const body = await this.access.wikiAccessListActive().catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as AccessList;
  }

  /** GET /bff/wiki/superadmin/access/{userSubject}/history → the full grant/ban
   *  HISTORY (active + revoked = audit) for a principal. */
  async accessHistory(userSubject: string): Promise<AccessList> {
    const body = await this.access.wikiAccessHistory({ userSubject }).catch((e) =>
      this.mapHttpError(e),
    );
    return body as unknown as AccessList;
  }

  /** GET /bff/wiki/superadmin/audit → {@link AuditTrail} — the wiki_audit_log
   *  content-edit trail, newest first.
   *
   *  TYPED against the generated client (wiki-ui#2): the bff now declares a real
   *  `AuditList`/`AuditEntry` schema, so `wikiAuditTrail()` already returns
   *  {@link AuditTrail} and this wrapper needs NO cast — the `as unknown as`
   *  every other method here still carries (their hand-written mirrors predate the
   *  generated models) is exactly what a typed schema removes. A shape change on
   *  the bff now breaks this build instead of silently reaching the template.
   *
   *  `limit` is the optional page size the bff clamps to [1, 1000]; leave it
   *  unset to take the server default (200, newest first) — an omitted limit
   *  sends no query param at all. */
  async auditTrail(limit?: number): Promise<AuditTrail> {
    return this.content.wikiAuditTrail({ limit }).catch((e) => this.mapHttpError(e));
  }

  // ----- BRAND SUGGESTIONS (WIKI_MANAGE = SUPERADMIN) ---------------------
  //
  // The wiki-bff exposes NO known-brands endpoint: the authoritative list lives
  // in its DomainRegistry (issuer -> brand, seeded from app.tenancy.issuers) and
  // is never served. Until it is (hugmesh-wiki-bff-api issue #12), the closest
  // honest source is OBSERVATION: the two SUPERADMIN cross-domain reads this
  // console already makes both stamp the row's server-derived `domain`.
  //
  //   GET /bff/wiki/superadmin/access          -> every brand's ACTIVE overrides
  //   GET /bff/wiki/superadmin/audit           -> every brand's content-edit trail
  //
  // That union is a SUBSET, never the registry: a brand with no override row and
  // no audit entry inside the bounded newest-first audit page is invisible here.
  // So this feeds a SUGGESTION list (a datalist combobox), never a closed select —
  // the operator must still be able to type a brand this has not seen, and the
  // bff stays the authority (it 400s an unknown brand, surfaced verbatim).

  /**
   * The brands this console can OBSERVE, for the SUPERADMIN target-brand
   * suggestions. Reads the two cross-domain SUPERADMIN surfaces in parallel and
   * unions their server-stamped `domain` values.
   *
   * Deliberately NEVER throws: the suggestions are a convenience over a field
   * that works as free text without them, so a 403 (not a SUPERADMIN) or a
   * transient failure on either read degrades to fewer suggestions — or none —
   * rather than an error the operator cannot act on.
   *
   * @returns The sorted, de-duplicated, non-blank brand names observed. A
   *   SUBSET of the bff's registry, never the whole of it.
   */
  async observedBrands(): Promise<string[]> {
    const [access, audit] = await Promise.allSettled([
      this.listActiveAccess(),
      this.auditTrail(),
    ]);
    const seen = new Set<string>();
    const add = (v: unknown): void => {
      if (typeof v === 'string' && v.trim().length > 0) seen.add(v.trim());
    };
    if (access.status === 'fulfilled') {
      for (const row of access.value.access ?? []) add(row.domain);
    }
    if (audit.status === 'fulfilled') {
      // `domain` is now a TYPED field, not a string index: wiki-ui#2 landed the
      // AuditList/AuditEntry schema on the bff (hugmesh-wiki-bff-api#13), so a
      // server-side rename breaks this build instead of silently emptying the
      // suggestion list. `add` still coerces, because every generated property is
      // optional (springdoc emits no `required` list for a Java record).
      for (const row of audit.value.actions ?? []) add(row.domain);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }
}
