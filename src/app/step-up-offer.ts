import { signal } from '@angular/core';

import { WikiApiError } from './wiki.service';

/**
 * One pending step-up offer for a WRITE (hugmesh-wiki-ui#4).
 *
 * Every `/bff/wiki/admin/**` write sits behind the BFF's `SecurityConfig.stepUp`
 * when MFA ships enabled, so a write can be refused for want of a fresh MFA stamp
 * as well as by role. A component that issues such a write holds one of these:
 *
 * <ol>
 *   <li>its `catch` hands the error and a retry to {@link offer}. Only a step-up
 *       refusal ({@link WikiApiError#isStepUpRequired}) is taken; a role 403 and
 *       every other failure are left to the component's existing message.</li>
 *   <li>its template renders `hug-wiki-step-up` while {@link open} is true, wired
 *       to {@link satisfy} and {@link dismiss}.</li>
 * </ol>
 *
 * The retry is a closure over the arguments of the call that was REFUSED, captured
 * at refusal time, never a re-read of the form or the route: what is retried is the
 * write the user asked for, even if a field or the route slug has moved since.
 *
 * {@link satisfy} runs it once and forgets it; {@link dismiss} forgets it without
 * running it. Only the latest refused write is held: a component offers one check
 * at a time, and a newer refusal replaces an older one rather than queueing a second
 * write behind it.
 */
export class StepUpOffer {
  /** True while a step-up refusal is waiting on the identity check. */
  readonly open = signal(false);

  private retry: (() => unknown) | null = null;

  /**
   * Take `e` if it is a step-up refusal: hold `retry` and open the offer.
   *
   * @param e - The caught failure.
   * @param retry - Re-issues exactly the refused call (captured arguments).
   * @returns Whether `e` was a step-up refusal; when false nothing changed.
   */
  offer(e: unknown, retry: () => unknown): boolean {
    if (!isStepUpRefusal(e)) return false;
    this.retry = retry;
    this.open.set(true);
    return true;
  }

  /** The session now carries a fresh stamp: close the offer and retry the refused
   *  write once. */
  satisfy(): void {
    const retry = this.retry;
    this.retry = null;
    this.open.set(false);
    if (retry) void retry();
  }

  /** "Not now", or the context the refusal belonged to is gone: close the offer and
   *  retry nothing. */
  dismiss(): void {
    this.retry = null;
    this.open.set(false);
  }
}

/** Whether `e` is the BFF's step-up refusal (as opposed to a role 403). */
export function isStepUpRefusal(e: unknown): e is WikiApiError {
  return e instanceof WikiApiError && e.isStepUpRequired;
}

/** The copy shown in place of the role message while the check is offered. */
export function stepUpMessage(what: string): string {
  return `${what} needs a fresh identity check. Verify your identity below and it is retried; choose "Not now" to leave it undone.`;
}
