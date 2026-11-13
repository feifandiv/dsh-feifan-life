import { App, setIcon } from 'obsidian';
import { TabKey } from '../models';
import { LifeListStore } from '../store';
import { renderInputTopActions, renderInputView } from './input-view';
import { renderDashboardView } from './dashboard-view';
import { renderInventoryTopActions, renderInventoryView } from './inventory-view';
import { renderOptionsView } from './options-view';

export const VIEW_TYPE_LIFE_LIST = 'life-list-view';

export interface ViewCtx {
  app: any;
  store: LifeListStore;
  rerender: () => void;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'inputs', label: '输入清单' },
  { key: 'inventory', label: '物资清单' },
  { key: 'options', label: '选项设置' },
  { key: 'dashboard', label: '数据看板' },
];

export class LifePanel {
  private activeTab: TabKey = 'inputs';
  private toolbar!: HTMLElement;
  private host!: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private app: App, private store: LifeListStore) {
  }

  mount(container: HTMLElement): void {
    const root = container;
    root.empty();
    root.addClass('ll-view');
    this.toolbar = root.createDiv('ll-toolbar');
    this.host = root.createDiv('ll-host');
    this.activeTab = this.store.settings().defaultView;
    this.unsub = this.store.subscribe(() => this.render());
    this.render();
  }

  unmount(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private render() {
    this.renderToolbar();
    this.renderContent();
  }

  private renderContent() {
    this.host.empty();
    const ctx: ViewCtx = { app: this.app, store: this.store, rerender: () => this.renderContent() };
    if (this.activeTab === 'dashboard') renderDashboardView(this.host, ctx);
    else if (this.activeTab === 'inventory') renderInventoryView(this.host, ctx);
    else if (this.activeTab === 'options') renderOptionsView(this.host, ctx);
    else renderInputView(this.host, ctx);
  }

  private renderToolbar() {
    this.toolbar.empty();
    const brand = this.toolbar.createDiv('ll-brand');
    const brandIcon = brand.createDiv('ll-brand-icon');
    brandIcon.setAttribute('title', '清单');
    brandIcon.setAttribute('aria-label', '清单');
    setIcon(brandIcon, 'list-checks');
    const tabs = this.toolbar.createDiv('ll-tabs');
    TABS.forEach((tab) => {
      const b = tabs.createEl('button', { cls: 'll-tab', text: tab.label });
      b.classList.toggle('is-active', this.activeTab === tab.key);
      b.addEventListener('click', () => {
        if (this.activeTab === tab.key) return;
        this.activeTab = tab.key;
        this.render();
        this.host.scrollTop = 0;
        this.host.scrollLeft = 0;
      });
    });
    const actions = this.toolbar.createDiv('ll-actions');
    if (this.activeTab === 'inputs') {
      const ctx: ViewCtx = { app: this.app, store: this.store, rerender: () => this.renderContent() };
      renderInputTopActions(actions, ctx);
    } else if (this.activeTab === 'inventory') {
      const ctx: ViewCtx = { app: this.app, store: this.store, rerender: () => this.renderContent() };
      renderInventoryTopActions(actions, ctx);
    }
  }
}
