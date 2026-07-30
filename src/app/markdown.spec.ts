import { renderMarkdown, sanitizeContentHtml } from './markdown';

describe('renderMarkdown (editor preview)', () => {
  it('renders headings/bold/lists as sanitized HTML', () => {
    const html = renderMarkdown('# Title\n\n**bold** and *em*\n\n- one\n- two');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>one</li>');
  });

  it('keeps http links but strips a javascript: link target', () => {
    expect(renderMarkdown('[ok](https://example.com)')).toContain('href="https://example.com"');
    const danger = renderMarkdown('[x](javascript:alert(1))');
    expect(danger).not.toContain('javascript:');
    expect(danger.toLowerCase()).not.toContain('<script');
  });

  it('never emits a <script> tag even when the source contains one', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
  });
});

describe('sanitizeContentHtml (server-HTML boundary)', () => {
  it('keeps structural tags', () => {
    const html = sanitizeContentHtml('<h1>T</h1><p>body</p><ul><li>x</li></ul>');
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<li>x</li>');
  });

  it('strips script + event handlers (defence-in-depth on the read path)', () => {
    const html = sanitizeContentHtml('<p onclick="evil()">hi</p><script>alert(1)</script>');
    expect(html).toContain('hi');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('forces rel="noopener noreferrer" on target="_blank" links (reverse-tabnabbing) while keeping benign markup', () => {
    const html = sanitizeContentHtml(
      '<p>see <a href="https://example.com" target="_blank">link</a></p>' +
        '<img src=x onerror="alert(1)"><script>alert(1)</script>',
    );
    // benign markup survives
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>link</a>');
    expect(html).toContain('see ');
    // reverse-tabnabbing guard applied
    expect(html).toContain('rel=');
    expect(html).toContain('noopener');
    expect(html).toContain('noreferrer');
    // XSS payloads stripped
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('does not add rel to links without a target', () => {
    const html = sanitizeContentHtml('<p><a href="https://example.com">x</a></p>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('rel=');
  });

  it('drops non-http(s) hrefs (mailto:/relative/data:) — the absolute-http-only link policy', () => {
    const html = sanitizeContentHtml(
      '<p><a href="mailto:a@b.c">m</a><a href="/relative">r</a><a href="data:text/html,x">d</a></p>',
    );
    // The anchors survive as inert text; every non-http(s) href is removed.
    expect(html).toContain('>m</a>');
    expect(html).toContain('>r</a>');
    expect(html).toContain('>d</a>');
    expect(html).not.toContain('href=');
  });
});
