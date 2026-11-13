// 非凡人生 · 插件入口：根数据层 + 三模块 store + 中央视图
import { Plugin, WorkspaceLeaf } from 'obsidian';
import { RootStore } from './store';
import { FinanceStore } from './finance/store';
import { KanbanStore } from './kanban/store';
import { LifeListStore } from './life/store';
import { CommandCenterView, VIEW_TYPE_CC, TabKey } from './views/base';
import { syncToVault } from './kanban/sync';
import { ThemeController, ThemeMode, registerTheme, unregisterTheme } from './design-system/theme';
import { closeSelect } from './design-system/select';
import { closeModals } from './design-system/modal';
import { closeMenus } from './design-system/menu';

export default class CommandCenterPlugin extends Plugin {
  stores!: {
    root: RootStore;
    finance: FinanceStore;
    kanban: KanbanStore;
    life: LifeListStore;
  };
  activeView: CommandCenterView | null = null;
  theme!: ThemeController;

  async onload(): Promise<void> {
    const root = new RootStore(this);
    this.stores = {
      root,
      finance: new FinanceStore({ root }),
      kanban: new KanbanStore({ root }),
      life: new LifeListStore({ root }),
    };

    // 根数据 → 各命名空间 store。旧插件目录不参与运行时流程。
    await root.load();
    root.normalize();
    await this.stores.life.load();
    await this.stores.finance.load();
    await this.stores.kanban.load();
    await root.save();
    this.theme = new ThemeController();
    registerTheme(this.app, this.theme);
    this.theme.setMode(root.data.settings.themeMode ?? 'system');

    this.registerView(VIEW_TYPE_CC, (leaf: WorkspaceLeaf) => new CommandCenterView(leaf, this));

    this.addRibbonIcon('command', '非凡人生', () => this.activate());
    this.addCommand({ id: 'open-command-center', name: '打开非凡人生', callback: () => this.activate() });
    const jumps: [string, TabKey][] = [
      ['总览', 'overview'], ['任务', 'tasks'], ['规划', 'planning'], ['财务', 'finance'],
      ['清单', 'life'], ['习惯', 'habits'], ['灵感', 'inspiration'], ['复盘', 'review'],
    ];
    for (const [label, tab] of jumps) {
      this.addCommand({ id: 'goto-' + tab, name: '跳转：' + label, callback: () => this.activate(tab) });
    }
    this.addCommand({
      id: 'sync-task-mirror',
      name: '同步任务镜像到03任务看板',
      callback: () => void syncToVault({ app: this.app, store: this.stores.kanban }),
    });

  }

  async onunload(): Promise<void> {
    closeSelect();
    closeMenus(this.app);
    closeModals(this.app);
    await this.stores?.root?.flush().catch((error) => console.error('[非凡人生] 卸载前保存失败', error));
    this.theme?.destroy();
    unregisterTheme(this.app);
  }

  async activate(tab: TabKey = 'overview'): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CC)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CC, active: true });
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof CommandCenterView) {
      this.activeView = view;
      view.setTab(tab);
    }
  }

  setThemeMode(mode: ThemeMode): void {
    this.theme.setMode(mode);
    void this.stores.root.mutate((d) => { d.settings.themeMode = mode; });
  }
}
