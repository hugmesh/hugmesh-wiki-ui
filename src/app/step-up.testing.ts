import { Component, Provider, Type, output } from '@angular/core';

import { LOGIN_STEP_UP_LOADER, LoginMfaStepUpComponent } from './mfa-step-up';
import { WikiApiError } from './wiki.service';

/**
 * Spec support for the step-up offer on writes (hugmesh-wiki-ui#4). Not part of
 * the app bundle: only `*.spec.ts` files import it.
 */

/** A stand-in for login-ui's federated MFA dialog. */
@Component({ selector: 'fake-login-mfa', standalone: true, template: '<p data-testid="fake-dialog">dialog</p>' })
export class FakeStepUpDialog {
  static readonly instances: FakeStepUpDialog[] = [];
  constructor() {
    FakeStepUpDialog.instances.push(this);
  }
  readonly satisfied = output<void>();
  readonly dismissed = output<void>();
  readonly unavailable = output<void>();

  /** The most recently mounted dialog. */
  static last(): FakeStepUpDialog {
    const d = FakeStepUpDialog.instances[FakeStepUpDialog.instances.length - 1];
    if (!d) throw new Error('no step-up dialog was mounted');
    return d;
  }
}

/** Counts how often the federated module was asked for. */
export const stepUpLoads = { count: 0 };

/** Resets {@link FakeStepUpDialog} and {@link stepUpLoads}; call in beforeEach. */
export function resetStepUpFakes(): void {
  FakeStepUpDialog.instances.length = 0;
  stepUpLoads.count = 0;
}

/** Provides the fake dialog in place of login-ui's remote. */
export function provideFakeStepUpLoader(): Provider {
  return {
    provide: LOGIN_STEP_UP_LOADER,
    useValue: async () => {
      stepUpLoads.count++;
      return { loadMfaStepUpComponent: async () => FakeStepUpDialog as Type<LoginMfaStepUpComponent> };
    },
  };
}

/** wiki-bff-api's step-up refusal, as the service maps it (header recognised). */
export function stepUpRefusal(): WikiApiError {
  return new WikiApiError(403, 'wiki admin requires step-up re-authentication (present X-Wiki-StepUp)', {
    signal: 'X-Wiki-StepUp',
    via: 'signal',
  });
}

/** A 403 by ROLE: no step-up signal, so no offer. */
export function roleRefusal(): WikiApiError {
  return new WikiApiError(403, 'forbidden');
}

/** Drain renders, zone tasks and stray microtasks until the view has settled. */
export async function settleFixture(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 5; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
  fixture.detectChanges();
}
