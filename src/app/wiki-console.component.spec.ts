import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { WikiConsoleComponent } from './wiki-console.component';
import { SessionService } from './session.service';

/** A stub SessionService with settable capability signals so each role scenario
 *  is exercised by flipping canRead/canWrite/canManage. */
function sessionStub() {
  return {
    canRead: signal(false),
    canWrite: signal(false),
    canManage: signal(false),
  };
}

describe('WikiConsoleComponent (role-gated nav)', () => {
  let fixture: ComponentFixture<WikiConsoleComponent>;
  let session: ReturnType<typeof sessionStub>;

  beforeEach(async () => {
    session = sessionStub();
    await TestBed.configureTestingModule({
      imports: [WikiConsoleComponent],
      providers: [provideRouter([]), { provide: SessionService, useValue: session }],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiConsoleComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function navTestIds(): string[] {
    return Array.from(el().querySelectorAll('[data-testid^="wiki-nav-"]')).map(
      (n) => n.getAttribute('data-testid')!,
    );
  }

  it('a NON-role user sees NOTHING (empty menubar)', () => {
    fixture.detectChanges();
    expect(navTestIds()).toEqual([]);
    expect(el().querySelector('[role="menubar"]')).withContext('no menubar when no items').toBeNull();
  });

  it('a MOD+ROLE_WIKI reader sees ONLY Content (read-only — no New/Access/Manage)', () => {
    session.canRead.set(true); // canWrite/canManage stay false
    fixture.detectChanges();
    expect(navTestIds()).toEqual(['wiki-nav-pages']);
  });

  it('an ADMIN sees Content + New + Access (no Manage)', () => {
    session.canRead.set(true);
    session.canWrite.set(true);
    fixture.detectChanges();
    expect(navTestIds()).toEqual(['wiki-nav-pages', 'wiki-nav-new', 'wiki-nav-access']);
    expect(navTestIds()).not.toContain('wiki-nav-manage');
  });

  it('a SUPERADMIN sees ALL views incl. Manage', () => {
    session.canRead.set(true);
    session.canWrite.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    expect(navTestIds()).toEqual([
      'wiki-nav-pages',
      'wiki-nav-new',
      'wiki-nav-access',
      'wiki-nav-manage',
    ]);
  });

  it('renders the menubar with roving tabindex + arrow-key roving (a11y)', () => {
    session.canRead.set(true);
    session.canWrite.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    const menubar = el().querySelector('[role="menubar"]')!;
    expect(menubar).not.toBeNull();
    const items = Array.from(el().querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    // Exactly one item is tabbable (tabindex=0); the rest are -1.
    expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);

    const component = fixture.componentInstance;
    component.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 0);
    fixture.detectChanges();
    expect(component.active).toBe(1);
    component.onKey(new KeyboardEvent('keydown', { key: 'End' }), 1);
    expect(component.active).toBe(3);
    component.onKey(new KeyboardEvent('keydown', { key: 'Home' }), 3);
    expect(component.active).toBe(0);
  });

  it('every nav link carries an accessibleName + describedby help (a11y)', () => {
    session.canRead.set(true);
    session.canWrite.set(true);
    session.canManage.set(true);
    fixture.detectChanges();
    const links = Array.from(el().querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    for (const link of links) {
      expect(link.getAttribute('aria-label')).withContext('accessibleName').toBeTruthy();
      const describedby = link.getAttribute('aria-describedby');
      expect(describedby).toBeTruthy();
      expect(el().querySelector('#' + describedby)).withContext('help element exists').not.toBeNull();
    }
  });
});
