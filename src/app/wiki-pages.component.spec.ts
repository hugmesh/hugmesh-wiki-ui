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
  //
  // The armed/in-flight state is keyed on the row ID, never the slug: `slug` is
  // unique only WITHIN a brand (UNIQUE(domain, slug)) and a SUPERADMIN's list is
  // cross-brand, so same-slug rows are legal and a slug key would arm and drop all
  // of them at once. And the outcome is decided by a confirming RE-READ, because
  // the bff returns 204 even when its DELETE removed no row.
  describe('per-row delete', () => {
    const started = summary();
    const runbook = summary({ id: '2', slug: 'runbook', title: 'Runbook' });

    beforeEach(() => {
      wiki.listPages.and.resolveTo({ pages: [started, runbook] });
      wiki.deletePage.and.resolveTo();
    });

    /** First read = the full list; the confirming re-read = the list without `id`
     *  (i.e. the server really did delete the row). */
    function listThenWithout(id: string, rows: PageSummary[] = [started, runbook]): void {
      let call = 0;
      wiki.listPages.and.callFake(() => {
        call += 1;
        return Promise.resolve({
          pages: call === 1 ? rows : rows.filter((p) => p.id !== id),
        });
      });
    }

    it('is hidden from a read-only (MOD) reader', async () => {
      canWrite.set(false);
      await render();
      expect(el().querySelector('[data-testid="wiki-delete-1"]')).toBeNull();
    });

    it('is offered to a writer (ADMIN/SUPERADMIN) with an accessible name', async () => {
      canWrite.set(true);
      await render();
      const btn = el().querySelector('[data-testid="wiki-delete-1"]')!;
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('aria-label')).toContain('Getting started');
      expect(btn.getAttribute('aria-describedby')).toBe('wiki-delete-help');
    });

    it('the row button ARMS the confirmation and calls NOTHING', async () => {
      canWrite.set(true);
      await render();
      (el().querySelector('[data-testid="wiki-delete-1"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(wiki.deletePage)
        .withContext('a destructive call must never fire on the first click')
        .not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-1"]')).not.toBeNull();
    });

    it('arms only the row asked for — never a sibling row', async () => {
      canWrite.set(true);
      await render();
      fixture.componentInstance.askDelete(runbook);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-2"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-1"]')).toBeNull();
    });

    it('arming a second row disarms the first (only one confirm can be live)', async () => {
      canWrite.set(true);
      await render();
      const c = fixture.componentInstance;
      c.askDelete(started);
      c.askDelete(runbook);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-1"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-2"]')).not.toBeNull();
    });

    // REGRESSION: a SUPERADMIN's list is CROSS-BRAND (WikiPageRepository#list(null)),
    // and the bff's UNIQUE(domain, slug) makes the same slug legal in two brands, so
    // this list can hold two rows with one slug. Keying the armed state on the slug
    // armed BOTH confirmations and dropped BOTH rows on one confirm, while the server
    // deleted at most one page.
    describe('two rows sharing one slug (legal cross-brand)', () => {
      const brandA = summary({ id: 'a', slug: 'runbook', title: 'Runbook' });
      const brandB = summary({ id: 'b', slug: 'runbook', title: 'Runbook' });

      beforeEach(() => {
        wiki.listPages.and.resolveTo({ pages: [brandA, brandB] });
      });

      it('arms EXACTLY ONE confirmation, not every row with that slug', async () => {
        canWrite.set(true);
        await render();
        fixture.componentInstance.askDelete(brandB);
        fixture.detectChanges();
        expect(el().querySelectorAll('[data-testid^="wiki-delete-confirm-"]').length)
          .withContext('a same-slug sibling must NOT be armed by proxy')
          .toBe(1);
        expect(el().querySelector('[data-testid="wiki-delete-confirm-b"]')).not.toBeNull();
        expect(el().querySelector('[data-testid="wiki-delete-confirm-a"]')).toBeNull();
      });

      it('drops EXACTLY ONE row on confirm, keeping the same-slug sibling', async () => {
        canWrite.set(true);
        listThenWithout('b', [brandA, brandB]);
        await render();
        await fixture.componentInstance.remove(brandB);
        fixture.detectChanges();
        expect(fixture.componentInstance.pages().map((p) => p.id))
          .withContext('the sibling page in the other brand still exists server-side')
          .toEqual(['a']);
      });

      // REGRESSION (the OTHER direction, and the one the two specs above cannot
      // see): the confirming re-read must decide by row ID, never by slug. Keying
      // the survivor check on the slug reports a genuinely COMPLETED delete as
      // "still listed — it may not have been removed" the moment another brand
      // legally owns the same slug, which is exactly the confusion this round
      // exists to kill. Neither sibling spec pins it: the confirm one asserts only
      // pages() (set from the server re-read, independent of this check), and the
      // fallback one exercises the catch-path filter, a different code site.
      it('announces a SUCCESS when the row is gone but a cross-brand sibling keeps the slug', async () => {
        canWrite.set(true);
        listThenWithout('b', [brandA, brandB]);
        await render();
        await fixture.componentInstance.remove(brandB);
        fixture.detectChanges();
        const ack = el().querySelector('[data-testid="wiki-pages-notice"]')!;
        expect(ack)
          .withContext('the row we deleted is gone; the sibling is another brand\'s page')
          .not.toBeNull();
        expect(ack.classList.contains('wiki-success')).toBeTrue();
        expect(ack.textContent!.trim().startsWith('Deleted')).toBeTrue();
        expect(el().querySelector('[data-testid="wiki-pages-action-error"]'))
          .withContext('a slug-keyed check would warn "still listed" about a completed delete')
          .toBeNull();
      });

      it('drops EXACTLY ONE row on the local fallback path too (re-read failed)', async () => {
        // The fallback drop is the one that is NOT server-authoritative, so it is
        // where a slug key would silently take the sibling with it.
        canWrite.set(true);
        let call = 0;
        wiki.listPages.and.callFake(() => {
          call += 1;
          return call === 1
            ? Promise.resolve({ pages: [brandA, brandB] })
            : Promise.reject(new WikiApiError(500, 'boom'));
        });
        await render();
        await fixture.componentInstance.remove(brandB);
        fixture.detectChanges();
        expect(fixture.componentInstance.pages().map((p) => p.id))
          .withContext('a slug key would drop both same-slug rows here')
          .toEqual(['a']);
      });
    });

    it('Cancel dismisses the confirmation without calling the bff', async () => {
      canWrite.set(true);
      await render();
      fixture.componentInstance.askDelete(started);
      fixture.detectChanges();
      (el().querySelector('[data-testid="wiki-delete-cancel-1"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(wiki.deletePage).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-delete-confirm-1"]')).toBeNull();
    });

    it('confirming DELETEs the page, re-reads, drops the row and announces it in role="status"', async () => {
      canWrite.set(true);
      listThenWithout('1');
      await render();
      fixture.componentInstance.askDelete(started);
      fixture.detectChanges();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      expect(wiki.deletePage).toHaveBeenCalledOnceWith('getting-started');
      expect(wiki.listPages)
        .withContext('a 204 is not evidence the row is gone — the list is')
        .toHaveBeenCalledTimes(2);
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-page-runbook"]')).not.toBeNull();
      const ok = el().querySelector('[data-testid="wiki-pages-notice"]')!;
      expect(ok.getAttribute('role')).toBe('status');
      expect(ok.textContent).toContain('getting-started');
    });

    // The bff answers 204 even when its DELETE matched no row (its SUPERADMIN path
    // finds the page cross-brand, then scopes the DELETE to `default`). Announcing
    // a success there would tell the operator a page is gone that still exists.
    it('does NOT announce success when the 204 left the page listed', async () => {
      canWrite.set(true);
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-pages-notice"]'))
        .withContext('a 204 that removed nothing is not a success')
        .toBeNull();
      const err = el().querySelector('[data-testid="wiki-pages-action-error"]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent).toContain('still listed');
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]')).not.toBeNull();
    });

    it('when the confirming re-read fails, drops the row but says it is unconfirmed', async () => {
      canWrite.set(true);
      let call = 0;
      wiki.listPages.and.callFake(() => {
        call += 1;
        return call === 1
          ? Promise.resolve({ pages: [started, runbook] })
          : Promise.reject(new WikiApiError(500, 'boom'));
      });
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]')).toBeNull();
      expect(el().querySelector('[data-testid="wiki-pages-notice"]')!.textContent)
        .toContain('could not be re-read');
    });

    // Parity with the page view: an UNCONFIRMED removal is announced but styled as a
    // warning and never opens with "Deleted". One destructive action, two surfaces —
    // they must not draw opposite conclusions from the same unverified 204.
    it('renders that unconfirmed ack as a WARNING that never opens with "Deleted"', async () => {
      canWrite.set(true);
      let call = 0;
      wiki.listPages.and.callFake(() => {
        call += 1;
        return call === 1
          ? Promise.resolve({ pages: [started, runbook] })
          : Promise.reject(new WikiApiError(503, 'boom'));
      });
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      const ack = el().querySelector('[data-testid="wiki-pages-notice"]')!;
      expect(ack.classList.contains('wiki-warning')).toBeTrue();
      expect(ack.classList.contains('wiki-success')).toBeFalse();
      expect(ack.getAttribute('role')).withContext('still announced').toBe('status');
      expect(ack.textContent!.trim().startsWith('Deleted')).toBeFalse();
      expect(ack.textContent).toContain('unconfirmed');
    });

    it('still renders a CONFIRMED removal as a success', async () => {
      canWrite.set(true);
      listThenWithout('1');
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      const ack = el().querySelector('[data-testid="wiki-pages-notice"]')!;
      expect(ack.classList.contains('wiki-success')).toBeTrue();
      expect(ack.classList.contains('wiki-warning')).toBeFalse();
    });

    it('tells a DENIED confirming re-read apart from a transient one', async () => {
      canWrite.set(true);
      let call = 0;
      wiki.listPages.and.callFake(() => {
        call += 1;
        return call === 1
          ? Promise.resolve({ pages: [started, runbook] })
          : Promise.reject(new WikiApiError(403, 'no'));
      });
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-pages-notice"]')!.textContent)
        .toContain('denied read access');
    });

    it('does NOT call the bff for a non-writer, even on a programmatic confirm', async () => {
      canWrite.set(false);
      await render();
      await fixture.componentInstance.remove(started);
      expect(wiki.deletePage).not.toHaveBeenCalled();
    });

    it('surfaces a 403 delete denial in a role="alert" and keeps the row', async () => {
      canWrite.set(true);
      wiki.deletePage.and.rejectWith(new WikiApiError(403, 'no'));
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      const err = el().querySelector('[data-testid="wiki-pages-action-error"]')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.textContent).toContain('ADMIN or SUPERADMIN');
      expect(wiki.listPages)
        .withContext('a failed DELETE must not trigger the confirming re-read')
        .toHaveBeenCalledTimes(1);
      expect(el().querySelector('[data-testid="wiki-page-getting-started"]'))
        .withContext('a failed delete must not fake the row away')
        .not.toBeNull();
    });

    it('surfaces a 404 (already removed) distinctly from a denial', async () => {
      canWrite.set(true);
      wiki.deletePage.and.rejectWith(new WikiApiError(404, 'gone'));
      await render();
      await fixture.componentInstance.remove(started);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="wiki-pages-action-error"]')!.textContent)
        .toContain('does not exist');
    });
  });
});
