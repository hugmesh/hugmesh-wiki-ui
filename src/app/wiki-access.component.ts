import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { WikiService, WikiAccess, WikiApiError } from './wiki.service';
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
 * The brand list is NOT knowable client-side — the bff validates the value against its
 * trusted DomainRegistry and a 400 is surfaced verbatim, so an unknown brand is caught
 * server-side rather than guessed at here.
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
