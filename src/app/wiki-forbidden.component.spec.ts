import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { WikiForbiddenComponent } from './wiki-forbidden.component';
import { SessionService } from './session.service';

describe('WikiForbiddenComponent', () => {
  const canRead = signal(false);

  async function setup(): Promise<ComponentFixture<WikiForbiddenComponent>> {
    await TestBed.configureTestingModule({
      imports: [WikiForbiddenComponent],
      providers: [provideRouter([]), { provide: SessionService, useValue: { canRead } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(WikiForbiddenComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('announces the denial in a role="alert" and explains the missing role', async () => {
    const fixture = await setup();
    const el = fixture.nativeElement as HTMLElement;
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('access');
  });

  it('offers a Back-to-content link only when the user can read', async () => {
    canRead.set(false);
    let fixture = await setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="wiki-forbidden-back"]')).toBeNull();

    TestBed.resetTestingModule();
    canRead.set(true);
    fixture = await setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="wiki-forbidden-back"]')).not.toBeNull();
  });
});
