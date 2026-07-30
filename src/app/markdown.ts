import DOMPurify from 'dompurify';

/** The link policy both sanitizers enforce: absolute http(s) URLs ONLY.
 *  Enforced in the afterSanitizeAttributes hook below — NOT via a custom
 *  ALLOWED_URI_REGEXP, because DOMPurify applies that regexp to EVERY
 *  attribute value outside its URI-safe set: an https?-only pattern silently
 *  strips target="_blank" (and rel tokens) before the hook runs, defeating
 *  the reverse-tabnabbing guard. */
const HTTP_ONLY_HREF = /^https?:\/\//i;

/**
 * Link-hardening at the sanitize boundary, registered once at module load so
 * EVERY DOMPurify.sanitize() call below is covered without widening the
 * allow-list:
 *  1. http(s)-only hrefs — any other target (javascript:/data:/mailto:/
 *     relative) loses its href, leaving an inert anchor;
 *  2. reverse-tabnabbing guard — any <a> that opens a new browsing context (a
 *     target attribute, esp. target="_blank") must carry rel="noopener
 *     noreferrer" so the opened page cannot reach back via window.opener.
 *     Existing rel tokens are preserved + augmented. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'A') {
    return;
  }
  if (node.hasAttribute('href') && !HTTP_ONLY_HREF.test(node.getAttribute('href') ?? '')) {
    node.removeAttribute('href');
  }
  if (node.hasAttribute('target')) {
    const tokens = new Set((node.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
    tokens.add('noopener');
    tokens.add('noreferrer');
    node.setAttribute('rel', Array.from(tokens).join(' '));
  }
});

/**
 * Minimal, safe Markdown → sanitized-HTML helper for the wiki editor's live
 * preview. This is CLIENT-SIDE convenience ONLY: the AUTHORITATIVE render is the
 * hugmesh-wiki-bff-api MarkdownRenderer at write time — the bff stores +
 * returns content_html, which the page VIEW renders (still defensively, never
 * trusted to be script-free at this layer). The preview lets an author see the
 * shape of their markdown before they POST/PUT.
 *
 * The renderer covers the common subset (headings, bold/italic/code, links,
 * lists, blockquote, paragraphs) and then passes everything through DOMPurify
 * with a conservative allow-list so a preview can never execute script.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  let t = escapeHtml(text);
  // code spans first so their contents aren't further transformed
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // [text](http(s)://url) — only http/https targets become links.
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`;
  });
  // A markdown link whose target is NOT http(s) (e.g. javascript:/data:) is
  // left as inert plain text by the rule above — but neutralize the dangerous
  // SCHEME token so even the literal text can't read as an actionable URL.
  t = t.replace(/\[[^\]]*\]\(\s*(javascript|data|vbscript|file)\s*:[^)]*\)/gi, '[link removed]');
  return t;
}

/** Render a small Markdown subset to a SANITIZED HTML string. */
export function renderMarkdown(src: string): string {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listOpen = false;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1; // h2..h4 (h1 is the page title)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      flushParagraph();
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();

  const html = out.join('\n');
  // NB: the http(s)-only href policy lives in the afterSanitizeAttributes hook
  // above (see HTTP_ONLY_HREF) — deliberately NOT ALLOWED_URI_REGEXP here.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h2', 'h3', 'h4', 'p', 'strong', 'em', 'code', 'a', 'ul', 'li', 'blockquote', 'br'],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  });
}

/** Sanitize SERVER-RENDERED content_html before it is bound into the page view.
 *  The wiki-bff already renders + (in PR4's pipeline) packages this; we still
 *  re-sanitize at the browser boundary (defence-in-depth) so a compromised
 *  upstream can never inject script into the reader's DOM. The allow-list is a
 *  superset of the editor preview (the bff renderer may emit more structure). */
export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'code', 'pre',
      'a', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr', 'table', 'thead',
      'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  });
}
