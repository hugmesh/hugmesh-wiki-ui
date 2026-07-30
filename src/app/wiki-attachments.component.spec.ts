import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { WikiAttachmentsComponent } from './wiki-attachments.component';
import { WikiService, WikiAttachment, WikiApiError } from './wiki.service';
import { SessionService } from './session.service';

function att(over: Partial<WikiAttachment> = {}): WikiAttachment {
  return {
    id: 'a1',
    filename: 'diagram.png',
    mimeType: 'image/png',
    createdAt: '2026-06-30T12:00:00Z',
    ...over,
  };
}

/** Put a real File into the panel's file input (a DataTransfer-built FileList +
 *  a change event — the exact user gesture, not a component-internals poke). */
function pickFile(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
}

describe('WikiAttachmentsComponent (per-page attachments panel)', () => {
  let fixture: ComponentFixture<WikiAttachmentsComponent>;
  let wiki: jasmine.SpyObj<WikiService>;
  const canWrite = signal(false);

  beforeEach(async () => {
    canWrite.set(false);
    wiki = jasmine.createSpyObj<WikiService>('WikiService', [
      'listAttachments',
      'uploadAttachment',
      'deleteAttachment',
      'downloadAttachment',
    ]);
    wiki.listAttachments.and.resolveTo({ attachments: [att()] });
    await TestBed.configureTestingModule({
      imports: [WikiAttachmentsComponent],
      providers: [
        { provide: WikiService, useValue: wiki },
        { provide: SessionService, useValue: { canWrite } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WikiAttachmentsComponent);
    fixture.componentRef.setInput('slug', 'getting-started');
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
    // The mutate→refresh handlers chain TWO awaits on jasmine resolveTo promises
    // (created outside the Angular zone), so whenStable can resolve between the
    // links. Drain a macrotask so every pending microtask has run, then render
    // the settled state.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('lists the page attachments (metadata rows) for the route slug', async () => {
    await render();
    expect(wiki.listAttachments).toHaveBeenCalledWith('getting-started');
    const list = el().querySelector('[data-testid="wiki-att-list"]')!;
    expect(list.textContent).toContain('diagram.png');
    expect(list.textContent).toContain('image/png');
  });

  it('shows the empty state when the page has no attachments', async () => {
    wiki.listAttachments.and.resolveTo({ attachments: [] });
    await render();
    expect(el().querySelector('[data-testid="wiki-att-empty"]')!.textContent)
      .toContain('No attachments');
    expect(el().querySelector('[data-testid="wiki-att-list"]')).toBeNull();
  });

  it('surfaces a list-load 403 truthfully (no empty-state masking)', async () => {
    wiki.listAttachments.and.rejectWith(new WikiApiError(403, 'denied'));
    await render();
    const alert = el().querySelector('[data-testid="wiki-att-load-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('denied access');
    expect(el().querySelector('[data-testid="wiki-att-empty"]')).toBeNull();
  });

  describe('as a reader (canWrite = false): upload/delete are DENIED — disabled + role helptext', () => {
    it('renders Upload aria-disabled with the role helptext, and the file input disabled', async () => {
      await render();
      const upload = el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-upload"]')!;
      expect(upload.getAttribute('aria-disabled')).toBe('true');
      expect(upload.getAttribute('aria-describedby')).toBe('wiki-att-write-help');
      expect(el().querySelector<HTMLInputElement>('[data-testid="wiki-att-file"]')!.disabled).toBeTrue();
      expect(el().querySelector('[data-testid="wiki-att-write-help"]')!.textContent)
        .toContain('requires the ADMIN or SUPERADMIN role');
    });

    it('never calls the upload endpoint even on a programmatic click', async () => {
      await render();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-upload"]')!.click();
      await fixture.whenStable();
      expect(wiki.uploadAttachment).not.toHaveBeenCalled();
    });

    it('renders Delete aria-disabled (tab-reachable, helptext-linked) and never calls the delete endpoint', async () => {
      await render();
      const del = el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-delete-diagram.png"]')!;
      expect(del.getAttribute('aria-disabled')).toBe('true');
      expect(del.getAttribute('aria-describedby')).toBe('wiki-att-write-help');
      del.click();
      await fixture.whenStable();
      expect(wiki.deleteAttachment).not.toHaveBeenCalled();
    });

    it('still offers Download (read-tier, like the page itself)', async () => {
      await render();
      const dl = el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-download-diagram.png"]')!;
      expect(dl.getAttribute('aria-disabled')).toBeNull();
      expect(dl.disabled).toBeFalse();
    });
  });

  describe('as a writer (canWrite = true)', () => {
    beforeEach(() => canWrite.set(true));

    it('uploads the picked file, announces success and refreshes the list', async () => {
      wiki.uploadAttachment.and.resolveTo(att({ filename: 'notes.txt', mimeType: 'text/plain' }));
      await render();
      const fileInput = el().querySelector<HTMLInputElement>('[data-testid="wiki-att-file"]')!;
      const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
      pickFile(fileInput, file);
      wiki.listAttachments.calls.reset();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-upload"]')!.click();
      await render();
      expect(wiki.uploadAttachment).toHaveBeenCalledWith('getting-started', file);
      expect(wiki.listAttachments).toHaveBeenCalledWith('getting-started');
      expect(el().querySelector('[data-testid="wiki-att-notice"]')!.textContent)
        .toContain('Uploaded notes.txt');
      expect(fileInput.value).toBe('');
    });

    it('asks for a file before uploading (no request without one)', async () => {
      await render();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-upload"]')!.click();
      await render();
      expect(wiki.uploadAttachment).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="wiki-att-error"]')!.textContent)
        .toContain('Choose a file');
    });

    it('surfaces an upload 403 truthfully — an alert, and NO success notice', async () => {
      wiki.uploadAttachment.and.rejectWith(new WikiApiError(403, 'denied'));
      await render();
      pickFile(
        el().querySelector<HTMLInputElement>('[data-testid="wiki-att-file"]')!,
        new File(['x'], 'x.bin', { type: 'application/octet-stream' }),
      );
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-upload"]')!.click();
      await render();
      const alert = el().querySelector('[data-testid="wiki-att-error"]')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain('requires the ADMIN or SUPERADMIN role');
      expect(el().querySelector('[data-testid="wiki-att-notice"]')).toBeNull();
    });

    it('deletes an attachment, announces it and refreshes the list', async () => {
      wiki.deleteAttachment.and.resolveTo();
      await render();
      wiki.listAttachments.calls.reset();
      wiki.listAttachments.and.resolveTo({ attachments: [] });
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-delete-diagram.png"]')!.click();
      await render();
      expect(wiki.deleteAttachment).toHaveBeenCalledWith('getting-started', 'diagram.png');
      expect(el().querySelector('[data-testid="wiki-att-notice"]')!.textContent)
        .toContain('Deleted diagram.png');
      expect(el().querySelector('[data-testid="wiki-att-empty"]')).not.toBeNull();
    });

    it('surfaces a delete failure truthfully (the row stays)', async () => {
      wiki.deleteAttachment.and.rejectWith(new WikiApiError(500, 'boom'));
      await render();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-delete-diagram.png"]')!.click();
      await render();
      expect(el().querySelector('[data-testid="wiki-att-error"]')!.textContent)
        .toContain('Could not delete');
      expect(el().querySelector('[data-testid="wiki-att-list"]')!.textContent)
        .toContain('diagram.png');
    });
  });

  describe('download (read-tier)', () => {
    it('fetches the bytes through the service and hands them to a save (object URL)', async () => {
      const blob = new Blob(['bytes'], { type: 'image/png' });
      wiki.downloadAttachment.and.resolveTo(blob);
      const createUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
      const revokeUrl = spyOn(URL, 'revokeObjectURL');
      await render();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-download-diagram.png"]')!.click();
      await render();
      expect(wiki.downloadAttachment).toHaveBeenCalledWith('getting-started', 'diagram.png');
      expect(createUrl).toHaveBeenCalledWith(blob);
      expect(revokeUrl).toHaveBeenCalledWith('blob:test');
      expect(el().querySelector('[data-testid="wiki-att-error"]')).toBeNull();
    });

    it('surfaces a download failure truthfully', async () => {
      wiki.downloadAttachment.and.rejectWith(new WikiApiError(404, 'gone'));
      await render();
      el().querySelector<HTMLButtonElement>('[data-testid="wiki-att-download-diagram.png"]')!.click();
      await render();
      expect(el().querySelector('[data-testid="wiki-att-error"]')!.textContent)
        .toContain('no longer exists');
    });
  });
});
