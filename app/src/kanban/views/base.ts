// 中央标签页视图基类（迭代 002：页签容器 + 数据订阅；迭代 005：同步按钮 + 默认视图）
import { App, setIcon } from 'obsidian';
import type { KanbanCtx } from '../models';
import { renderProjectBoard } from './project-board';
import { openTaskForm, renderTaskBoard, revealTaskInBoard } from './task-board';
import { syncToVault } from '../sync';

export const VIEW_TYPE_KANBAN = 'project-kanban-view';

type TabKey = 'project' | 'task';

export class KanbanPanel {
  plugin: KanbanCtx;
  containerEl: HTMLElement = document.createElement('div');
  private activeTab: TabKey = 'task';
  private host!: HTMLElement;
  private newTaskBtn!: HTMLButtonElement;
  private unsub?: () => void;

  constructor(plugin: KanbanCtx) {
    this.plugin = plugin;
  }

  mount(container: HTMLElement): void {
    this.containerEl = container;
    const root = container;
    root.empty();
    root.addClass('pk-view');

    const shell = root.createDiv({ cls: 'pk-shell' });

    // 顶部栏：页签 + 同步按钮（迭代 005）
    const bar = shell.createDiv({ cls: 'pk-shell__bar' });
    const brand = bar.createDiv({ cls: 'pk-brand' });
    const brandIcon = brand.createDiv({ cls: 'pk-brand__icon' });
    setIcon(brandIcon, 'square-kanban');
    const brandCopy = brand.createDiv({ cls: 'pk-brand__copy' });
    brandCopy.createDiv({ cls: 'pk-brand__title', text: '项目看板' });
    brandCopy.createDiv({ cls: 'pk-brand__sub', text: '项目与任务' });
    const tabs = bar.createDiv({ cls: 'pk-tabs' });
    const tabProject = tabs.createEl('button', { cls: 'pk-tab', text: '项目看板' });
    const tabTask = tabs.createEl('button', { cls: 'pk-tab', text: '任务看板' });
    tabProject.addEventListener('click', () => this.switchTab('project'));
    tabTask.addEventListener('click', () => this.switchTab('task'));

    const actions = bar.createDiv({ cls: 'pk-shell__actions' });
    this.newTaskBtn = actions.createEl('button', { cls: 'pk-btn pk-btn--primary pk-shell__new-task' });
    setIcon(this.newTaskBtn, 'plus');
    this.newTaskBtn.createSpan({ text: '新建任务' });
    this.newTaskBtn.addEventListener('click', () => openTaskForm(this.plugin));
    const syncBtn = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost' });
    setIcon(syncBtn, 'refresh-cw');
    syncBtn.createSpan({ text: '同步到知识库' });
    syncBtn.addEventListener('click', () => void syncToVault(this.plugin));

    this.host = shell.createDiv({ cls: 'pk-board-host' });

    // 默认视图（设置项）
    const defaultView = this.plugin.store.getSettings().defaultView;
    this.activeTab = defaultView === 'project' ? 'project' : 'task';

    // 视图内容随数据变化重渲染
    this.unsub = this.plugin.store.subscribe(() => this.renderActive());
    this.renderActive();
    this.updateTabs(tabProject, tabTask);
    this.updateActions();
  }

  private switchTab(tab: TabKey): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    const tabs = this.rootTabs();
    if (tabs) this.updateTabs(tabs.project, tabs.task);
    this.updateActions();
    this.renderActive();
    this.host.scrollTop = 0;
  }

  private rootTabs(): { project: HTMLElement; task: HTMLElement } | null {
    const tabsEl = this.containerEl.querySelector('.pk-tabs');
    if (!tabsEl) return null;
    const btns = tabsEl.querySelectorAll('.pk-tab');
    if (btns.length < 2) return null;
    return {
      project: btns[0] as HTMLElement,
      task: btns[1] as HTMLElement,
    };
  }

  private updateTabs(project: HTMLElement, task: HTMLElement): void {
    project.classList.toggle('is-active', this.activeTab === 'project');
    task.classList.toggle('is-active', this.activeTab === 'task');
  }

  private updateActions(): void {
    this.newTaskBtn?.classList.toggle('is-hidden', this.activeTab !== 'task');
  }

  revealTask(taskId: string, subtaskId?: string): void {
    if (this.activeTab !== 'task') {
      this.activeTab = 'task';
      const tabs = this.rootTabs();
      if (tabs) this.updateTabs(tabs.project, tabs.task);
      this.updateActions();
    }
    revealTaskInBoard(this.host, this.plugin, taskId, subtaskId);
  }

  refreshFocusIndicators(): void {
    if (!this.plugin.focus || !this.containerEl.isConnected) return;
    this.containerEl.querySelectorAll<HTMLButtonElement>('.pk-focus-btn[data-task-id]').forEach((button) => {
      const taskId = button.dataset.taskId;
      if (!taskId) return;
      const pinned = this.plugin.focus!.isPinned(taskId, button.dataset.subtaskId);
      button.classList.toggle('is-pinned', pinned);
      button.setAttribute('aria-pressed', String(pinned));
      button.setAttribute('aria-label', pinned ? '移出今日聚焦' : '加入今日聚焦');
      button.setAttribute('title', pinned ? '移出今日聚焦' : '加入今日聚焦');
    });
  }

  private renderActive(): void {
    if (this.activeTab === 'project') {
      renderProjectBoard(this.host, this.plugin);
    } else {
      renderTaskBoard(this.host, this.plugin);
    }
  }

  unmount(): void {
    this.unsub?.();
    this.unsub = undefined;
  }
}
