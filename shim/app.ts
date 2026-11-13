/**
 * `app` for the port. Obsidian's App is a service locator; the plugin only
 * reaches into three members (`vault`, `workspace`, `metadataCache`) plus a
 * settings entry point it never opens directly.
 */
import { Vault, MetadataCache } from './vault';
import { Workspace } from './workspace';

export class App {
  readonly vault: Vault;
  readonly workspace: Workspace;
  readonly metadataCache: MetadataCache;
  readonly setting = {
    open(): void {},
    openTabById(_id: string): void {},
    close(): void {},
  };
  readonly isMobile = false;
  readonly lastEvent: unknown = null;
  /** Where a new leaf's container is attached; set by the overlay shell. */
  mountTarget: HTMLElement | null = null;

  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace(this);
    this.metadataCache = new MetadataCache(this.vault);
  }
}
