import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { WikiEditorComponent } from './wiki-editor.component';
import { WikiService, WikiPage, WikiApiError } from './wiki.service';
import {
  FakeStepUpDialog,
  provideFakeStepUpLoader,
  resetStepUpFakes,
  roleRefusal,
  settleFixture,
  stepUpLoads,
  stepUpRefusal,
} from './step-up.testing';

function page(over: Partial<WikiPage> = {}): WikiPage {
  return {
    id: '1', domain: 'd', slug: 'getting-started', title: 'Getting started',
    contentMarkdown: '# hi', contentHtml: '<h1>hi</h1>',
    authorSubject: 's', version: 4, createdAt: '', updatedAt: '', ...over,
  };
}

describe('WikiEditorComponent', () => {
  let wiki: jasmine.SpyObj<WikiService>;
  let navSpy: jasmine.Spy;

  async function setup(slug: string | null): Promise<ComponentFixture<WikiEditorComponent>> {
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['getPage', 'createPage', 'updatePage']);
    wiki.getPage.and.resolveTo(page());
    navSpy = jasmine.createSpy('navigate');
    const route = { paramMap: of({ get: (_: string) => slug }) } as unknown as ActivatedRoute;
    await TestBed.configureTestingModule({
      imports: [WikiEditorComponent],
      providers: [
        provideRouter([]),
        { provide: WikiService, useValue: wiki },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: navSpy } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WikiEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('CREATE mode: validates the slug pattern before submit', async () => {
    const fixture = await setup(null);
    const c = fixture.componentInstance;
    c.slug.set('Bad Slug!');
    c.title.set('T');
    c.body.set('body');
    expect(c.formValid()).withContext('invalid slug blocks submit').toBeFalse();
    await c.submit();
    expect(wiki.createPage).not.toHaveBeenCalled();
    expect(c.slugInvalid()).toBeTrue();

    c.slug.set('good-slug');
    expect(c.formValid()).toBeTrue();
    wiki.createPage.and.resolveTo(page({ slug: 'good-slug' }));
    await c.submit();
    expect(wiki.createPage).toHaveBeenCalledWith(jasmine.objectContaining({ slug: 'good-slug' }));
    expect(navSpy).toHaveBeenCalled();
  });

  it('CREATE mode: a 409 duplicate slug surfaces a specific message', async () => {
    const fixture = await setup(null);
    const c = fixture.componentInstance;
    c.slug.set('dup');
    c.title.set('T');
    c.body.set('b');
    wiki.createPage.and.rejectWith(new WikiApiError(409, 'exists'));
    await c.submit();
    expect(c.error()).toContain('already exists');
  });

  it('EDIT mode: pre-fills from the bff and PUTs with expectedVersion', async () => {
    const fixture = await setup('getting-started');
    const c = fixture.componentInstance;
    expect(c.isEdit()).toBeTrue();
    expect(c.title()).toBe('Getting started');
    expect(c.expectedVersion()).toBe(4);
    c.title.set('Updated');
    wiki.updatePage.and.resolveTo(page({ version: 5 }));
    await c.submit();
    expect(wiki.updatePage).toHaveBeenCalledWith('getting-started', jasmine.objectContaining({ expectedVersion: 4 }));
  });

  it('EDIT mode: a 409 stale-edit shows the conflict message + reload affordance', async () => {
    const fixture = await setup('getting-started');
    const c = fixture.componentInstance;
    c.title.set('x');
    wiki.updatePage.and.rejectWith(new WikiApiError(409, 'stale'));
    await c.submit();
    expect(c.conflict()).toBeTrue();
    expect(c.error()).toContain('changed by someone else');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="wiki-editor-reload"]')).not.toBeNull();

    // reloadLatest refreshes expectedVersion
    wiki.getPage.and.resolveTo(page({ version: 7 }));
    await c.reloadLatest();
    expect(c.expectedVersion()).toBe(7);
    expect(c.conflict()).toBeFalse();
  });

  it('renders a labelled markdown preview region (a11y)', async () => {
    const fixture = await setup(null);
    const el = fixture.nativeElement as HTMLElement;
    const region = el.querySelector('[aria-label="Content preview"]')!;
    expect(region).not.toBeNull();
    fixture.componentInstance.body.set('# Heading');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="wiki-editor-preview"]')!.innerHTML).toContain('Heading');
  });
});

describe('WikiEditorComponent: step-up on save (hugmesh-wiki-ui#4)', () => {
  let wiki: jasmine.SpyObj<WikiService>;
  let navSpy: jasmine.Spy;

  async function setup(slug: string | null): Promise<ComponentFixture<WikiEditorComponent>> {
    resetStepUpFakes();
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['getPage', 'createPage', 'updatePage']);
    wiki.getPage.and.resolveTo(page());
    navSpy = jasmine.createSpy('navigate');
    const route = { paramMap: of({ get: (_: string) => slug }) } as unknown as ActivatedRoute;
    await TestBed.configureTestingModule({
      imports: [WikiEditorComponent],
      providers: [
        provideRouter([]),
        { provide: WikiService, useValue: wiki },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: navSpy, url: '/wiki/new' } },
        provideFakeStepUpLoader(),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WikiEditorComponent);
    await settleFixture(fixture);
    return fixture;
  }

  const q = (f: ComponentFixture<WikiEditorComponent>, id: string) =>
    (f.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  function fillCreate(c: WikiEditorComponent): void {
    c.slug.set('fresh-page');
    c.title.set('Fresh');
    c.body.set('# body');
  }

  it('(a) a step-up refusal on create shows the identity check in place of the role message', async () => {
    const f = await setup(null);
    fillCreate(f.componentInstance);
    wiki.createPage.and.rejectWith(stepUpRefusal());
    await f.componentInstance.submit();
    await settleFixture(f);
    expect(q(f, 'wiki-step-up')).not.toBeNull();
    expect(q(f, 'fake-dialog')).not.toBeNull();
    expect(q(f, 'wiki-editor-error')!.textContent).toContain('fresh identity check');
    expect(q(f, 'wiki-editor-error')!.textContent).not.toContain('does not permit authoring');
    // Outside the form: a submit inside the federated dialog must not reach (ngSubmit).
    expect(q(f, 'wiki-step-up')!.closest('form')).toBeNull();
  });

  it('(b) a role 403 keeps the authoring message and never loads the dialog', async () => {
    const f = await setup(null);
    fillCreate(f.componentInstance);
    wiki.createPage.and.rejectWith(roleRefusal());
    await f.componentInstance.submit();
    await settleFixture(f);
    expect(q(f, 'wiki-editor-error')!.textContent).toContain('does not permit authoring');
    expect(q(f, 'wiki-step-up')).toBeNull();
    expect(stepUpLoads.count).toBe(0);
  });

  it('(c) satisfied re-issues the SAME update once, even after the form was edited', async () => {
    const f = await setup('getting-started');
    const c = f.componentInstance;
    c.title.set('Edited');
    c.body.set('new body');
    wiki.updatePage.and.returnValues(Promise.reject(stepUpRefusal()), Promise.resolve(page({ version: 5 })));
    await c.submit();
    await settleFixture(f);
    const refused = wiki.updatePage.calls.argsFor(0);

    c.title.set('typed while the check was open');
    FakeStepUpDialog.last().satisfied.emit();
    await settleFixture(f);

    expect(wiki.updatePage).toHaveBeenCalledTimes(2);
    expect(wiki.updatePage.calls.argsFor(1)).toEqual(refused);
    expect(refused).toEqual(['getting-started', { title: 'Edited', contentMarkdown: 'new body', expectedVersion: 4 }]);
    expect(q(f, 'wiki-step-up')).toBeNull();
    expect(navSpy).toHaveBeenCalledTimes(1);
  });

  it('(c) satisfied re-issues the SAME create once', async () => {
    const f = await setup(null);
    fillCreate(f.componentInstance);
    wiki.createPage.and.returnValues(Promise.reject(stepUpRefusal()), Promise.resolve(page({ slug: 'fresh-page' })));
    await f.componentInstance.submit();
    await settleFixture(f);
    FakeStepUpDialog.last().satisfied.emit();
    await settleFixture(f);
    expect(wiki.createPage).toHaveBeenCalledTimes(2);
    expect(wiki.createPage.calls.argsFor(1)).toEqual(wiki.createPage.calls.argsFor(0));
    expect(navSpy).toHaveBeenCalledWith(['../pages', 'fresh-page'], jasmine.anything());
  });

  it('(d) dismissed re-issues nothing and leaves the message', async () => {
    const f = await setup(null);
    fillCreate(f.componentInstance);
    wiki.createPage.and.rejectWith(stepUpRefusal());
    await f.componentInstance.submit();
    await settleFixture(f);
    FakeStepUpDialog.last().dismissed.emit();
    await settleFixture(f);
    expect(wiki.createPage).toHaveBeenCalledTimes(1);
    expect(q(f, 'wiki-step-up')).toBeNull();
    expect(q(f, 'wiki-editor-error')!.textContent).toContain('fresh identity check');
    expect(navSpy).not.toHaveBeenCalled();
  });
});
