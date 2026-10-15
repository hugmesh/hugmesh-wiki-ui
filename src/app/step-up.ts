import { HttpErrorResponse } from '@angular/common/http';

/**
 * The platform's "step-up required" 403, as hugmesh-wiki-bff-api emits it
 * (hugmesh-wiki-bff-api#35, merged) and as this remote reads it
 * (hugmesh-wiki-ui#4).
 *
 * With `app.mfa.enabled=true` the BFF wraps `/bff/wiki/superadmin/**` and
 * `/bff/wiki/admin/**` in `SecurityConfig.stepUp`: the caller must hold the role
 * AND a fresh `MFA_SATISFIED` stamp. A refusal for the missing stamp (and only
 * that) is a 403 carrying `X-Step-Up-Required: X-Wiki-StepUp` and a JSON body
 * `{"error":"... requires step-up re-authentication (present X-Wiki-StepUp)"}`.
 * A refusal by ROLE carries neither, so it must never offer an MFA prompt.
 *
 * Two recognisers, the same two the fleet's reference detector (admin-ui
 * `mfa/step-up-error.ts`) uses, both trusted on a 403 ONLY:
 * <ol>
 *   <li>the structured header, accepted only when its value has the shape of a
 *       gate constant (the header-injection guard);</li>
 *   <li>the legacy phrase `requires step-up` in the body, which the BFF keeps in
 *       the same response. It is the fallback for a hop that drops the header:
 *       whether the gateway forwards the header has not been observed.</li>
 * </ol>
 */

/** The response header the BFF stamps on (and only on) a step-up refusal. */
export const STEP_UP_SIGNAL_HEADER = 'X-Step-Up-Required';

/** The pre-signal phrase, kept in the body of the same response. */
export const LEGACY_STEP_UP_PATTERN = /requires step-up/i;

/** What a trusted signal value looks like: `X-<flavour>-StepUp`. */
const SAFE_SIGNAL_VALUE = /^X-[A-Za-z0-9-]{1,60}-StepUp$/;

/** How a step-up requirement was recognised. */
export type StepUpDetection = 'signal' | 'legacy-phrase';

/** A recognised step-up requirement. */
export interface StepUpRequirement {
  /** The signal header's value, or null when only the legacy phrase matched. */
  readonly signal: string | null;
  readonly via: StepUpDetection;
}

function bodyMessageOf(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const o = body as { error?: unknown; message?: unknown };
    if (typeof o.error === 'string') return o.error;
    if (typeof o.message === 'string') return o.message;
  }
  return '';
}

/**
 * Whether `e` is the BFF's step-up refusal.
 *
 * @param e - A transport failure, as the generated client surfaces it.
 * @returns The requirement, or null for anything else (a role 403, a 401, a 500,
 *   a header on a non-403, a malformed signal value).
 */
export function stepUpRequirementOf(e: unknown): StepUpRequirement | null {
  if (!(e instanceof HttpErrorResponse) || e.status !== 403) return null;
  const signal = e.headers?.get(STEP_UP_SIGNAL_HEADER) ?? null;
  if (signal && SAFE_SIGNAL_VALUE.test(signal)) return { signal, via: 'signal' };
  if (LEGACY_STEP_UP_PATTERN.test(bodyMessageOf(e.error))) return { signal: null, via: 'legacy-phrase' };
  return null;
}
