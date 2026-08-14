import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the Wiki remote. Only used when this remote is run on
 * its own (`ng serve wiki`); in production the hugmesh.net host federates
 * `./Wiki` (WIKI_ROUTES) directly and mounts them at /wiki — this shell is not
 * loaded.
 */
@Component({
  selector: 'hug-wiki-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {}
