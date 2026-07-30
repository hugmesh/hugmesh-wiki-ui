import { Injectable, signal, computed } from '@angular/core';

export interface SnapSession {
  id: string;                 // casdoor identity, e.g. google:alice@gmail.com
  label: string;              // display (email or discord handle)
  provider: 'google' | 'discord';
  roles: string[];
  registrationComplete: boolean;
}

/** Holds the logged-in session (persisted to localStorage) and derives the
 *  Casdoor-style role flags the wiki console gates its views on.
 *
 *  This is the canonical HugMesh SessionService (copied from hugmesh-mod-ui /
 *  hugmesh-admin-ui, the references with the full role-tier accessors) so this
 *  remote gates on the SAME JWT-derived signals as the other consoles. Roles are
 *  the lowercase Casdoor roles 'user'/'mod'/'admin'/'superadmin' (+ the per-service
 *  'wiki' access role).
 *
 *  ── The wiki role model (mirrors hugmesh-wiki-bff-api WikiController) ──
 *  WIKI_READ   = ADMIN | SUPERADMIN | (MOD AND WIKI)  → see content (read-only for a MOD).
 *  WIKI_WRITE  = ADMIN | SUPERADMIN                   → author content + grant/timeout/ban.
 *  WIKI_MANAGE = SUPERADMIN                           → list-all access + history + audit.
 *
 *  The signals here are DEFENCE-IN-DEPTH (convenience gating). The wiki-bff
 *  @PreAuthorize is authoritative; the UI never SHOWS an option the role cannot
 *  use, and still handles a 403 gracefully if the server disagrees. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = 'hug.session';
  private readonly channel = 'hug-session-change';
  readonly session = signal<SnapSession | null>(this.load());
  readonly loggedIn = computed(() => this.session() !== null);

  /** The raw Casdoor roles of the current session (empty when logged out). */
  private readonly roles = computed(() => this.session()?.roles ?? []);

  /** USER tier: every authenticated user. Casdoor always grants 'user'; we treat
   *  any logged-in session as the USER tier. */
  readonly isUser = computed(() => this.loggedIn());

  /** ADMIN tier: a Casdoor 'admin' role. (A SUPERADMIN is NOT automatically an
   *  admin in the raw role set — the wiki composites below add SUPERADMIN where
   *  the cascade requires it, matching the bff SpEL exactly.) */
  readonly isAdmin = computed(() => this.roles().includes('admin'));

  /** SUPERADMIN tier: a Casdoor 'superadmin' role. */
  readonly isSuperadmin = computed(() => this.roles().includes('superadmin'));

  /** MOD tier: a Casdoor 'mod' OR 'admin' role (matching the platform-wide
   *  defence-in-depth hasAnyRole('MOD','ADMIN')). */
  readonly isMod = computed(() => {
    const r = this.roles();
    return r.includes('mod') || r.includes('admin');
  });

  /** The per-service wiki access role (ROLE_WIKI) — the AND-half of the MOD read
   *  gate, and the role a granted USER carries. */
  readonly hasWikiRole = computed(() => this.roles().includes('wiki'));

  // ── Wiki role composites (mirror WikiController's WIKI_READ/WRITE/MANAGE) ──

  /** WIKI_WRITE = ADMIN | SUPERADMIN. Gates the content edit/create/publish
   *  controls AND the grant/timeout/ban (/bff/wiki/admin/access) console. */
  readonly canWrite = computed(() => this.isAdmin() || this.isSuperadmin());

  /** WIKI_MANAGE = SUPERADMIN. Gates the list-all + history (/bff/wiki/superadmin/
   *  access) view and the audit-trail (/bff/wiki/superadmin/audit) view. */
  readonly canManage = computed(() => this.isSuperadmin());

  /** WIKI_READ = ADMIN | SUPERADMIN | (MOD AND WIKI). Gates the content VIEW.
   *  A bare MOD without the 'wiki' role is NOT a reader (the AND a path-level
   *  hasAnyRole cannot express); a writer/manager is always a reader. */
  readonly canRead = computed(
    () => this.canWrite() || (this.isMod() && this.hasWikiRole()),
  );

  constructor() {
    // The host shell and each federated remote each hold their OWN SessionService
    // instance over the same localStorage key. Re-read on a same-document broadcast
    // (dispatched by whichever instance wrote) and on cross-tab storage events, so
    // every nav/guard reading this signal stays in sync.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => { if (e.key === this.key) this.session.set(this.load()); });
    }
  }

  private load(): SnapSession | null {
    try { const raw = localStorage.getItem(this.key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  set(s: SnapSession): void { localStorage.setItem(this.key, JSON.stringify(s)); this.session.set(s); this.broadcast(); }
  patch(p: Partial<SnapSession>): void { const s = this.session(); if (s) this.set({ ...s, ...p }); }
  clear(): void { localStorage.removeItem(this.key); this.session.set(null); this.broadcast(); }
  /** Notify the other in-page SessionService instances (host + remotes) to re-read. */
  private broadcast(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(this.channel)); }
}
