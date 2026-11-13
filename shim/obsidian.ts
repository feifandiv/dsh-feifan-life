/**
 * The `obsidian` module for the port.
 *
 * esbuild aliases the plugin's `import ... from 'obsidian'` here, so the ported
 * source stays byte-identical to the Obsidian build. Each class mirrors the
 * subset of Obsidian's contract the plugin actually uses; see
 * `_docs/shim-contract.md` for the audited call surface.
 */
import { App } from './app';
import { buildIcon } from './dom';
import type { ViewFactory } from './workspace';
import { ItemView, WorkspaceLeaf } from './workspace';
import { Modal, Menu, Notice, PluginSettingTab, Scope, Setting } from './ui';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  isDesktopOnly?: boolean;
}

export interface Command {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
  hotkeys?: Array<{ modifiers: string[]; key: string }>;
}

export class Plugin {
  readonly app: App;
  readonly manifest: PluginManifest;
  private commands: Command[] = [];
  private ribbons: Array<{ icon: string; title: string; callback: () => void }> = [];
  private settingTabs: PluginSettingTab[] = [];
  private disposers: Array<() => void> = [];

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
  }

  async onload(): Promise<void> {}
  async onunload(): Promise<void> {}

  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> {}

  registerView(type: string, factory: ViewFactory): void {
    this.app.workspace.registerView(type, factory);
  }

  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => void): HTMLElement {
    this.ribbons.push({ icon, title, callback: () => callback(new MouseEvent('click')) });
    return document.createElement('div');
  }

  addCommand(command: Command): Command {
    this.commands.push(command);
    return command;
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  registerEvent(eventRef: { unload?: () => void } | null): void {
    if (eventRef && typeof eventRef.unload === 'function') this.disposers.push(() => eventRef.unload?.());
  }

  registerInterval(id: number): number {
    this.disposers.push(() => window.clearInterval(id));
    return id;
  }

  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Document | Window,
    type: K | string,
    callback: (event: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const target = el as unknown as HTMLElement;
    target.addEventListener(type as string, callback, options);
    this.disposers.push(() => target.removeEventListener(type as string, callback, options));
  }

  register(callback: () => void): void {
    this.disposers.push(callback);
  }

  registerMarkdownPostProcessor(): void {}

  get ribbons_(): Array<{ icon: string; title: string; callback: () => void }> { return this.ribbons; }
  get commands_(): Command[] { return this.commands; }
  get settingTabs_(): PluginSettingTab[] { return this.settingTabs; }

  disposeRegistrations(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

/** Obsidian's icon helper: replace an element's content with one Lucide glyph. */
export function setIcon(el: HTMLElement, iconName: string): void {
  el.empty();
  el.appendChild(buildIcon(iconName, 24));
}

export function setTooltip(el: HTMLElement, tooltip: string): void {
  el.setAttribute('aria-label', tooltip);
  el.title = tooltip;
}

export function debounce<T extends (...args: never[]) => unknown>(callback: T, delay = 0): T {
  let timer: number | null = null;
  return ((...args: never[]) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  }) as T;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function moment(): { format(fmt: string): string } {
  return {
    format: (fmt: string) => {
      const date = new Date();
      return fmt
        .replace('YYYY', String(date.getFullYear()))
        .replace('MM', String(date.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(date.getDate()).padStart(2, '0'));
    },
  };
}

export { App, ItemView, WorkspaceLeaf, Modal, Scope, Menu, Notice, Setting, PluginSettingTab };
export { TAbstractFile, TFile, TFolder } from './vault';
export type { Vault } from './vault';
export type { PluginManifest as Manifest };
export { Workspace } from './workspace';
