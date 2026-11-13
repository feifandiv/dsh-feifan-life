/**
 * Workspace + leaf + item view, the minimum of Obsidian's layout the plugin
 * uses. `plugin.activate()` asks the workspace for a leaf of its view type and
 * reveals it; here that leaf appends the view's container into the stage
 * element the DSH overlay owns, and revealing shows the overlay.
 */
import type { App } from './app';
import { TFile } from './vault';
import { openNotePreview } from './note-view';

export type ViewFactory = (leaf: WorkspaceLeaf) => ItemView;

export interface ViewState {
  type: string;
  active?: boolean;
  state?: Record<string, unknown>;
}

export class WorkspaceLeaf {
  readonly app: App;
  readonly containerEl: HTMLElement;
  view!: ItemView;
  private viewState: ViewState | null = null;

  constructor(app: App) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf';
  }

  getViewState(): ViewState | null {
    return this.viewState;
  }

  async setViewState(state: ViewState): Promise<void> {
    this.viewState = state;
    const factory = this.app.workspace.viewFactories.get(state.type);
    if (!factory) throw new Error('No view registered for type: ' + state.type);
    if (this.view) await this.view.onClose();
    this.containerEl.empty();
    const view = factory(this);
    this.view = view;
    this.containerEl.appendChild(view.containerEl);
    this.app.workspace.mountTarget?.appendChild(this.containerEl);
    await view.onOpen();
  }

  /**
   * Obsidian opens a note in the leaf's editor. The port resolves the note and
   * shows it in a read-only preview dialog instead (see shim/note-view.ts).
   */
  async openFile(file: TFile | string, _state?: Record<string, unknown>): Promise<void> {
    const target = typeof file === 'string' ? this.app.vault.getAbstractFileByPath(file) : file;
    if (!(target instanceof TFile)) throw new Error('Note not found: ' + String(file));
    await openNotePreview(this.app, target);
  }

  async detach(): Promise<void> {
    if (this.view) await this.view.onClose();
    this.containerEl.remove();
    this.app.workspace.removeLeaf(this);
  }
}

export class ItemView {
  readonly app: App;
  readonly leaf: WorkspaceLeaf;
  readonly containerEl: HTMLElement;
  readonly contentEl: HTMLElement;
  readonly headerEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly iconEl: HTMLElement;
  scope: unknown = null;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
    this.headerEl = this.containerEl.createDiv({ cls: 'view-header' });
    this.titleEl = this.headerEl.createDiv({ cls: 'view-header-title' });
    this.iconEl = this.headerEl.createDiv({ cls: 'view-header-icon' });
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    this.contentEl.style.height = '100%';
  }

  getViewType(): string { return 'unknown'; }
  getDisplayText(): string { return 'Unknown'; }
  getIcon(): string { return 'document'; }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  setTitle(title: string): void { this.titleEl.setText(title); }
  addAction(): HTMLElement { return document.createElement('div'); }
  addEphemeralState(): void {}
}

export class Workspace {
  readonly viewFactories = new Map<string, ViewFactory>();
  readonly leaves: WorkspaceLeaf[] = [];
  mountTarget: HTMLElement | null = null;
  revealHandler: ((leaf: WorkspaceLeaf) => void) | null = null;
  activeLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App) {}

  registerView(type: string, factory: ViewFactory): void {
    this.viewFactories.set(type, factory);
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.getViewState()?.type === type);
  }

  getLeaf(_newLeaf?: string | boolean): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(this.app);
    this.leaves.push(leaf);
    return leaf;
  }

  getRightLeaf(_split?: boolean): WorkspaceLeaf {
    return this.getLeaf();
  }

  getLeafById(): null { return null; }

  revealLeaf(leaf: WorkspaceLeaf): void {
    this.activeLeaf = leaf;
    this.revealHandler?.(leaf);
  }

  removeLeaf(leaf: WorkspaceLeaf): void {
    const index = this.leaves.indexOf(leaf);
    if (index >= 0) this.leaves.splice(index, 1);
    if (this.activeLeaf === leaf) this.activeLeaf = null;
  }

  setActiveLeaf(leaf: WorkspaceLeaf): void {
    this.activeLeaf = leaf;
  }

  on(_name: string, _callback: (...args: unknown[]) => void): { unload(): void } {
    return { unload(): void {} };
  }

  off(): void {}
  offref(): void {}

  onLayoutReady(callback: () => void): void {
    window.setTimeout(callback, 0);
  }

  detachLeavesOfType(type: string): void {
    for (const leaf of this.getLeavesOfType(type)) void leaf.detach();
  }
}
