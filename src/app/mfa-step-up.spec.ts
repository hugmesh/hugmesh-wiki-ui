import { TestBed } from '@angular/core/testing';

import {
  LOGIN_REMOTE_ENTRY,
  LOGIN_STEP_UP_LOADER,
  LOGIN_STEP_UP_OPTIONS,
  LoginStepUpModule,
  MFA_CHALLENGE_ROUTE,
  createLoginStepUpLoader,
  mfaChallengeHref,
} from './mfa-step-up';

describe('the login-ui step-up remote (decision 35: hardcoded, degraded on failure)', () => {
  it('pins the remoteEntry to the shell manifest row for `login`', () => {
    // hugmesh-host-shell src/assets/federation.manifest.prod.json: "login": "/login/remoteEntry.json".
    // A move there makes the dialog vanish silently (the link takes over), so this fails loudly instead.
    expect(LOGIN_REMOTE_ENTRY).toBe('/login/remoteEntry.json');
  });

  it('loads through the OBJECT overload with login-ui\'s declared remote name and exposed module', () => {
    expect(LOGIN_STEP_UP_OPTIONS).toEqual({
      remoteEntry: '/login/remoteEntry.json',
      remoteName: 'login',
      exposedModule: './mfa-step-up',
    });
  });

  it('the loader passes exactly those options, once per call, and only when called', async () => {
    const mod = {} as LoginStepUpModule;
    const calls: unknown[] = [];
    const loader = createLoginStepUpLoader(async (options) => {
      calls.push(options);
      return mod;
    });
    expect(calls.length).toBe(0);
    expect(await loader()).toBe(mod);
    expect(calls).toEqual([LOGIN_STEP_UP_OPTIONS]);
  });

  it('is provided by default (the real federation call is only reached when invoked)', () => {
    expect(typeof TestBed.inject(LOGIN_STEP_UP_LOADER)).toBe('function');
  });

  it('builds the decided fallback link: the challenge route with the encoded returnTo', () => {
    expect(MFA_CHALLENGE_ROUTE).toBe('/login/mfa/challenge');
    expect(mfaChallengeHref('/wiki/manage?x=1&y=2#top')).toBe(
      '/login/mfa/challenge?returnTo=%2Fwiki%2Fmanage%3Fx%3D1%26y%3D2%23top',
    );
  });
});
