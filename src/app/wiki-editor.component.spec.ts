import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { WikiEditorComponent } from './wiki-editor.component';
import { WikiService, WikiPage, WikiApiError } from './wiki.service';

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
