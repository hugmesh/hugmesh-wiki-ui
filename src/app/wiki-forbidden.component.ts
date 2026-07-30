import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SessionService } from './session.service';

/**
 * The within-wiki privilege-boundary screen. Reached when a child guard denies
 * activation (a MOD without ROLE_WIKI hitting content; a MOD/ADMIN hitting a
 * SUPERADMIN-only view). NOT an auth failure — the host already authgated the
 * user in — so this explains the MISSING role rather than bouncing to /login,
 * and offers a route back to the content view when the user can read.
 *
 * It mirrors how the bff handles the authoritative denial (a 403 from the
 * @PreAuthorize / WikiAccessGuard): the UI gating only HIDES options; this screen
 * is the graceful landing when a deeper gate says no.
 */
@Component({
  selector: 'hug-wiki-forbidden',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './wiki-forbidden.component.html',
  styleUrl: './wiki-forbidden.component.scss',
})
export class WikiForbiddenComponent {
  private readonly session = inject(SessionService);

  /** Whether to offer the "Back to content" link (only if the user can read). */
  readonly canRead = this.session.canRead;
}
