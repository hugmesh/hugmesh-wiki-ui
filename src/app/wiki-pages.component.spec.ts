import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { WikiPagesComponent } from './wiki-pages.component';
import { WikiService, PageSummary, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

function summary(over: Partial<PageSummary> = {}): PageSummary {
  return { id: '1', slug: 'getting-started', title: 'Getting started', authorSubject: 's', version: 2, updatedAt: '2026-06-13T00:00:00Z', ...over };
}

describe('WikiPagesComponent (content list)', () => {
  let fixture: ComponentFixture<WikiPagesComponent>;
  let wiki: jasmine.SpyObj<WikiService>;
  const canWrite = signal(false);

  beforeEach(async () => {
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['listPages']);
    wiki.listPages.and.resolveTo({ pages: [summary()] });
    await TestBed.configureTestingModule({
      imports: [WikiPagesComponent],
      providers: [
        provideRouter([]),
        { provide: WikiService, useValue: wiki },
        { provide: SessionService, useValue: { canWrite } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiPagesComponent);
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads + renders the pages from the bff', async () => {
    await render();
    expect(wiki.listPages).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="wiki-page-getting-started"]')).not.toBeNull();
  });

  it('shows a loading status, then the list region is labelled (a11y)', async () => {
    await render();
    const region = el().querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-labelledby')).toBe('wiki-pages-title');
  });

  it('hides New page + per-row Edit for a read-only (MOD) reader', async () => {
    canWrite.set(false);
    await render();
    expect(el().querySelector('[data-testid="wiki-new-page"]')).toBeNull();
    expect(el().querySelector('[data-testid="wiki-edit-getting-started"]')).toBeNull();
  });

  it('shows New page + per-row Edit for a writer (ADMIN/SUPERADMIN)', async () => {
    canWrite.set(true);
    await render();
    expect(el().querySelector('[data-testid="wiki-new-page"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="wiki-edit-getting-started"]')).not.toBeNull();
  });

  it('renders the empty state when there are no pages', async () => {
    wiki.listPages.and.resolveTo({ pages: [] });
    await render();
    expect(el().querySelector('[data-testid="wiki-pages-empty"]')).not.toBeNull();
  });

  it('surfaces a 403 read denial in a role="alert"', async () => {
    wiki.listPages.and.rejectWith(new WikiApiError(403, 'no'));
    await render();
    const err = el().querySelector('[data-testid="wiki-pages-error"]')!;
    expect(err).not.toBeNull();
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('permission');
  });
});
