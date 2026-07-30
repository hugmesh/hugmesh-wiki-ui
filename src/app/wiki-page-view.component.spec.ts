import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { WikiPageViewComponent } from './wiki-page-view.component';
import { WikiService, WikiPage, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

function page(over: Partial<WikiPage> = {}): WikiPage {
  return {
    id: '1', domain: 'd', slug: 'getting-started', title: 'Getting started',
    contentMarkdown: '# hi', contentHtml: '<h1>hi</h1><p>welcome</p>',
    authorSubject: 's', version: 2, createdAt: '', updatedAt: '2026-06-13T00:00:00Z', ...over,
  };
}

describe('WikiPageViewComponent (rendered page)', () => {
  let fixture: ComponentFixture<WikiPageViewComponent>;
  let wiki: jasmine.SpyObj<WikiService>;
  const canWrite = signal(false);
  const route = { paramMap: of({ get: (_: string) => 'getting-started' }) } as unknown as ActivatedRoute;

  beforeEach(async () => {
    // getPage/publishPage drive this view; listAttachments feeds the embedded
    // hug-wiki-attachments panel (exercised in depth in its own spec).
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['getPage', 'publishPage', 'listAttachments']);
    wiki.getPage.and.resolveTo(page());
    wiki.listAttachments.and.resolveTo({ attachments: [] });
    await TestBed.configureTestingModule({
      imports: [WikiPageViewComponent],
      providers: [
        provideRouter([]),
        { provide: WikiService, useValue: wiki },
        { provide: SessionService, useValue: { canWrite } },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiPageViewComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads + renders the page title and sanitized body', async () => {
    await render();
    expect(el().querySelector('[data-testid="wiki-view-title"]')!.textContent).toContain('Getting started');
    expect(el().querySelector('.wiki-view__body')!.innerHTML).toContain('welcome');
  });

  it('embeds the attachments panel below the page body (wired to the route slug)', async () => {
    await render();
    expect(el().querySelector('[data-testid="wiki-attachments"]')).not.toBeNull();
    expect(wiki.listAttachments).toHaveBeenCalledWith('getting-started');
  });

  it('sanitizes script out of the server HTML (defence-in-depth)', async () => {
    wiki.getPage.and.resolveTo(page({ contentHtml: '<p>ok</p><script>alert(1)</script>' }));
    await render();
    const body = el().querySelector('.wiki-view__body')!;
    expect(body.innerHTML).toContain('ok');
    expect(body.querySelector('script')).withContext('script stripped').toBeNull();
  });

  it('hides Edit + Publish for a read-only reader', async () => {
    canWrite.set(false);
    await render();
    expect(el().querySelector('[data-testid="wiki-view-edit"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-view-publish"]')).toBeNull();
  });

  it('shows Edit + Publish for a writer and publishes', async () => {
    canWrite.set(true);
    wiki.publishPage.and.resolveTo({ state: 'published', slug: 'getting-started', version: 3 });
    await render();
    const publish = el().querySelector<HTMLButtonElement>('[data-testid="wiki-view-publish"]')!;
    expect(publish).not.toBeNull();
    publish.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(wiki.publishPage).toHaveBeenCalledWith('getting-started');
    expect(el().querySelector('[data-testid="wiki-view-publish-msg"]')!.textContent).toContain('version 3');
  });

  it('surfaces a 404 on load', async () => {
    wiki.getPage.and.rejectWith(new WikiApiError(404, 'gone'));
    await render();
    expect(el().querySelector('[data-testid="wiki-view-error"]')!.textContent).toContain('does not exist');
  });
});
