import { Component, Type, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { WikiStepUpComponent } from './wiki-step-up.component';
import { LOGIN_STEP_UP_LOADER, LoginMfaStepUpComponent, LoginStepUpModule } from './mfa-step-up';

/** A stand-in for login-ui's MfaChallengeComponent: the same three outputs, and
 *  the marker the specs look for. */
@Component({ selector: 'fake-login-mfa', standalone: true, template: '<p data-testid="fake-dialog">fake dialog</p>' })
class FakeLoginMfaComponent {
  static readonly instances: FakeLoginMfaComponent[] = [];
  constructor() {
    FakeLoginMfaComponent.instances.push(this);
  }
  readonly satisfied = output<void>();
  readonly dismissed = output<void>();
  readonly unavailable = output<void>();
}

describe('WikiStepUpComponent (hugmesh-wiki-ui#4)', () => {
  let fixture: ComponentFixture<WikiStepUpComponent>;
  let loads: number;
  let loaderBehaviour: 'fake' | 'reject-load' | 'reject-component';
  let satisfied: number;
  let dismissed: number;
  const url = signal('/wiki/manage?tab=audit');

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function testid(id: string): HTMLElement | null {
    return el().querySelector(`[data-testid="${id}"]`);
  }
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }
  function dialog(): FakeLoginMfaComponent {
    return FakeLoginMfaComponent.instances[FakeLoginMfaComponent.instances.length - 1];
  }

  beforeEach(async () => {
    loads = 0;
    loaderBehaviour = 'fake';
    satisfied = 0;
    dismissed = 0;
    FakeLoginMfaComponent.instances.length = 0;
    await TestBed.configureTestingModule({
      imports: [WikiStepUpComponent],
      providers: [
        { provide: Router, useValue: { get url() { return url(); } } },
        {
          provide: LOGIN_STEP_UP_LOADER,
          useValue: async (): Promise<LoginStepUpModule> => {
            loads++;
            if (loaderBehaviour === 'reject-load') throw new Error('Remote login is not initialized');
            return {
              loadMfaStepUpComponent: () =>
                loaderBehaviour === 'reject-component'
                  ? Promise.reject(new Error('chunk failed'))
                  : Promise.resolve(FakeLoginMfaComponent as Type<LoginMfaStepUpComponent>),
            };
          },
        },
      ],
    }).compileComponents();
  });

  function create(): void {
    fixture = TestBed.createComponent(WikiStepUpComponent);
    fixture.componentInstance.satisfied.subscribe(() => satisfied++);
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);
  }

  it('loads the federated dialog only once it is mounted, and shows it in place', async () => {
    expect(loads).toBe(0);
    create();
    expect(loads).toBe(0); // constructing is not loading
    await settle();
    await settle();
    expect(loads).toBe(1);
    expect(testid('fake-dialog')).not.toBeNull();
    expect(fixture.componentInstance.state()).toBe('dialog');
    expect(testid('wiki-step-up-link')).toBeNull();
  });

  it('shows a loading state while the module is on its way', async () => {
    create();
    fixture.detectChanges();
    expect(testid('wiki-step-up-loading')).not.toBeNull();
    await settle();
    await settle();
    expect(testid('wiki-step-up-loading')).toBeNull();
  });

  it('(satisfied) destroys the dialog and tells the host to retry the same action', async () => {
    create();
    await settle();
    await settle();
    dialog().satisfied.emit();
    await settle();
    expect(satisfied).toBe(1);
    expect(dismissed).toBe(0);
    expect(testid('fake-dialog')).toBeNull();
  });

  it('(dismissed) destroys the dialog and does NOT ask for a retry', async () => {
    create();
    await settle();
    await settle();
    dialog().dismissed.emit();
    await settle();
    expect(dismissed).toBe(1);
    expect(satisfied).toBe(0);
    expect(testid('fake-dialog')).toBeNull();
  });

  it('(unavailable: MFA ships dark) destroys the dialog and shows the returnTo link, retrying nothing', async () => {
    create();
    await settle();
    await settle();
    dialog().unavailable.emit();
    await settle();
    expect(satisfied).toBe(0);
    expect(testid('fake-dialog')).toBeNull();
    const link = testid('wiki-step-up-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/login/mfa/challenge?returnTo=%2Fwiki%2Fmanage%3Ftab%3Daudit');
  });

  it('a rejected remote load degrades to the same link', async () => {
    loaderBehaviour = 'reject-load';
    create();
    await settle();
    await settle();
    expect(fixture.componentInstance.state()).toBe('link');
    expect(testid('fake-dialog')).toBeNull();
    expect((testid('wiki-step-up-link') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/login/mfa/challenge?returnTo=%2Fwiki%2Fmanage%3Ftab%3Daudit',
    );
  });

  it('a failure while resolving the component (catalog/chunk) degrades to the link too', async () => {
    loaderBehaviour = 'reject-component';
    create();
    await settle();
    await settle();
    expect(fixture.componentInstance.state()).toBe('link');
  });

  it('in the link state, "Not now" is the way out and reports a dismissal', async () => {
    loaderBehaviour = 'reject-load';
    create();
    await settle();
    await settle();
    (testid('wiki-step-up-not-now') as HTMLButtonElement).click();
    expect(dismissed).toBe(1);
    expect(satisfied).toBe(0);
  });

  it('does not mount a dialog into a host that was destroyed while the module loaded', async () => {
    create();
    fixture.detectChanges();
    fixture.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(satisfied).toBe(0);
    expect(dismissed).toBe(0);
  });
});
