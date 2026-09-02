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
    wiki = jasmine.createSpyObj<WikiService>('WikiService', ['listPages', 'deletePage']);
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

  // ── per-row DELETE (issue #3 item 1, the list half) ──
  //
  // DELETE /bff/wiki/admin/pages/{slug} is destructive and cascades to the page's
  // attachments server-side. So: WIKI_WRITE-gated exactly like the sibling
  // destructive controls in this console (attachment delete, the page view's own
  // delete), and TWO-STEP — the row button only arms an inline confirmation, and
  // nothing reaches the bff until its confirm button is pressed. No modal.
  describe('per-row delete', () => {
    beforeEach(() => {
      wiki.listPages.and.resolveTo({
        pages: [summary(), summary({ id: '2', slug: 'runbook', title: 'Runbook' })],
      });
      wiki.deletePage.and.resolveTo();
    });

    it('is hidden from a read-only (MOD) reader', async () => {
      canWrite.set(false);
      await render();
      expect(el().querySelector('[data-testid="wiki-delete-getting-started"]')).toBeNull();
    });

    it('is offered to a writer (ADMIN/SUPERADMIN) with an accessible name', async () => {
      canWrite.set(true);
      await render();
      const btn = el().querySelector('[data-testid="wiki-delete-getting-started"]')!;
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('aria-label')).toContain('Getting started');
      expect(btn.getAttribute('aria-describedby')).toBe('wiki-delete-help');
    });

    it('the row button ARMS the confirmation and calls NOTHING', async () => {
      canWrite.set(true);
      await render();
      (el().querySelector('[data-testid="wiki-delete-getting-started"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(wiki.deletePage)
        .withContext('a destructive call must never fire on the first click')
        .not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-getting-started"]')).not.toBeNull();
    });

    it('arms only the row asked for — never a sibling row', async () => {
      canWrite.set(true);
      await render();
      fixture.componentInstance.askDelete('runbook');
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-runbook"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-getting-started"]')).toBeNull();
    });

    it('arming a second row disarms the first (only one confirm can be live)', async () => {
      canWrite.set(true);
      await render();
      const c = fixture.componentInstance;
      c.askDelete('getting-started');
      c.askDelete('runbook');
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-getting-started"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-runbook"]')).not.toBeNull();
    });

    it('Cancel dismisses the confirmation without calling the bff', async () => {
      canWrite.set(true);
      await render();
      fixture.componentInstance.askDelete('getting-started');
      fixture.detectChanges();
      (el().querySelector('[data-testid="wiki-delete-cancel-getting-started"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(wiki.deletePage).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-getting-started"]')).toBeNull();
    });

    it('confirming DELETEs the page, drops the row and announces it in role="status"', async () => {
      canWrite.set(true);
      await render();
      fixture.componentInstance.askDelete('getting-started');
      fixture.detectChanges();
      await fixture.componentInstance.remove('getting-started');
      fixture.detectChanges();
      expect(wiki.deletePage).toHaveBeenCalledOnceWith('getting-started');
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]'))
        .withContext('the deleted row is gone without a re-read')
        .toBeNull();
      expect(el().querySelector('[data-testid="wiki-page-runbook"]')).not.toBeNull();
      expect(wiki.listPages).toHaveBeenCalledTimes(1);
      const ok = el().querySelector('[data-testid="wiki-pages-notice"]')!;
      expect(ok.getAttribute('role')).toBe('status');
      expect(ok.textContent).toContain('getting-started');
    });

    it('does NOT call the bff for a non-writer, even on a programmatic confirm', async () => {
      canWrite.set(false);
      await render();
      await fixture.componentInstance.remove('getting-started');
      expect(wiki.deletePage).not.toHaveBeenCalled();
    });

    it('surfaces a 403 delete denial in a role="alert" and keeps the row', async () => {
      canWrite.set(true);
      wiki.deletePage.and.rejectWith(new WikiApiError(403, 'no'));
      await render();
      await fixture.componentInstance.remove('getting-started');
      fixture.detectChanges();
      const err = el().querySelector('[data-testid="wiki-pages-action-error"]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent).toContain('ADMIN or SUPERADMIN');
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]'))
        .withContext('a failed delete must not fake the row away')
        .not.toBeNull();
    });

    it('surfaces a 404 (already removed) distinctly from a denial', async () => {
      canWrite.set(true);
      wiki.deletePage.and.rejectWith(new WikiApiError(404, 'gone'));
      await render();
      await fixture.componentInstance.remove('getting-started');
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-pages-action-error"]')!.textContent)
        .toContain('does not exist');
    });
  });
});
