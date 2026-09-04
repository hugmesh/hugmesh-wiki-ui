import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { WikiService, WikiAccess, WikiApiError, suggestableBrand } from './wiki.service';
import { SessionService } from './session.service';

type AccessAction = 'grant' | 'timeout' | 'ban';

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
 * The field is a COMBOBOX, not free text: it offers the brands this console can observe
 * (see {@link brandOptions}) while still accepting a typed value. It cannot be a closed
 * select — the bff serves no known-brands endpoint, so the suggestions are a SUBSET of its
 * trusted DomainRegistry and a brand with no observable row would otherwise be untypeable.
 * The bff therefore stays the authority: it validates the value against the registry and a
 * 400 is surfaced verbatim, so an unknown brand is still caught server-side.
 * The suggestions also LEARN: every applied row comes back with its server-stamped
 * `domain`, and for a SUPERADMIN write the bff reached the insert only by validating that
 * brand against the registry — so a brand typed once (necessarily, the first time it is
 * used: no row of it existed to observe) is a suggestion for the rest of the session. See
 * {@link learnBrand}. Until hugmesh-wiki-bff-api#12 serves the authoritative list, this is
 * the closest the console gets: it can never be complete, and never claims to be.
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
export class WikiAccessComponent implements OnInit {
  private readonly wiki = inject(WikiService);
  private readonly session = inject(SessionService);

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

  /** Brand suggestions for the target-brand combobox — the brands observable from
   *  the SUPERADMIN cross-domain reads (WikiService.observedBrands). A SUBSET of the
   *  bff's DomainRegistry, so the control stays typeable; empty is a valid state
   *  (nothing observed yet, or the reads were denied) and is NOT an error. */
  readonly brandOptions = signal<readonly string[]>([]);

  /** True while the suggestion reads are in flight (the field stays usable). */
  readonly brandsLoading = signal(false);

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

  /**
   * Load the target-brand suggestions — ONLY for a SUPERADMIN, the only role the
   * field is rendered for and the only role the cross-domain source reads admit.
   * A scoped ADMIN never fires them (they would 403, and the field is inert for
   * them anyway).
   */
  ngOnInit(): void {
    if (this.showTargetDomain()) void this.loadBrands();
  }

  /**
   * Fetch the observable brands for the combobox datalist.
   * Never surfaces an error: {@link WikiService.observedBrands} resolves to an
   * empty list rather than rejecting, and the field is fully usable as free text
   * with no suggestions at all.
   */
  async loadBrands(): Promise<void> {
    this.brandsLoading.set(true);
    try {
      this.brandOptions.set(await this.wiki.observedBrands());
    } finally {
      this.brandsLoading.set(false);
    }
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
   * Whether the form is valid and may be submitted.
   *
   * @returns `true` when the user subject is non-empty, and — for timeout —
   *   the hours value is positive.
   */
  formValid(): boolean {
    if (this.userSubject().trim().length === 0) return false;
    if (this.action() === 'timeout' && !(this.timeoutHours() > 0)) return false;
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
    const target = this.showTargetDomain() ? this.targetDomain().trim() : '';
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
    const brand = suggestableBrand(domain);
    if (!brand) return;
    this.brandOptions.update((opts) =>
      opts.includes(brand) ? opts : [...opts, brand].sort((a, b) => a.localeCompare(b)),
    );
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
