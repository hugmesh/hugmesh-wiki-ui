import { InjectionToken, OutputEmitterRef, Type } from '@angular/core';
import { loadRemoteModule } from '@angular-architects/native-federation';

/**
 * Where the platform's one MFA step-up dialog comes from (hugmesh-wiki-ui#4).
 *
 * hugmesh-login-ui exposes `./mfa-step-up` over native federation; this remote
 * loads it ON DEMAND, when a step-up refusal needs it, never at bootstrap (loading
 * the module constructs login-ui's own SessionService, which opens a
 * BroadcastChannel and window listeners).
 *
 * DECISION 35 (hugmesh-generator#347): the remoteEntry URL is HARDCODED, here, as
 * one constant, and a failure to load degrades to the `?returnTo=` link. It is
 * deliberately not configurable and not discovered: no `window.__HUG_*`, no
 * manifest fetch, no BFF endpoint. It is a second copy of the `login` row of
 * hugmesh-host-shell's `federation.manifest.prod.json`; that repo pins its own
 * copy with a spec, and {@code mfa-step-up.spec.ts} pins this one.
 *
 * Two consequences worth knowing, neither a bug:
 * <ul>
 *   <li>Under `ng serve` the dev manifest serves `login` at
 *       `http://localhost:4203/remoteEntry.json`, so this path does not resolve
 *       and the link is what the developer sees.</li>
 *   <li>A `federation_modules` row in federation-api outranks the shell's file at
 *       runtime, so an operator can move `login` without touching a repo. The
 *       dialog then disappears and the link takes over, with no error.</li>
 * </ul>
 */
export const LOGIN_REMOTE_ENTRY = '/login/remoteEntry.json';

/** The object overload of `loadRemoteModule`: the shell parks every remote
 *  (`EAGER_REMOTES = []`), and only this form initialises the remote first. The
 *  two-argument form throws `Remote 'login' is not initialized` unless the user
 *  already visited /login this session. */
export const LOGIN_STEP_UP_OPTIONS = {
  remoteEntry: LOGIN_REMOTE_ENTRY,
  remoteName: 'login',
  exposedModule: './mfa-step-up',
} as const;

/** The platform's step-up challenge page, mounted by the host at `/login`. An
 *  ABSOLUTE host path on purpose (it is the login remote's surface, not a path
 *  inside this one). It navigates back to `returnTo` once the session is stamped. */
export const MFA_CHALLENGE_ROUTE = '/login/mfa/challenge';

/** The `?returnTo=` link: the decided, permanent fallback.
 *
 *  @param returnTo - The in-app URL to come back to (the router's current URL). */
export function mfaChallengeHref(returnTo: string): string {
  return `${MFA_CHALLENGE_ROUTE}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** The slice of login-ui's `MfaChallengeComponent` this remote touches. Typed
 *  here by hand: login-ui is a federated remote, not a dependency. All three
 *  outputs are Angular `output()` refs. */
export interface LoginMfaStepUpComponent {
  readonly satisfied: OutputEmitterRef<void>;
  readonly dismissed: OutputEmitterRef<void>;
  readonly unavailable: OutputEmitterRef<void>;
}

/** What `./mfa-step-up` exposes that this remote uses. */
export interface LoginStepUpModule {
  /** Awaits login-ui's translation catalog, then returns the component class. */
  loadMfaStepUpComponent(): Promise<Type<LoginMfaStepUpComponent>>;
}

/** The loader signature, so a spec can supply a fake one. */
export type LoginStepUpLoader = () => Promise<LoginStepUpModule>;

/** The seam over `loadRemoteModule`; an ESM named export cannot be spied on. */
export function createLoginStepUpLoader(
  load: (options: typeof LOGIN_STEP_UP_OPTIONS) => Promise<LoginStepUpModule>,
): LoginStepUpLoader {
  return () => load(LOGIN_STEP_UP_OPTIONS);
}

export const LOGIN_STEP_UP_LOADER = new InjectionToken<LoginStepUpLoader>('LOGIN_STEP_UP_LOADER', {
  providedIn: 'root',
  factory: () => createLoginStepUpLoader((options) => loadRemoteModule<LoginStepUpModule>({ ...options })),
});
