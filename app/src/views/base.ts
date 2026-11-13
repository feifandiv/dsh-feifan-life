// 非凡人生 · 中央视图壳：Hero + 一级页签 + 模块挂载 + 右栏
import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type CommandCenterPlugin from '../main';
import { FfMenu } from '../design-system/menu';
import { FinancePanel } from '../finance/views/base';
import { KanbanPanel } from '../kanban/views/base';
import { LifePanel } from '../life/views/base';
import { PRIORITIES, subtaskComplete, taskIsDone, taskSubtasks } from '../kanban/models';
import { renderHero, renderOverviewPanel, renderHabitsPanel, renderReviewPanel, renderPlanningPanel, renderInspirationPanel, selectPlanningView } from './dashboard';

export const VIEW_TYPE_CC = 'command-center-view';

export type TabKey = 'overview' | 'tasks' | 'planning' | 'finance' | 'life' | 'habits' | 'inspiration' | 'review';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '总览' },
  { key: 'tasks', label: '任务' },
  { key: 'planning', label: '规划' },
  { key: 'finance', label: '财务' },
  { key: 'life', label: '清单' },
  { key: 'habits', label: '习惯' },
  { key: 'inspiration', label: '灵感' },
  { key: 'review', label: '复盘' },
];

interface SearchResult {
  group: string;
  title: string;
  detail?: string;
  status?: 'completed' | 'archived';
  completedAt?: number | null;
  tab: TabKey;
  taskId?: string;
  subtaskId?: string;
  planningView?: 'goals' | 'visions';
  planningYear?: number | null;
}

export class CommandCenterView extends ItemView {
  private activeTab: TabKey = 'overview';
  private finPanel: FinancePanel;
  private kanbanPanel: KanbanPanel;
  private lifePanel: LifePanel;
  private mounted = new Set<TabKey>();
  private panelEls = new Map<TabKey, HTMLElement>();
  private unsubs: (() => void)[] = [];
  private refreshTimer: number | null = null;
  private renderedDate = localDateKey();
  private detachTheme: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: CommandCenterPlugin) {
    super(leaf);
    this.finPanel = new FinancePanel(this.app, this.plugin.stores.finance);
    this.kanbanPanel = new KanbanPanel({
      store: this.plugin.stores.kanban,
      app: this.app,
      focus: {
        isPinned: (taskId, subtaskId) => this.isFocusPinned(taskId, subtaskId),
        toggle: (taskId, subtaskId) => this.toggleFocusPin(taskId, subtaskId),
      },
    });
    this.lifePanel = new LifePanel(this.app, this.plugin.stores.life);
  }

  getViewType(): string { return VIEW_TYPE_CC; }
  getDisplayText(): string { return '非凡人生'; }
  getIcon(): string { return 'command'; }

  async onOpen(): Promise<void> {
    this.plugin.activeView = this;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('cc-view');
    this.detachTheme = this.plugin.theme.attach(this.containerEl);

    const shell = root.createDiv({ cls: 'cc-shell' });
    const layout = shell.createDiv({ cls: 'cc-layout' });
    const primary = layout.createDiv({ cls: 'cc-primary' });
    const hero = primary.createDiv({ cls: 'hero' });
    renderHero(hero, this.plugin);

    const tabsBar = primary.createDiv({ cls: 'cc-tabs', attr: { role: 'tablist', 'aria-label': '非凡人生导航' } });
    for (const t of TABS) {
      const b = tabsBar.createEl('button', { cls: 'cc-tab' + (t.key === this.activeTab ? ' active' : ''), attr: { 'data-tab': t.key, role: 'tab', 'aria-selected': String(t.key === this.activeTab) } });
      b.setText(t.label);
      b.addEventListener('click', () => this.switchTab(t.key));
      b.addEventListener('keydown', (event) => {
        const index = TABS.findIndex(tab => tab.key === t.key);
        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        this.switchTab(TABS[next].key);
        tabsBar.querySelector<HTMLElement>(`[data-tab="${TABS[next].key}"]`)?.focus();
      });
    }
    const right = tabsBar.createDiv({ cls: 'cc-tabs-right' });
    right.createDiv({ cls: 'cc-proto-badge', text: '非凡人生' });
    right.createDiv({ cls: 'cc-theme-hint', text: '跟随 DSH 主题', attr: { title: '在 DSH 设置 → 通用中调整皮肤与外观' } });

    const body = primary.createDiv({ cls: 'cc-body' });
    const main = body.createDiv({ cls: 'cc-main' });
    for (const t of TABS) {
      const sec = main.createDiv({ cls: 'cc-panel' + (t.key === this.activeTab ? '' : ' hidden'), attr: { 'data-panel': t.key } });
      this.panelEls.set(t.key, sec);
    }

    // 右栏：快速添加 / 习惯打卡 / 今日聚焦
    const rail = layout.createDiv({ cls: 'cc-right' });
    const railQuick = rail.createDiv({ cls: 'card cc-quick-card' });
    const qa = railQuick.createDiv({ cls: 'cc-quickadd' });
    const qinp = qa.createEl('input', { cls: 'cc-inp', attr: { placeholder: '输入一件事，回车添加' } });
    qinp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && qinp.value.trim()) {
        e.preventDefault();
        const name = qinp.value.trim();
        qinp.value = '';
        void this.plugin.stores.kanban.addTask({ projectId: null, name, priority: 'P3', dueDate: null });
      }
    });
    const railHabits = rail.createDiv({ cls: 'card' });
    const railSearch = rail.createDiv({ cls: 'card cc-search-card' });
    const railFocus = rail.createDiv({ cls: 'card' });
    this.railEls = { habits: railHabits, search: railSearch, focus: railFocus };
    this.refreshRail();

    // 订阅数据变化 → 刷新当前页
    this.unsubs.push(this.plugin.stores.kanban.subscribe(() => this.refreshSoft()));
    this.unsubs.push(this.plugin.stores.finance.subscribe(() => this.refreshSoft()));
    this.unsubs.push(this.plugin.stores.life.subscribe(() => this.refreshSoft()));
    this.unsubs.push(this.plugin.stores.root.subscribe(() => this.refreshSoft()));

    this.switchTab(this.activeTab);
    this.refreshTimer = window.setInterval(() => this.tickClock(), 1000);

  }

  private railEls: { habits?: HTMLElement; search?: HTMLElement; focus?: HTMLElement } = {};
  private searchQuery = '';
  private searchComposing = false;
  private refreshRail(): void {
    if (this.railEls.habits) this.renderRailHabits(this.railEls.habits);
    if (this.railEls.search) this.renderRailSearch(this.railEls.search);
    if (this.railEls.focus) this.renderRailFocus(this.railEls.focus);
  }

  private renderRailSearch(host: HTMLElement): void {
    host.empty();
    const bar = host.createDiv({ cls: 'cc-global-searchbar' });
    const input = bar.createEl('input', { cls: 'cc-inp cc-global-search__input', attr: { type: 'search', placeholder: '搜索任务、清单、灵感' } });
    const searchButton = bar.createEl('button', { cls: 'cc-iconbtn cc-global-searchbar__button', attr: { title: '搜索', 'aria-label': '搜索' } });
    setIcon(searchButton, 'search');
    searchButton.addEventListener('click', () => input.focus());
    input.value = this.searchQuery;
    const resultsHost = host.createDiv({ cls: 'cc-global-search__results-host' });
    input.addEventListener('compositionstart', () => { this.searchComposing = true; });
    input.addEventListener('compositionend', () => {
      this.searchComposing = false;
      this.searchQuery = input.value;
      this.renderRailSearchResults(resultsHost);
    });
    input.addEventListener('input', () => {
      this.searchQuery = input.value;
      if (!this.searchComposing) this.renderRailSearchResults(resultsHost);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        this.searchQuery = '';
        this.renderRailSearchResults(resultsHost);
      }
    });
    this.renderRailSearchResults(resultsHost);
  }

  private renderRailSearchResults(host: HTMLElement): void {
    host.empty();
    const results = this.searchResults(this.searchQuery);
    if (!this.searchQuery.trim()) {
      return;
    }
    if (!results.length) {
      host.createDiv({ cls: 'empty cc-global-search__empty', text: '没有找到匹配内容' });
      return;
    }
    const grouped = new Map<string, SearchResult[]>();
    for (const result of results) {
      const list = grouped.get(result.group) ?? [];
      list.push(result);
      grouped.set(result.group, list);
    }
    const groupedResults = Array.from(grouped.entries()).sort(([groupA], [groupB]) =>
      searchGroupRank(groupA) - searchGroupRank(groupB),
    );
    for (const [group, items] of groupedResults) {
      if (searchGroupRank(group) > 0) {
        items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
      }
      host.createDiv({ cls: 'cc-global-search__group' + (searchGroupRank(group) > 0 ? ' is-history' : ''), text: group });
      const list = host.createDiv({ cls: 'cc-global-search__results' });
      items.forEach((result, index) => {
        const statusClass = result.status ? ` is-${result.status}` : '';
        const button = list.createEl('button', { cls: 'cc-global-search__result' + statusClass });
        if (index >= 8) button.addClass('is-search-hidden');
        const heading = button.createSpan({ cls: 'cc-global-search__result-heading' });
        heading.createSpan({ cls: 'cc-global-search__result-title', text: result.title });
        if (result.status) {
          const state = heading.createSpan({ cls: 'cc-global-search__result-state' });
          setIcon(state, result.status === 'archived' ? 'archive' : 'circle-check');
          state.createSpan({ text: result.status === 'archived' ? '已归档' : '已完成' });
        }
        const details = [result.detail];
        if (result.completedAt) details.push('完成于 ' + localDateKey(new Date(result.completedAt)));
        if (details.some(Boolean)) button.createSpan({ cls: 'cc-global-search__result-detail', text: details.filter(Boolean).join(' · ') });
        button.addEventListener('click', () => {
          this.searchQuery = '';
          if (result.planningView) selectPlanningView(result.planningView, result.planningYear);
          this.switchTab(result.tab);
          if (result.taskId) this.kanbanPanel.revealTask(result.taskId, result.subtaskId);
          this.refreshRail();
        });
      });
      if (items.length > 8) {
        const more = host.createEl('button', { cls: 'cc-global-search__more', text: `显示其余 ${items.length - 8} 条` });
        more.addEventListener('click', () => {
          list.querySelectorAll('.is-search-hidden').forEach((item) => item.removeClass('is-search-hidden'));
          more.remove();
        });
      }
    }
  }

  private searchResults(query: string): SearchResult[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    const matches = (...values: unknown[]): boolean => values.join(' ').toLocaleLowerCase().includes(q);
    const kanban = this.plugin.stores.kanban;
    const projects = kanban.getProjects();
    const projectMap = new Map(projects.map((project) => [project.id, project.name]));
    for (const task of kanban.getTasks()) {
      const taskStatus = task.archived ? 'archived' : taskIsDone(task) ? 'completed' : undefined;
      if (matches(task.name, task.note, task.tags)) out.push({
        group: taskStatus === 'archived' ? '已归档任务' : taskStatus === 'completed' ? '已完成任务' : '任务',
        title: task.name,
        detail: projectMap.get(task.projectId ?? '') ?? '游离任务',
        status: taskStatus,
        completedAt: taskStatus ? task.completedAt : null,
        tab: 'tasks',
        taskId: task.id,
      });
      for (const sub of taskSubtasks(task)) {
        const subStatus = task.archived ? 'archived' : (taskIsDone(task) || subtaskComplete(sub)) ? 'completed' : undefined;
        if (matches(sub.name, sub.unit)) out.push({
          group: subStatus === 'archived' ? '已归档任务子项' : subStatus === 'completed' ? '已完成任务子项' : '任务子项',
          title: sub.name || '未命名子项',
          detail: '所属任务 · ' + task.name,
          status: subStatus,
          completedAt: taskIsDone(task) ? task.completedAt : null,
          tab: 'tasks',
          taskId: task.id,
          subtaskId: sub.id,
        });
      }
    }
    for (const project of projects) if (matches(project.name, project.description, project.tags)) out.push({ group: '项目', title: project.name, detail: project.category, tab: 'tasks' });
    const planning = this.plugin.stores.root.data.cmd.planning;
    for (const vision of planning?.visions ?? []) {
      if (matches(vision.name, vision.note)) out.push({ group: '规划', title: vision.name, detail: vision.kind === 'reward' ? '奖励' : '愿景', tab: 'planning', planningView: 'visions', planningYear: vision.year });
      for (const condition of vision.conditions) if (matches(condition.name, condition.unit, condition.source.label)) out.push({ group: '规划条件', title: condition.name, detail: '所属愿景 · ' + vision.name, tab: 'planning', planningView: 'visions', planningYear: vision.year });
    }
    for (const goal of planning?.goals ?? []) {
      if (matches(goal.name, goal.note)) out.push({ group: '规划', title: goal.name, detail: '年度目标 · ' + goal.year, tab: 'planning', planningView: 'goals', planningYear: goal.year });
      for (const metric of goal.metrics) if (matches(metric.name, metric.unit, metric.source.label)) out.push({ group: '规划指标', title: metric.name, detail: '所属目标 · ' + goal.name, tab: 'planning', planningView: 'goals', planningYear: goal.year });
      for (const evidence of goal.evidence) if (matches(evidence.name)) out.push({ group: '规划记录', title: evidence.name, detail: '所属目标 · ' + goal.name, tab: 'planning', planningView: 'goals', planningYear: goal.year });
    }
    const life = this.plugin.stores.root.data.life;
    for (const item of life?.inputs ?? []) if (matches(item.name, item.creator, item.category, item.description, item.keywords)) out.push({ group: '清单', title: item.name, detail: item.creator || item.category, tab: 'life' });
    for (const item of life?.inventory ?? []) if (matches(item.name, item.category, item.unit, item.note)) out.push({ group: '物资', title: item.name, detail: item.category, tab: 'life' });
    for (const habit of this.plugin.stores.root.data.cmd.habits ?? []) if (matches(habit.name, habit.unit, habit.sched?.t)) out.push({ group: '习惯', title: habit.name, detail: habit.sched?.t, tab: 'habits' });
    for (const inspiration of this.plugin.stores.root.data.cmd.inspirations ?? []) if (matches(inspiration.title, inspiration.content, inspiration.tags, inspiration.source, inspiration.relatedTo)) out.push({ group: '灵感', title: inspiration.title, detail: inspiration.type + ' · ' + inspiration.status, tab: 'inspiration' });
    for (const [ledgerId, ledger] of Object.entries(this.plugin.stores.root.data.finance?.ledgers ?? {})) {
      for (const transaction of (ledger as any).transactions ?? []) if (matches(transaction.note, transaction.cat1, transaction.cat2, transaction.cat3)) out.push({ group: '财务', title: transaction.note || transaction.cat2 || '财务记录', detail: `${ledgerId === 'business' ? '企业' : '个人'} · ${transaction.date}`, tab: 'finance' });
    }
    return out;
  }

  private renderRailHabits(host: HTMLElement): void {
    host.empty();
    const habits = this.plugin.stores.root.data.cmd.habits ?? [];
    const doneMap = this.plugin.stores.root.data.cmd.habitDaily?.[localDateKey()] ?? {};
    const done = habits.filter((h) => (doneMap[h.id] || 0) >= (h.times || 1)).length;
    host.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '习惯打卡' }); t.createSpan({ cls: 'side num', text: done + '/' + habits.length }); });
    const list = host.createDiv({ cls: 'cc-rail-habits' });
    for (const h of habits) {
      const c = doneMap[h.id] || 0; const ok = c >= (h.times || 1);
      const row = list.createDiv({ cls: 'cc-rail-habit' + (ok ? ' is-done' : '') });
      row.createSpan({ cls: 'cc-rail-habit__name', text: h.name });
      row.createSpan({ cls: 'cc-rail-habit__count num', text: c + '/' + (h.times || 1) });
      const complete = row.createEl('button', {
        cls: 'cc-rail-habit__complete',
        attr: { title: ok ? '今日已完成' : '完成一次', 'aria-label': ok ? '今日已完成' : '完成一次' },
      });
      setIcon(complete, ok ? 'check' : 'plus');
      complete.disabled = ok;
      complete.addEventListener('click', () => {
        void this.plugin.stores.root.mutate((d) => {
          const day = d.cmd.habitDaily[localDateKey()] ??= {};
          const cur = day[h.id] || 0;
          day[h.id] = Math.min(h.times || 1, cur + 1);
        });
        this.refreshRail();
      });
    }
    if (!habits.length) host.createDiv({ cls: 'empty', text: '去「习惯」页添加第一个习惯' });
  }

  private renderRailFocus(host: HTMLElement): void {
    host.empty();
    const date = localDateKey();
    const tasks = this.plugin.stores.kanban.getTasks() ?? [];
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const projectOrder = new Map(this.plugin.stores.kanban.getProjects().map((project, index) => [project.id, index]));
    const entries = (this.plugin.stores.root.data.cmd.focusPins ?? [])
      .filter((pin) => pin.date === date)
      .map((pin, index) => {
        const task = taskMap.get(pin.taskId);
        if (!task || task.archived) return null;
        const subtask = pin.subtaskId
          ? taskSubtasks(task).find((item) => item.id === pin.subtaskId)
          : undefined;
        if (pin.subtaskId && !subtask) return null;
        return { pin, task, subtask, index };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => {
        const doneA = a.subtask ? subtaskComplete(a.subtask) : taskIsDone(a.task);
        const doneB = b.subtask ? subtaskComplete(b.subtask) : taskIsDone(b.task);
        if (doneA !== doneB) return Number(doneA) - Number(doneB);
        const projectA = a.task.projectId ? (projectOrder.get(a.task.projectId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER;
        const projectB = b.task.projectId ? (projectOrder.get(b.task.projectId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER;
        if (projectA !== projectB) return projectA - projectB;
        const priority = PRIORITIES.indexOf(a.task.priority) - PRIORITIES.indexOf(b.task.priority);
        return priority || a.index - b.index;
      });
    const remaining = entries.filter(({ task, subtask }) => !(subtask ? subtaskComplete(subtask) : taskIsDone(task))).length;
    host.createDiv({ cls: 'card-title' }, (h) => {
      h.createSpan({ text: '今日聚焦' });
      h.createSpan({ cls: 'side num', text: remaining + '/' + entries.length });
    });
    if (!entries.length) host.createDiv({ cls: 'empty', text: '暂无' });
    for (const { pin, task, subtask } of entries) {
      const isDone = subtask ? subtaskComplete(subtask) : taskIsDone(task);
      const row = host.createDiv({ cls: 'rail-item cc-focus-item' + (isDone ? ' done' : '') });
      const copy = row.createDiv({ cls: 'cc-focus-copy' });
      copy.createDiv({ cls: 't', text: subtask?.name ?? task.name });
      if (subtask) copy.createDiv({ cls: 'cc-focus-parent', text: '所属任务 · ' + task.name });
      copy.addEventListener('click', () => this.revealFocusItem(task.id, pin.subtaskId));
      row.createSpan({ cls: 'cc-focus-priority ' + task.priority.toLowerCase(), text: task.priority });
      const remove = row.createEl('button', {
        cls: 'cc-focus-remove',
        attr: { 'aria-label': '移出今日聚焦', title: '移出今日聚焦' },
      });
      setIcon(remove, 'target');
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleFocusPin(task.id, pin.subtaskId);
      });
    }
  }

  private isFocusPinned(taskId: string, subtaskId?: string): boolean {
    const date = localDateKey();
    return (this.plugin.stores.root.data.cmd.focusPins ?? []).some((pin) =>
      pin.date === date && pin.taskId === taskId && pin.subtaskId === subtaskId,
    );
  }

  private toggleFocusPin(taskId: string, subtaskId?: string): boolean {
    const date = localDateKey();
    let pinned = false;
    void this.plugin.stores.root.mutate((data) => {
      const pins = data.cmd.focusPins ??= [];
      const index = pins.findIndex((pin) =>
        pin.date === date && pin.taskId === taskId && pin.subtaskId === subtaskId,
      );
      if (index >= 0) pins.splice(index, 1);
      else {
        pins.push({ date, taskId, ...(subtaskId ? { subtaskId } : {}) });
        pinned = true;
      }
    });
    return pinned;
  }

  private revealFocusItem(taskId: string, subtaskId?: string): void {
    this.switchTab('tasks');
    this.kanbanPanel.revealTask(taskId, subtaskId);
  }

  private tickClock(): void {
    const now = new Date();
    const date = localDateKey(now);
    if (date !== this.renderedDate) {
      this.renderedDate = date;
      this.refreshSoft();
    }
    const el = this.containerEl.querySelector('.hero-clock');
    if (el) el.textContent = this.clockText();
    const lunar = this.containerEl.querySelector('.hero-lunar');
    if (lunar) {
      const suffix = (lunar.textContent ?? '').replace(/^\d{2} 秒 · /, '');
      lunar.textContent = String(now.getSeconds()).padStart(2, '0') + ' 秒 · ' + suffix;
    }
  }

  private clockText(): string {
    const n = new Date();
    return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }

  refreshSoft(): void {
    this.refreshRail();
    this.kanbanPanel.refreshFocusIndicators();
    if (this.activeTab === 'overview' || this.activeTab === 'planning' || this.activeTab === 'habits' || this.activeTab === 'inspiration' || this.activeTab === 'review') {
      this.switchTab(this.activeTab);
    }
  }

  setTab(tab: TabKey): void {
    this.switchTab(tab);
  }

  private switchTab(tab: TabKey): void {
    this.activeTab = tab;
    const bar = this.containerEl.querySelector('.cc-tabs');
    if (bar) bar.querySelectorAll<HTMLElement>('.cc-tab').forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    for (const [key, el] of this.panelEls) el.classList.toggle('hidden', key !== tab);

    const el = this.panelEls.get(tab);
    if (!el) return;
    if (tab === 'overview') {
      el.empty();
      renderOverviewPanel(el, this.plugin);
      this.mounted.add('overview');
      return;
    }
    if (tab === 'habits') { el.empty(); renderHabitsPanel(el, this.plugin); return; }
    if (tab === 'inspiration') { el.empty(); renderInspirationPanel(el, this.plugin); return; }
    if (tab === 'review') { el.empty(); renderReviewPanel(el, this.plugin); return; }
    if (tab === 'planning') { el.empty(); renderPlanningPanel(el, this.plugin); return; }

    if (!this.mounted.has(tab)) {
      el.empty();
      const host = el.createDiv();
      if (tab === 'finance') this.finPanel.mount(host);
      if (tab === 'tasks') this.kanbanPanel.mount(host);
      if (tab === 'life') this.lifePanel.mount(host);
      this.mounted.add(tab);
    }
  }

  async onClose(): Promise<void> {
    this.detachTheme?.();
    this.detachTheme = null;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.unsubs.forEach((u) => u());
    this.finPanel.unmount();
    this.kanbanPanel.unmount();
    this.lifePanel.unmount();
    if (this.plugin.activeView === this) this.plugin.activeView = null;
  }
}

function localDateKey(d = new Date()): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function searchGroupRank(group: string): number {
  if (group.startsWith('已归档')) return 2;
  if (group.startsWith('已完成')) return 1;
  return 0;
}
