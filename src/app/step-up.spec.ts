import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { STEP_UP_SIGNAL_HEADER, stepUpRequirementOf } from './step-up';

/** A transport failure as the generated client surfaces it. */
function httpError(status: number, body: unknown, headers: Record<string, string> = {}): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: status === 403 ? 'Forbidden' : 'Error',
    url: '/bff/wiki/superadmin/audit',
    error: body,
    headers: new HttpHeaders(headers),
  });
}

/** The wire shape hugmesh-wiki-bff-api's WikiStepUpAccessDeniedHandler writes. */
const BFF_BODY = { error: 'wiki management requires step-up re-authentication (present X-Wiki-StepUp)' };

describe('step-up detection (the wiki BFF contract)', () => {
  it('recognises the structured signal on a 403, with no phrase needed', () => {
    const e = httpError(403, null, { [STEP_UP_SIGNAL_HEADER]: 'X-Wiki-StepUp' });
    expect(stepUpRequirementOf(e)).toEqual({ signal: 'X-Wiki-StepUp', via: 'signal' });
  });

  it('prefers the signal when both the header and the phrase arrive, as the BFF sends them', () => {
    const e = httpError(403, BFF_BODY, { [STEP_UP_SIGNAL_HEADER]: 'X-Wiki-StepUp' });
    expect(stepUpRequirementOf(e)?.via).toBe('signal');
  });

  it('falls back to the legacy phrase when a hop dropped the header', () => {
    expect(stepUpRequirementOf(httpError(403, BFF_BODY))).toEqual({ signal: null, via: 'legacy-phrase' });
    expect(stepUpRequirementOf(httpError(403, { message: 'this requires step-up' }))?.via).toBe('legacy-phrase');
    expect(stepUpRequirementOf(httpError(403, 'requires step-up'))?.via).toBe('legacy-phrase');
  });

  it('does NOT fire on a refusal by role: no header, no phrase', () => {
    expect(stepUpRequirementOf(httpError(403, null))).toBeNull();
    expect(stepUpRequirementOf(httpError(403, { error: 'forbidden' }))).toBeNull();
    expect(stepUpRequirementOf(httpError(403, '', { 'X-Route-Denied': 'fe:/bff/wiki/superadmin/audit' }))).toBeNull();
  });

  it('does not mistake Angular\'s own failure text for the phrase', () => {
    expect(stepUpRequirementOf(httpError(403, null))).toBeNull();
  });

  it('trusts neither the header nor the phrase on any status but 403', () => {
    expect(stepUpRequirementOf(httpError(500, BFF_BODY, { [STEP_UP_SIGNAL_HEADER]: 'X-Wiki-StepUp' }))).toBeNull();
    expect(stepUpRequirementOf(httpError(401, BFF_BODY))).toBeNull();
  });

  it('ignores a signal value that is not a gate constant (header-injection guard)', () => {
    expect(stepUpRequirementOf(httpError(403, null, { [STEP_UP_SIGNAL_HEADER]: 'Authorization' }))).toBeNull();
    expect(stepUpRequirementOf(httpError(403, null, { [STEP_UP_SIGNAL_HEADER]: 'X-Evil StepUp' }))).toBeNull();
  });

  it('is null for anything that is not an HttpErrorResponse', () => {
    expect(stepUpRequirementOf(new Error('requires step-up'))).toBeNull();
    expect(stepUpRequirementOf(undefined)).toBeNull();
  });
});
