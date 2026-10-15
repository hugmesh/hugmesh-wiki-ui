import {
  AfterViewInit,
  Component,
  OnDestroy,
  ViewContainerRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { LOGIN_STEP_UP_LOADER, mfaChallengeHref } from './mfa-step-up';

/**
 * The step-up offer (hugmesh-wiki-ui#4): mounts hugmesh-login-ui's federated MFA
 * dialog in place, and degrades to the `?returnTo=` link.
 *
 * It exists only while a step-up refusal is pending, so the federated module is
 * loaded on demand and never at bootstrap. The host decides what to do with the
 * outcome:
 * <ul>
 *   <li>{@link satisfied}: the caller's own session now carries a fresh stamp;
 *       retry the SAME action, unchanged. Nothing is handed back.</li>
 *   <li>{@link dismissed}: the user chose "Not now"; do not retry.</li>
 * </ul>
 * When the dialog cannot be loaded (no federation runtime, a moved remoteEntry, a
 * rejected import) or reports `unavailable` (MFA ships dark: the surface answers
 * 503), this component shows the link instead, with a "Not now" of its own because
 * the dark state of the dialog offers no way out.
 */
@Component({
  selector: 'hug-wiki-step-up',
  standalone: true,
  templateUrl: './wiki-step-up.component.html',
  styleUrl: './wiki-step-up.component.scss',
})
export class WikiStepUpComponent implements AfterViewInit, OnDestroy {
  private readonly load = inject(LOGIN_STEP_UP_LOADER);
  private readonly router = inject(Router);
  private readonly host = viewChild.required('dialogHost', { read: ViewContainerRef });

  /** The caller's session now carries a fresh MFA stamp. */
  readonly satisfied = output<void>();
  /** The offer ended without a stamp; do not retry. */
  readonly dismissed = output<void>();

  /** `loading` until the dialog is mounted or the fallback is chosen. */
  readonly state = signal<'loading' | 'dialog' | 'link'>('loading');
  /** The fallback link, fixed when the fallback is chosen. */
  readonly href = signal('');

  private gone = false;

  ngAfterViewInit(): void {
    void this.mount();
  }

  ngOnDestroy(): void {
    this.gone = true;
  }

  private async mount(): Promise<void> {
    try {
      const mod = await this.load();
      const component = await mod.loadMfaStepUpComponent();
      if (this.gone) return;
      const ref = this.host().createComponent(component);
      ref.instance.satisfied.subscribe(() => {
        ref.destroy();
        this.satisfied.emit();
      });
      ref.instance.dismissed.subscribe(() => {
        ref.destroy();
        this.dismissed.emit();
      });
      ref.instance.unavailable.subscribe(() => {
        ref.destroy();
        this.fallBack();
      });
      this.state.set('dialog');
    } catch {
      if (!this.gone) this.fallBack();
    }
  }

  private fallBack(): void {
    this.href.set(mfaChallengeHref(this.router.url));
    this.state.set('link');
  }
}
