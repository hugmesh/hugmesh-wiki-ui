import { TestBed } from '@angular/core/testing';
import { SessionService, SnapSession } from './session.service';

function makeSession(over: Partial<SnapSession> = {}): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: [],
    registrationComplete: false,
    ...over,
  };
}

describe('SessionService (wiki role model)', () => {
  let service: SessionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [SessionService] });
    service = TestBed.inject(SessionService);
  });

  afterEach(() => localStorage.clear());

  it('starts logged-out with every wiki capability false', () => {
    expect(service.loggedIn()).toBeFalse();
    expect(service.canRead()).toBeFalse();
    expect(service.canWrite()).toBeFalse();
    expect(service.canManage()).toBeFalse();
  });

  // ── WIKI_READ = ADMIN | SUPERADMIN | (MOD AND WIKI) ──
  it('a plain USER (no wiki role) cannot read', () => {
    service.set(makeSession({ roles: ['user'] }));
    expect(service.canRead()).withContext('USER without wiki role').toBeFalse();
    expect(service.canWrite()).toBeFalse();
    expect(service.canManage()).toBeFalse();
  });

  it('a bare MOD without ROLE_WIKI cannot read (the AND a hasAnyRole cannot express)', () => {
    service.set(makeSession({ roles: ['user', 'mod'] }));
    expect(service.canRead()).withContext('MOD lacking wiki role').toBeFalse();
  });

  it('a MOD + ROLE_WIKI can READ but cannot write or manage (read-only)', () => {
    service.set(makeSession({ roles: ['user', 'mod', 'wiki'] }));
    expect(service.canRead()).withContext('MOD+wiki reads').toBeTrue();
    expect(service.canWrite()).withContext('MOD never writes').toBeFalse();
    expect(service.canManage()).withContext('MOD never manages').toBeFalse();
  });

  it('a granted USER (ROLE_WIKI but no mod/admin) still cannot READ via these UI signals', () => {
    // The grant path is a SERVER overlay (WikiAccessGuard); the static role
    // composite here does NOT include a bare-USER+wiki. The UI does not claim to
    // know about grants — it relies on the bff. So canRead stays false; the bff
    // lets the granted user in and the page loads (the read guard is convenience).
    service.set(makeSession({ roles: ['user', 'wiki'] }));
    expect(service.canRead()).toBeFalse();
  });

  // ── WIKI_WRITE = ADMIN | SUPERADMIN ──
  it('an ADMIN can read AND write but cannot manage', () => {
    service.set(makeSession({ roles: ['admin'] }));
    expect(service.canRead()).toBeTrue();
    expect(service.canWrite()).withContext('ADMIN writes').toBeTrue();
    expect(service.canManage()).withContext('ADMIN does not manage').toBeFalse();
  });

  // ── WIKI_MANAGE = SUPERADMIN ──
  it('a SUPERADMIN can read, write AND manage', () => {
    service.set(makeSession({ roles: ['superadmin'] }));
    expect(service.canRead()).toBeTrue();
    expect(service.canWrite()).toBeTrue();
    expect(service.canManage()).withContext('SUPERADMIN manages').toBeTrue();
  });

  it('enforces the cascade invariant: read ⊇ write ⊇ manage', () => {
    service.set(makeSession({ roles: ['superadmin'] }));
    // SUPERADMIN holds all three.
    expect([service.canRead(), service.canWrite(), service.canManage()]).toEqual([true, true, true]);
    service.set(makeSession({ roles: ['admin'] }));
    // ADMIN holds read+write, not manage.
    expect([service.canRead(), service.canWrite(), service.canManage()]).toEqual([true, true, false]);
    service.set(makeSession({ roles: ['user', 'mod', 'wiki'] }));
    // MOD+wiki holds read only.
    expect([service.canRead(), service.canWrite(), service.canManage()]).toEqual([true, false, false]);
  });

  it('hydrates from localStorage and re-reads on a broadcast', () => {
    localStorage.setItem('hug.session', JSON.stringify(makeSession({ roles: ['admin'] })));
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.canWrite()).toBeTrue();

    localStorage.setItem('hug.session', JSON.stringify(makeSession({ roles: ['superadmin'] })));
    window.dispatchEvent(new Event('hug-session-change'));
    expect(fresh.canManage()).toBeTrue();
  });

  it('tolerates malformed JSON and reports logged-out', () => {
    localStorage.setItem('hug.session', '{not json');
    const fresh = TestBed.runInInjectionContext(() => new SessionService());
    expect(fresh.session()).toBeNull();
    expect(fresh.canRead()).toBeFalse();
  });
});
