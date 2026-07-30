import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { wikiReadGuard, wikiWriteGuard, wikiManageGuard } from './wiki.guard';
import { SessionService } from './session.service';

type Caps = Pick<SessionService, 'canRead' | 'canWrite' | 'canManage'>;

describe('wiki guards (per-view role gating)', () => {
  let session: jasmine.SpyObj<Caps>;
  let parseUrlSpy: jasmine.Spy;

  beforeEach(() => {
    session = jasmine.createSpyObj<Caps>('SessionService', ['canRead', 'canWrite', 'canManage']);
    parseUrlSpy = jasmine.createSpy('parseUrl').and.callFake((u: string) => ({ url: u } as unknown as UrlTree));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: session },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
  });

  function run(guard: typeof wikiReadGuard) {
    return TestBed.runInInjectionContext(() => guard(null as never, null as never));
  }

  describe('wikiReadGuard (WIKI_READ)', () => {
    it('ALLOWS when canRead', () => {
      session.canRead.and.returnValue(true);
      expect(run(wikiReadGuard)).toBeTrue();
      expect(parseUrlSpy).not.toHaveBeenCalled();
    });
    it('DENIES → /forbidden when not canRead', () => {
      session.canRead.and.returnValue(false);
      const r = run(wikiReadGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/wiki/forbidden');
      expect(parseUrlSpy).toHaveBeenCalledWith('/wiki/forbidden');
    });
  });

  describe('wikiWriteGuard (WIKI_WRITE)', () => {
    it('ALLOWS when canWrite', () => {
      session.canWrite.and.returnValue(true);
      expect(run(wikiWriteGuard)).toBeTrue();
    });
    it('DENIES → /forbidden when not canWrite (e.g. a MOD reader)', () => {
      session.canWrite.and.returnValue(false);
      const r = run(wikiWriteGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/wiki/forbidden');
    });
  });

  describe('wikiManageGuard (WIKI_MANAGE)', () => {
    it('ALLOWS when canManage (superadmin)', () => {
      session.canManage.and.returnValue(true);
      expect(run(wikiManageGuard)).toBeTrue();
    });
    it('DENIES → /forbidden when not canManage (e.g. an ADMIN)', () => {
      session.canManage.and.returnValue(false);
      const r = run(wikiManageGuard) as UrlTree;
      expect((r as unknown as { url: string }).url).toBe('/wiki/forbidden');
    });
  });
});
