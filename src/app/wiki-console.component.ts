import { Component, ElementRef, QueryList, ViewChildren, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SessionService } from './session.service';

interface WikiNavItem {
  path: string;
  label: string;
  /** accessibleName — the screen-reader announce for the link. */
  aria: string;
  /** the inline help text (sighted) linked via aria-describedby (no-sight). */
  help: string;
  show: () => boolean;
}

/**
 * The wiki console shell — a role-aware menubar (roving tabindex, WAI-ARIA APG)
 * over the role-gated child views, plus the swappable content outlet.
 *
 * The nav items are SHOWN BY ROLE (defence-in-depth; the child guards + the bff
 * are authoritative):
 *   Content  (pages)  — shown to WIKI_READ (admin|superadmin|mod+wiki).
 *   New page (new)    — shown to WIKI_WRITE (admin|superadmin).
 *   Access   (access) — shown to WIKI_WRITE (admin|superadmin).
 *   Manage   (manage) — shown to WIKI_MANAGE (superadmin).
 * So a MOD sees only Content (read-only); an ADMIN additionally sees New + Access;
 * a SUPERADMIN additionally sees Manage. A user with NONE of the wiki roles sees
 * an empty menubar and the content view's read-guard sends them to /forbidden.
 *
 * a11y: <nav role="menubar"> with roving tabindex + Arrow/Home/End keyboard
 * navigation; routerLinkActive marks the current view aria-current="page"; every
 * link carries an accessibleName + an aria-describedby help hint.
 */
@Component({
  selector: 'hug-wiki-console',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './wiki-console.component.html',
  styleUrl: './wiki-console.component.scss',
})
export class WikiConsoleComponent {
  private readonly session = inject(SessionService);

  @ViewChildren('navlink') navLinks!: QueryList<ElementRef<HTMLAnchorElement>>;

  /** Index of the roving-tabindex'd item that currently holds tabindex=0. */
  active = 0;

  readonly items: WikiNavItem[] = [
    {
      path: 'pages',
      label: 'Content',
      aria: 'Wiki content pages',
      help: 'Browse and read the wiki pages.',
      show: () => this.session.canRead(),
    },
    {
      path: 'new',
      label: 'New page',
      aria: 'Create a new wiki page',
      help: 'Author a new wiki page in markdown. Requires the admin or superadmin role.',
      show: () => this.session.canWrite(),
    },
    {
      path: 'access',
      label: 'Access',
      aria: 'Wiki access — grant, time out, ban, restore',
      help: 'Grant a user wiki read, time them out, ban them, or restore access. Requires the admin or superadmin role.',
      show: () => this.session.canWrite(),
    },
    {
      path: 'manage',
      label: 'Manage',
      aria: 'Wiki management — active overrides, history, audit',
      help: 'Review all active access overrides, a principal\'s full history, and the content audit trail. Superadmin only.',
      show: () => this.session.canManage(),
    },
  ];

  /**
   * Filter the full nav-item list to those visible for the current role.
   * Computed on each change-detection cycle; the predicate reads the same
   * session signals that the child guards enforce.
   *
   * @returns The subset of {@link items} whose `show()` predicate returns `true`.
   */
  visibleItems(): WikiNavItem[] {
    return this.items.filter((i) => i.show());
  }

  /**
   * Roving-tabindex helper — only the active item receives `tabindex="0"`;
   * all others are set to `-1` and reached via Arrow-key navigation.
   * Implements the WAI-ARIA menubar roving-tabindex pattern.
   *
   * @param i - The item's index within the visible list.
   * @returns `0` for the active item, `-1` for all others.
   */
  tabindexFor(i: number): number {
    return i === this.active ? 0 : -1;
  }

  /**
   * Handle Arrow/Home/End keyboard events within the menubar to move focus
   * according to the WAI-ARIA menubar pattern. Calls `preventDefault` on
   * handled keys to suppress browser scrolling.
   *
   * @param event - The `keydown` event from the focused nav link.
   * @param i - The current item's index within the visible list.
   */
  onKey(event: KeyboardEvent, i: number): void {
    const count = this.visibleItems().length;
    if (count === 0) return;
    let next = i;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (i + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (i - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.active = next;
    const links = this.navLinks?.toArray() ?? [];
    links[next]?.nativeElement.focus();
  }
}
