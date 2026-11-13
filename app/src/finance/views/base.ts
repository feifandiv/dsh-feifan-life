// 财务记账插件 · 视图基类（账本切换器 + 页签容器）
import { App, setIcon } from 'obsidian';
import { FinanceStore } from '../store';
import { LedgerId } from '../models';
import { renderLedgerView } from './ledger-view';
import { renderDetailView, openTransactionModal } from './detail-view';
import { renderBalanceView } from './balance-view';
import { renderDashboardView } from './dashboard-view';
import { renderFundingView } from './funding-view';
import { exportJson, openImportModal } from '../io';

export const VIEW_TYPE_FINANCE = 'finance-ledger-view';

export interface ViewCtx {
  app: any;
  store: FinanceStore;
  rerender: () => void;
}

type TabKey = 'ledger' | 'detail' | 'balance' | 'dashboard' | 'funding';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'ledger', label: '账本' },
  { key: 'detail', label: '收支明细' },
  { key: 'balance', label: '资产负债表' },
  { key: 'dashboard', label: '数据看板' },
  { key: 'funding', label: '资金规划' },
];

export class FinancePanel {
  private store: FinanceStore;
  private activeTab: TabKey = 'ledger';
  private host!: HTMLElement;
  private toolbar!: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private app: App, store: FinanceStore) {
    this.store = store;
  }

  mount(container: HTMLElement): void {
    const root = container;
    root.empty();
    root.addClass('fl-view');
    this.toolbar = root.createDiv('fl-toolbar');
    this.host = root.createDiv('fl-host');
    this.unsub = this.store.subscribe(() => this.render());
    this.render();
  }

  unmount(): void {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }

  private render() {
    this.renderToolbar();
    this.host.empty();
    const ctx: ViewCtx = { app: this.app, store: this.store, rerender: () => this.render() };
    switch (this.activeTab) {
      case 'ledger':
        renderLedgerView(this.host, ctx);
        break;
      case 'detail':
        renderDetailView(this.host, ctx);
        break;
      case 'balance':
        renderBalanceView(this.host, ctx);
        break;
      case 'dashboard':
        renderDashboardView(this.host, ctx);
        break;
      case 'funding':
        renderFundingView(this.host, ctx);
        break;
    }
  }

  private renderToolbar() {
    this.toolbar.empty();
    const brand = this.toolbar.createDiv('fl-brand');
    const brandIcon = brand.createDiv('fl-brand-icon');
    setIcon(brandIcon, 'wallet-cards');
    const brandCopy = brand.createDiv('fl-brand-copy');
    brandCopy.createDiv({ cls: 'fl-brand-title', text: '财务记账' });
    brandCopy.createDiv({ cls: 'fl-brand-sub', text: this.store.current().name });
    const sw = this.toolbar.createDiv('fl-ledger-sw');
    (['personal', 'business'] as LedgerId[]).forEach((id) => {
      const b = sw.createDiv('fl-ledger-btn');
      b.setText(this.store.get().ledgers[id].name);
      if (this.store.get().currentLedger === id) b.addClass('is-active');
      b.addEventListener('click', () => {
        this.host.scrollTop = 0;
        void this.store.setCurrentLedger(id);
      });
    });
    const tabs = this.toolbar.createDiv('fl-tabs');
    TABS.forEach((t) => {
      const b = tabs.createDiv('fl-tab');
      b.setText(t.label);
      if (this.activeTab === t.key) b.addClass('is-active');
      b.addEventListener('click', () => {
        if (this.activeTab === t.key) return;
        this.activeTab = t.key;
        this.render();
        this.host.scrollTop = 0;
      });
    });
    const actions = this.toolbar.createDiv('fl-actions');
    const add = actions.createEl('button', { cls: 'fl-btn fl-btn-primary', attr: { type: 'button' } });
    add.setText('+ 记一笔');
    add.addEventListener('click', () =>
      openTransactionModal(this.app, this.store, undefined, () => this.render())
    );
    const imp = actions.createDiv('fl-btn');
    imp.setText('导入');
    imp.addEventListener('click', () => openImportModal(this.store, () => this.render()));
    const exp = actions.createDiv('fl-btn');
    exp.setText('导出');
    exp.addEventListener('click', () => exportJson(this.store));
  }
}
