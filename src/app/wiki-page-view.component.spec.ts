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
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['getPage', 'publishPage', 'deletePage', 'listAttachments']);
    wiki.getPage.and.resolveTo(page());
    wiki.deletePage.and.resolveTo();
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

  it('hides Edit + Publish + Delete for a read-only reader', async () => {
    canWrite.set(false);
    await render();
    expect(el().querySelector('[data-testid="wiki-view-edit"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-view-publish"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-view-delete"]')).toBeNull();
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

  // --- Delete (DELETE /bff/wiki/admin/pages/{slug}, WIKI_WRITE) ------------
  // Destructive + cascading, so it is two-step: the button only ARMS an inline
  // confirmation and the confirm button is the one that calls the bff.

  async function armDelete() {
    canWrite.set(true);
    await render();
    el().querySelector<HTMLButtonElement>('[data-testid="wiki-view-delete"]')!.click();
    fixture.detectChanges();
  }
  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('arms the inline confirmation and does NOT call the bff on the first click', async () => {
    await armDelete();
    const confirm = el().querySelector('[data-testid="wiki-view-delete-confirm"]')!;
    expect(confirm).not.toBeNull();
    expect(confirm.textContent).toContain('getting-started');
    expect(wiki.deletePage).not.toHaveBeenCalled();
  });

  it('Cancel dismisses the confirmation without deleting', async () => {
    await armDelete();
    el().querySelector<HTMLButtonElement>('[data-testid="wiki-view-delete-cancel"]')!.click();
    await settle();
    expect(el().querySelector('[data-testid="wiki-view-delete-confirm"]')).toBeNull();
    expect(wiki.deletePage).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="wiki-view-title"]')).not.toBeNull();
  });

  it('confirming deletes the page and replaces the body with the ack', async () => {
    await armDelete();
    el().querySelector<HTMLButtonElement>('[data-testid="wiki-view-delete-confirm-yes"]')!.click();
    await settle();
    expect(wiki.deletePage).toHaveBeenCalledWith('getting-started');
    const ack = el().querySelector('[data-testid="wiki-view-deleted"]')!;
    expect(ack).not.toBeNull();
    expect(ack.getAttribute('role')).toBe('status');
    expect(ack.textContent).toContain('getting-started');
    // The page (and with it the attachments panel) is gone, not left stale.
    expect(el().querySelector('[data-testid="wiki-view-title"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-attachments"]')).toBeNull();
  });

  it('surfaces a 403 delete denial and keeps the page rendered', async () => {
    wiki.deletePage.and.rejectWith(new WikiApiError(403, 'no'));
    await armDelete();
    el().querySelector<HTMLButtonElement>('[data-testid="wiki-view-delete-confirm-yes"]')!.click();
    await settle();
    const err = el().querySelector('[data-testid="wiki-view-action-error"]')!;
    expect(err).not.toBeNull();
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('ADMIN or SUPERADMIN');
    expect(el().querySelector('[data-testid="wiki-view-deleted"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-view-title"]')).not.toBeNull();
  });
});
