import { Component, DestroyRef, NgZone, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { WikiService, WikiAccess, WikiApiError, suggestableBrand, BrandCatalog } from './wiki.service';
import { SessionService } from './session.service';

type AccessAction = 'grant' | 'timeout' | 'ban';

/**
 * How the target-brand control should render — decided by what the bff's brand catalogue
 * says, never guessed. The rule the whole type exists to keep: **never offer a brand the
 * server will not honour**, because a picker whose choice is discarded is worse than no
 * picker (the operator believes they targeted brand X and the row lands elsewhere,
 * silently).
 *
 * - `loading` — the catalogue read is in flight. The control is NOT rendered yet: showing a
 *   free-text box that turns into a closed select underneath a half-typed value is how a
 *   typed brand gets silently discarded. This mode is BOUNDED — a read that has not answered
 *   within `catalogueDeadlineMs` degrades to `observed`, because "no control at all" must
 *   never be the resting state of a console a SUPERADMIN needs to act from.
 * - `picker` — the catalogue answered and the bff DOES consult `targetDomain`. A closed
 *   `<select>` over the authoritative list, preselected to the launch domain when that is
 *   one of the options, and required (the bff 400s a SUPERADMIN write with no brand).
 * - `inert` — the bff ignores `targetDomain` and has no brands to offer: a single-issuer
 *   deployment, where every principal is `default` and a SUPERADMIN write stamped `default`
 *   is CORRECT. Nothing to choose, so nothing is rendered but a one-line explanation.
 * - `inert-mismatch` — the bff ignores `targetDomain` but DOES have a real brand. That is
 *   the exactly-one-configured-issuer shape: users resolve that brand while a SUPERADMIN
 *   write is stamped `default`, so the change silently never applies
 *   (hugmesh-wiki-bff-api#21). A control here would be a lie in both directions, so the
 *   console warns instead of offering one.
 *
 *   THIS MODE HAS A KNOWN EXPIRY DATE, and whoever closes #21 must retire it in the same
 *   commit. The operator ANSWERED #21 on 2026-09-16 — *"Fix: stamp the configured brand.
 *   Exactly one configured issuer pair counts as a real brand; SUPERADMIN writes stamp it;
 *   a mismatched targetDomain becomes a 400 instead of a silent no-op."* Once that lands,
 *   `targetDomainHonoured` (today `DomainRegistry.isMultiIssuer()`) becomes true at exactly
 *   one pair, this mode stops being reachable there, and its on-screen copy — "A superadmin
 *   change made here is recorded against the legacy default brand instead" — would be FALSE
 *   if it ever rendered. Nothing fails if the two repos drift apart, which is why the bff
 *   pins the list of five artefacts that must move together in `WikiBrandCatalog`'s javadoc
 *   and on #21; this component's modes are item 5 of that list.
 * - `observed` — the catalogue read FAILED. Falls back to the previous behaviour: a
 *   combobox over the brands this console can observe. Strictly a subset, so the field
 *   stays typeable and the bff's 400 stays the gate.
 */
type BrandMode = 'loading' | 'picker' | 'inert' | 'inert-mismatch' | 'observed';

/**
 * Union two brand-suggestion lists into one sorted, de-duplicated list.
 *
 * Every producer of suggestions folds through this: the observation read and the
 * learn-on-write path both run against a list the other may already have grown,
 * and neither may clobber the other's entries.
 *
 * @param a - The existing suggestions.
 * @param b - The suggestions to fold in.
 * @returns The de-duplicated union, sorted for a stable datalist order.
 */
function mergeBrands(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

/**
 * The ACCESS console — the grant / timeout / ban / restore overlay over
 * /bff/wiki/admin/access/** (WikiAccessController). Write-gated (wikiWriteGuard:
 * WIKI_WRITE = ADMIN|SUPERADMIN); a MOD reader never reaches it.
 *
 *   grant   → POST /bff/wiki/admin/access/grant   (a permanent read grant)
 *   timeout → POST /bff/wiki/admin/access/timeout (a bounded ban; auto-restores)
 *   ban     → POST /bff/wiki/admin/access/ban     (a permanent ban; denies even
 *             a role-holder/grantee — the ban-precedence the bff WikiAccessGuard
 *             enforces, surfaced clearly in the UI)
 *   restore → DELETE /bff/wiki/admin/access/banned/{user}  (lift a ban)
 *   remove  → DELETE /bff/wiki/admin/access/read/{user}    (remove a grant)
 *
 * ── Cross-brand target (SUPERADMIN only) ──
 * A scoped ADMIN always writes into their OWN brand: the bff derives it from the
 * validated JWT issuer and IGNORES any body-supplied domain, so no target field is
 * shown to them (it would be inert). A SUPERADMIN is cross-domain and has NO brand of
 * their own to stamp, so on a MULTI-BRAND deployment the bff requires them to name the
 * victim's brand via `targetDomain` and FAILS CLOSED (400) otherwise — rather than
 * stamping the row `default`, where the read guard would never match it (wiki-bff-api
 * PR #39). The field is therefore rendered ONLY for a SUPERADMIN, and sent only when
 * filled: left blank it reproduces the previous behaviour exactly (fine on a
 * single-issuer cluster, where the bff ignores the field and keeps `default`).
 * The control is now a real PICKER, because the bff finally serves the list it validates
 * against: `GET /bff/wiki/superadmin/brands` (hugmesh-wiki-bff-api#12) returns
 * `DomainRegistry.knownDomains()` filtered through the very predicate `writeDomain` calls,
 * so every option is accepted BY CONSTRUCTION rather than merely likely. What the catalogue
 * says decides how the control renders — see {@link BrandMode}, and the one rule behind all
 * five of its cases: NEVER OFFER A BRAND THE SERVER WILL NOT HONOUR. A picker whose choice
 * is silently discarded is worse than no picker at all.
 *
 * That rule is why two of the modes render no control. The bff reads `targetDomain` only
 * when two or more issuers are configured; below that a SUPERADMIN write is stamped
 * `default` whatever the body said. With exactly one configured issuer that is a live
 * hazard rather than a harmless no-op (users resolve the configured brand, the write lands
 * in `default`, and the read guard never matches it — hugmesh-wiki-bff-api#21), so the
 * console warns instead of offering a control.
 *
 * The picker is PRESELECTED to the domain the wiki is launched on, per the operator's
 * steer that the wiki follows the domain it is launched on — but only when the server would
 * accept that value, because on a 2+-brand deployment there is no single launch domain and
 * the bff reports its `hugmesh` fallback instead.
 *
 * If the catalogue read FAILS the field degrades to what it was before the endpoint
 * existed: a datalist COMBOBOX over the brands this console can observe
 * (see {@link brandOptions}), which is a strict SUBSET of the registry — so it stays
 * typeable, the bff's 400 stays the real gate, and the suggestions LEARN from the
 * server-stamped `domain` of every applied row (see {@link learnBrand}). Losing the control
 * entirely on a denied or flaky read would leave a SUPERADMIN unable to act at all.
 *
 * a11y: a labelled fieldset for the action form; each control has a <label> +
 * aria-describedby help; the result/error is announced (role="status"/"alert");
 * a clear note that BAN takes precedence over any grant or role. The applied result
 * echoes the BRAND the row actually landed in, so a SUPERADMIN can confirm the write
 * targeted the intended tenant.
 */
@Component({
  selector: 'hug-wiki-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './wiki-access.component.html',
  styleUrl: './wiki-access.component.scss',
})
export class WikiAccessComponent {
  private readonly wiki = inject(WikiService);
  private readonly session = inject(SessionService);
  private readonly zone = inject(NgZone);

  readonly action = signal<AccessAction>('grant');
  readonly userSubject = signal('');
  readonly reason = signal('');
  /** timeout duration in hours (converted to ttlSeconds on submit). */
  readonly timeoutHours = signal(24);
  /** The victim's brand for a SUPERADMIN cross-brand write; blank = don't send.
   *  Inert for a scoped ADMIN (the bff ignores it), so the control is not shown
   *  to one — see {@link showTargetDomain}. */
  readonly targetDomain = signal('');

  /** WIKI_MANAGE = SUPERADMIN: only a cross-domain actor can target another brand,
   *  so only they are offered the field (defence-in-depth/convenience — the bff is
   *  authoritative and ignores the field for a scoped ADMIN regardless). */
  readonly showTargetDomain = this.session.canManage;

  /** The brands offered for the target-brand control. In {@link BrandMode} `picker` these
   *  are AUTHORITATIVE (the bff's own registry, every one of them accepted by construction);
   *  in `observed` they are suggestions only — a SUBSET of that registry, which is why that
   *  mode keeps the control typeable. Empty is a valid state in both and is NOT an error. */
  readonly brandOptions = signal<readonly string[]>([]);

  /** True while a brand read is in flight — the catalogue, or the observed suggestions
   *  behind the fallback combobox (which renders immediately and fills in when they land). */
  readonly brandsLoading = signal(false);

  /**
   * How long (ms) to wait for the brand catalogue before giving up on it and degrading to
   * the observed combobox.
   *
   * This exists because the control's very EXISTENCE hangs off one HTTP read: `loading`
   * renders no control at all, deliberately (see {@link BrandMode}), so a read that never
   * settles would leave a SUPERADMIN with LESS than they had before this endpoint existed —
   * a permanent "Loading the brands this server accepts…" and no way to act at all. A
   * REJECTED read already fell back; a HUNG one now does too.
   *
   * A plain field rather than a constant so a spec can drive the deadline without waiting
   * on the real one: set it between `createComponent` and the first `detectChanges`, which
   * is when the read is fired.
   */
  catalogueDeadlineMs = 8_000;

  /** Latches once the control's SHAPE has been decided — by the catalogue, by its failure,
   *  or by {@link catalogueDeadlineMs} elapsing. A read that answers after the deadline must
   *  NOT swap a usable combobox out from under a half-typed value; that is the same hazard
   *  `loading` renders no control to avoid. */
  private brandsDecided = false;

  /** Latches once the catalogue read has been FIRED, so the reactive guard in the
   *  constructor can fire it late (a session that gains SUPERADMIN after this component
   *  initialised) without ever firing it twice. */
  private brandsRequested = false;

  /** The {@link catalogueDeadlineMs} timer, cleared when the read settles and when the
   *  component is destroyed so it can outlive neither. */
  private deadline: ReturnType<typeof setTimeout> | null = null;

  /** How the target-brand control renders — see {@link BrandMode}. Starts `loading` so the
   *  control is not rendered before the server has said which kind of control is honest. */
  readonly brandMode = signal<BrandMode>('loading');

  /** The brand this wiki is LAUNCHED on, as the bff derives it (the same derivation its 007
   *  re-stamp target uses, falling back to `hugmesh`). Used to preselect the picker — but
   *  only when it is one of {@link brandOptions}: on a 2+-brand deployment there is no single
   *  launch domain and the bff reports its fallback, which is not a targetable brand. */
  readonly launchDomain = signal<string | null>(null);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<WikiAccess | null>(null);
  readonly notice = signal('');
  readonly touched = signal(false);

  readonly actions: ReadonlyArray<{ value: AccessAction; label: string; help: string }> = [
    { value: 'grant', label: 'Grant read', help: 'Give a user permanent wiki read access.' },
    { value: 'timeout', label: 'Time out', help: 'Block a user from wiki read for a bounded window; access auto-restores when it expires.' },
    { value: 'ban', label: 'Ban', help: 'Permanently block a user from wiki read. A ban takes precedence over any grant or role.' },
  ];

  constructor() {
    /*
     * Load the brand catalogue — ONLY for a SUPERADMIN, the only role the field is rendered
     * for and the only role the endpoint admits. A scoped ADMIN never fires it (it would
     * 403, and the field is inert for them anyway: the bff derives their brand from their
     * JWT and ignores any body-supplied domain).
     *
     * REACT to the session, never snapshot it. {@link showTargetDomain} is
     * `session.canManage`, a LIVE signal: SessionService re-reads `hug.session` on its
     * same-document broadcast and on a cross-tab `storage` event, so the role can arrive
     * AFTER this component initialises. An `ngOnInit` `if` read that signal exactly once,
     * and when it read false the template's `@if` could still flip on later with the mode
     * stuck at `loading` — a SUPERADMIN looking at "Loading…" forever, with no control at
     * all, where the pre-catalogue console gave them a working free-text field.
     *
     * Fires at most ONCE ever ({@link brandsRequested}).
     */
    effect(() => {
      if (!this.showTargetDomain() || this.brandsRequested) return;
      this.brandsRequested = true;
      void this.loadBrands();
    });
    inject(DestroyRef).onDestroy(() => this.clearDeadline());
  }

  /**
   * Fetch the AUTHORITATIVE brand catalogue and decide how the control renders, falling back
   * to the observed suggestions when that read FAILS or does not answer in time.
   *
   * Neither fallback is a formality. Without them a denied, flaky or HUNG catalogue read
   * would leave a SUPERADMIN with no control at all and no way to act; with them the field
   * is exactly what it was before the endpoint existed — a typeable combobox whose
   * suggestions are a subset, with the bff's 400 as the real gate.
   *
   * Never rejects: it is fired from an effect, un-awaited.
   */
  async loadBrands(): Promise<void> {
    this.brandsLoading.set(true);
    // OUTSIDE the Angular zone deliberately: a pending macrotask inside it keeps the zone
    // unstable, which would make every spec's `whenStable()` wait out the real deadline.
    // A signal write from the handler still schedules change detection — Angular's
    // scheduler is not zone-gated.
    this.deadline = this.zone.runOutsideAngular(() =>
      setTimeout(() => void this.fallBackToObserved(), this.catalogueDeadlineMs),
    );
    let catalog: BrandCatalog;
    try {
      catalog = await this.wiki.brandCatalog();
    } catch {
      // A 403 (not a SUPERADMIN) or a transient failure — NOT "the server says there are
      // no brands", which is a 200 with an empty list and is handled below.
      this.clearDeadline();
      await this.fallBackToObserved();
      return;
    }
    this.clearDeadline();
    // The deadline already chose the combobox, and the operator may have typed in it.
    if (this.brandsDecided) return;
    this.brandsDecided = true;
    this.applyCatalog(catalog);
    this.brandsLoading.set(false);
  }

  /**
   * Degrade to the observed combobox — the pre-catalogue behaviour — because the catalogue
   * read failed or ran past {@link catalogueDeadlineMs}. Idempotent, and never rejects.
   */
  private async fallBackToObserved(): Promise<void> {
    if (this.brandsDecided) return;
    this.brandsDecided = true;
    try {
      await this.loadObservedBrands();
    } catch {
      // observedBrands is documented and implemented never to reject (Promise.allSettled).
      // If that ever changed, the combobox is already on screen and fully usable with no
      // suggestions at all — the one thing this must never do is leave the control hidden.
    } finally {
      this.brandsLoading.set(false);
    }
  }

  /** Cancel the catalogue deadline; safe to call twice. */
  private clearDeadline(): void {
    if (this.deadline === null) return;
    clearTimeout(this.deadline);
    this.deadline = null;
  }

  /**
   * Turn a catalogue into a render mode, applying the one rule this component exists to
   * keep: never offer a brand the server will not honour.
   *
   * @param catalog - The bff's answer; see {@link BrandCatalog}.
   */
  private applyCatalog(catalog: BrandCatalog): void {
    this.launchDomain.set(catalog.launchDomain);
    this.brandOptions.set(catalog.brands);

    if (!catalog.targetDomainHonoured) {
      // The bff does not read `targetDomain` at all below two configured issuers — a
      // SUPERADMIN write is stamped `default` whatever the body says. Rendering a control
      // would promise something the server discards, so render none, and clear anything
      // already typed so a stale value cannot be sent under the impression it did something.
      this.targetDomain.set('');
      this.brandMode.set(catalog.brands.length > 0 ? 'inert-mismatch' : 'inert');
      return;
    }

    this.brandMode.set('picker');
    // Preselect the launch domain — the operator's steer is that the wiki follows the domain
    // it is launched on — but ONLY when the server would accept it. On a 2+-brand deployment
    // there is no single launch domain and the bff reports its `hugmesh` fallback, which is
    // not necessarily a configured brand; preselecting it there would preselect a guaranteed
    // 400. An operator's own pick always wins over the default.
    const chosen = this.targetDomain().trim();
    if (chosen && catalog.brands.includes(chosen)) return;
    const launch = catalog.launchDomain;
    this.targetDomain.set(launch !== null && catalog.brands.includes(launch) ? launch : '');
  }

  /**
   * The FALLBACK source: the brands this console can observe from the two SUPERADMIN
   * cross-domain reads. Never surfaces an error — {@link WikiService.observedBrands} resolves
   * to an empty list rather than rejecting, and the field is fully usable as free text with
   * no suggestions at all.
   */
  private async loadObservedBrands(): Promise<void> {
    // Mode FIRST, then the read: the fallback was decided the moment the catalogue read
    // failed, so the combobox should be on screen and usable while its suggestions load —
    // not hidden behind the loading placeholder until they arrive.
    this.brandMode.set('observed');
    const observed = await this.wiki.observedBrands();
    // FOLD, never SET. The constructor's effect fires this read WITHOUT awaiting it, so a write can
    // be applied — and its server-stamped brand learnt — while the read is still outstanding.
    // Replacing the list with the read's older snapshot would silently drop that brand, and
    // nothing would tell the operator it had gone.
    this.brandOptions.update((prev) => mergeBrands(prev, observed));
  }

  /**
   * Switch the active action tab and reset the result/error state so previous
   * outcomes from a different action do not remain visible.
   *
   * @param a - The action string from the segmented control (cast to {@link AccessAction}).
   */
  setAction(a: string): void {
    this.action.set((a as AccessAction) ?? 'grant');
    this.result.set(null);
    this.error.set('');
    this.notice.set('');
  }

  /**
   * The inline help text for the currently selected action, looked up from
   * {@link actions} so it always matches whichever action is selected — even
   * if the array is reordered or a new action is added.
   *
   * @returns The `help` string for the active action, or an empty string if
   *   somehow not found.
   */
  currentActionHelp(): string {
    return this.actions.find((a) => a.value === this.action())?.help ?? '';
  }

  /**
   * Whether the user-subject field should show its `aria-invalid` indicator.
   *
   * @returns `true` when touched and the subject field is blank.
   */
  userInvalid(): boolean {
    return this.touched() && this.userSubject().trim().length === 0;
  }

  /**
   * Whether the timeout-hours field should show its `aria-invalid` indicator.
   *
   * @returns `true` when the action is `timeout`, touched, and hours is not positive.
   */
  ttlInvalid(): boolean {
    return this.action() === 'timeout' && this.touched() && !(this.timeoutHours() > 0);
  }

  /**
   * Whether the target-brand picker should show its `aria-invalid` indicator.
   *
   * Only in {@link BrandMode} `picker`: that is the mode in which the bff has told us it
   * WILL read `targetDomain`, and `WikiAccessService.writeDomain` fails closed with a 400
   * when a SUPERADMIN names no brand there. Every other mode either does not render the
   * control or cannot know the value is required, so requiring one would block a write the
   * server would have accepted.
   *
   * @returns `true` when the picker is live, touched, and no brand is selected.
   */
  targetInvalid(): boolean {
    return this.brandMode() === 'picker' && this.touched()
      && this.targetDomain().trim().length === 0;
  }

  /**
   * Whether the form is valid and may be submitted.
   *
   * @returns `true` when the user subject is non-empty, — for timeout — the hours value is
   *   positive, and — when the brand picker is live — a target brand is selected.
   */
  formValid(): boolean {
    if (this.userSubject().trim().length === 0) return false;
    if (this.action() === 'timeout' && !(this.timeoutHours() > 0)) return false;
    // Catch the fail-closed 400 before the round-trip, but ONLY where the server told us it
    // reads the field. See targetInvalid().
    if (this.brandMode() === 'picker' && this.targetDomain().trim().length === 0) return false;
    return true;
  }

  /**
   * Submit the access action.
   * - grant   → POST /bff/wiki/admin/access/grant
   * - ban     → POST /bff/wiki/admin/access/ban
   * - timeout → POST /bff/wiki/admin/access/timeout (hours → ttlSeconds)
   * Populates `result` with the returned {@link WikiAccess} row on success.
   */
  async submit(): Promise<void> {
    this.touched.set(true);
    this.error.set('');
    this.notice.set('');
    this.result.set(null);
    if (!this.formValid()) return;
    this.busy.set(true);
    const user = this.userSubject().trim();
    const reason = this.reason().trim() || undefined;
    // Only a SUPERADMIN can target another brand, and only a non-blank value is
    // sent: omitting the key entirely (rather than sending an empty/undefined one)
    // keeps the wire body byte-identical to the previous behaviour when unused.
    // The mode gate is the second half of the same rule the picker enforces, and it is a
    // DENY-list on purpose: send unless the bff has TOLD us it discards the field. In the two
    // INERT modes it has, and a body carrying a brand the server discards invites the reader
    // of an audit log to believe the write was targeted when it was not. Everywhere else —
    // including before the catalogue has answered — the previous behaviour is unchanged, so
    // an unread catalogue can never cost a legitimate cross-brand write.
    const brandIsDiscarded =
      this.brandMode() === 'inert' || this.brandMode() === 'inert-mismatch';
    const target =
      this.showTargetDomain() && !brandIsDiscarded ? this.targetDomain().trim() : '';
    const brand = target ? { targetDomain: target } : {};
    try {
      let row: WikiAccess;
      switch (this.action()) {
        case 'grant':
          row = await this.wiki.grant({ userSubject: user, reason, ...brand });
          break;
        case 'ban':
          row = await this.wiki.ban({ userSubject: user, reason, ...brand });
          break;
        case 'timeout':
        default:
          // Convert hours to ttlSeconds for the BFF body.
          row = await this.wiki.timeout({
            userSubject: user,
            ttlSeconds: Math.round(this.timeoutHours() * 3600),
            reason,
            ...brand,
          });
          break;
      }
      this.result.set(row);
      this.learnBrand(row.domain);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Lift a ban and restore wiki read access.
   * Calls DELETE /bff/wiki/admin/access/banned/{user}.
   *
   * @param user - The Casdoor subject of the user to restore.
   */
  async restore(user: string): Promise<void> {
    await this.runRevoke('banned', user, `Ban lifted for ${user} — wiki read restored.`);
  }

  /**
   * Remove a read grant (revoke the explicit wiki-read overlay row).
   * Calls DELETE /bff/wiki/admin/access/read/{user}.
   *
   * @param user - The Casdoor subject of the user whose grant should be removed.
   */
  async removeGrant(user: string): Promise<void> {
    await this.runRevoke('read', user, `Read grant removed for ${user}.`);
  }

  /**
   * Shared revoke logic: call the DELETE endpoint and surface a success notice
   * or error message.
   *
   * @param type - `'read'` to remove a grant, `'banned'` to lift a ban.
   * @param user - The Casdoor subject of the target user.
   * @param ok - The success message to show in the live region.
   */
  private async runRevoke(type: 'read' | 'banned', user: string, ok: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.wiki.revoke(type, user);
      this.notice.set(ok);
      // Clear the previous result row so the template reflects the revoked state.
      this.result.set(null);
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Fold the brand a write actually landed in into the suggestion list.
   *
   * The row's `domain` is SERVER-STAMPED, and for a SUPERADMIN cross-brand write the
   * bff reaches the insert only after validating `targetDomain` against its trusted
   * DomainRegistry (`WikiAccessService.writeDomain`, which 400s otherwise) — so a
   * brand that comes BACK on a row is known-good. That makes it a better source than
   * the observed reads, which cannot see a brand until it already has a row: the very
   * first write into a brand must be typed, and only this stops the second one from
   * having to be typed again.
   *
   * Filtered through the shared {@link suggestableBrand}, so a single-issuer
   * deployment (where every row is stamped `default`) never gains a suggestion the
   * bff would reject. Only a SUPERADMIN is offered the field at all, so only they
   * learn: an ADMIN's rows carry their own issuer-derived brand and no control that
   * could ever show it.
   *
   * @param domain - The `domain` of the row the bff just returned.
   */
  private learnBrand(domain: unknown): void {
    if (!this.showTargetDomain()) return;
    // Only while the observed fallback is — or may still become — the source. Once the
    // catalogue has ANSWERED there is nothing to learn: in `picker` mode the list is the
    // server's own registry and already complete, so folding a row's brand in could only add
    // something the catalogue deliberately left out; in the inert modes the row is stamped
    // `default` (which suggestableBrand drops) and there is no control to grow. `loading` is
    // deliberately NOT excluded — the catalogue read is fired un-awaited, so a write can land
    // first, and refusing to learn then would depend on microtask ordering for its answer.
    // A brand learnt here is a SUGGESTION: applyCatalog SETS the authoritative list over it
    // (never folds), so the catalogue's answer replaces anything learnt while it was loading.
    const decided = this.brandMode();
    if (decided === 'picker' || decided === 'inert' || decided === 'inert-mismatch') return;
    const brand = suggestableBrand(domain);
    if (!brand) return;
    this.brandOptions.update((opts) => (opts.includes(brand) ? opts : mergeBrands(opts, [brand])));
  }

  /**
   * Map a caught error to a user-friendly message.
   * A 403 is surfaced explicitly — the server denied the action (BFF-enforced).
   *
   * @param e - The caught value (typically a {@link WikiApiError}).
   * @returns A localized error string for the template.
   */
  private message(e: unknown): string {
    if (e instanceof WikiApiError && e.isForbidden) {
      return 'The server denied this action — your role does not permit managing wiki access.';
    }
    // A 400 is the bff REJECTING the request on its merits — most notably the
    // fail-closed "a SUPERADMIN <verb> must target a known brand via targetDomain"
    // (WikiAccessService.writeDomain) and the body validation messages. These are
    // ACTIONABLE and name the exact field to fix, so surface the server's own text
    // instead of burying it under a generic "try again" the operator cannot act on
    // (retrying an unknown brand verbatim fails identically, forever).
    if (e instanceof WikiApiError && e.isBadRequest && e.message) {
      return e.message;
    }
    return 'Could not apply the access change. Please try again.';
  }
}
