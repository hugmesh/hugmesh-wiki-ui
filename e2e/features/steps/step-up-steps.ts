// Step definitions backing features/security/step-up-signal.feature — whether the
// wiki BFF's step-up refusal is recognisable on the wire (hugmesh-wiki-ui#4).
//
// A same-origin fetch with credentials (the persona's HttpOnly bff_ cookie), capturing
// the status AND the `X-Step-Up-Required` header — the header the platform's step-up
// detectors read (admin-bff StepUpRequiredException.SIGNAL_HEADER; mod-ui
// mfa/step-up-error.ts; forum-ui step-up.ts).

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

/** The platform detector's rule for a signal value: a header NAME to retry with. */
const CONFORMING_SIGNAL = /^X-[A-Za-z0-9-]{1,60}-StepUp$/;

const MFA_STEPUP_ARMED = process.env.MFA_STEPUP_ARMED === '1';

/** The last capturing fetch: status + the step-up signal header, or null. */
const captured = { status: 0, signal: null as string | null };

Given('the platform MFA step-up gate is armed on this stack', async ({ $testInfo }) => {
  $testInfo.skip(
    !MFA_STEPUP_ARMED,
    'MFA_STEPUP_ARMED!=1 — this needs a stack with app.mfa.enabled=true on hugmesh-wiki-bff-api '
    + '(default false: stepUp() is then the bare role rule and no step-up refusal exists). Set '
    + 'MFA_STEPUP_ARMED=1 once the mesh under test carries that flag.',
  );
});

When('{string} GETs {string} capturing the step-up signal', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username);
  if (!page) throw new Error(`No page registered for "${username}" — add a login step first.`);
  const r = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { status: res.status, signal: res.headers.get('X-Step-Up-Required') };
  }, path);
  captured.status = r.status;
  captured.signal = r.signal;
});

Then('the captured response status was {int}', async ({}, expected: number) => {
  expect(captured.status).toBe(expected);
});

Then('the captured response was a 403 without any step-up signal', async ({}) => {
  expect(captured.status).toBe(403);
  expect(captured.signal).toBeNull();
});

Then('the captured response was a 403 carrying a conforming step-up signal', async ({}) => {
  expect(captured.status).toBe(403);
  expect(captured.signal, 'X-Step-Up-Required on the armed refusal').not.toBeNull();
  expect(captured.signal!).toMatch(CONFORMING_SIGNAL);
});
