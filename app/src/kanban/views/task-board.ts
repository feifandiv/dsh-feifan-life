// 任务看板（迭代 008 / 优化-003 / 优化-004：树形表格；整行点击展开子项；
// 任务无显式状态，完成度由 done + 子项量化目标推导，0%=未开始 / 100%=完成；
// 优化-004：排序=优先级→完成度→建立序；展开/折叠局部化消除频闪；子项内联「当前」输入；
// 子项组带层级引导线；量化指标右对齐
// 优化-009：已完成任务置灰沉底 + 折叠成条；今日完成汇总条；30 天自动归档 + 查看归档开关）
import { setIcon } from "obsidian";
import { FfModal as Modal } from "../../design-system/modal";
import type { KanbanCtx as ProjectKanbanPlugin } from '../models';
import {
  PRIORITIES,
  Project,
  Task,
  Priority,
  Subtask,
  taskSort,
  isOverdue,
  taskSubtasks,
  taskIsDone,
  taskProgress,
  subtaskSort,
  isCompletedToday,
  parseTags,
} from '../models';
import {
  FormModal,
  ConfirmModal,
  priorityPill,
  progressBar,
  renderField,
  renderSelect,
  renderEmptyState,
  mountSubtaskEditor,
  SubtaskEditorHandle,
  FieldControl,
} from '../components';

// 筛选状态在视图生命周期内保持（模块级单例即可）
let taskFilter = { projectId: 'all', priority: 'all' };
// 子项展开状态（按任务 id），跨重渲染保持
const expanded = new Set<string>();
// 优化-009：折叠条展开状态（跨重渲染保持）
let doneExpanded = false; // 「已完成 N 项」折叠条
let archivedExpanded = false; // 「已归档 N 项」折叠条
let revealedArchivedTaskId: string | null = null; // 搜索定位时临时显示，不改动归档设置
let todayExpanded = false; // 「今日完成 N 项」汇总条
// 当前宿主元素（供展开/折叠后局部重渲染）
let taskHost: HTMLElement | null = null;

// 行引用：用于局部刷新父任务进度条（避免整板重渲染丢焦点/频闪）
interface RowRef {
  row: HTMLElement;
  progFill: HTMLElement;
  pctEl: HTMLElement;
}
const rowRefs = new Map<string, RowRef>();

/** 构建「归属项目」下拉的 options(显示名) 与 values(存 id，平行数组)。首项为游离任务。 */
function buildProjectOptions(projects: Project[]): { options: string[]; values: string[] } {
  return {
    options: ['__none__（游离任务）', ...projects.map((p) => p.name)],
    values: ['__none__', ...projects.map((p) => p.id)],
  };
}

/** 局部刷新父任务行的聚合进度条 + 百分比（子项变更时即时反馈，不触发整板重渲染）。 */
function updateParentProgress(t: Task): void {
  const ref = rowRefs.get(t.id);
  if (!ref) return;
  const prog = taskProgress(t);
  ref.progFill.style.width = `${prog.pct}%`;
  ref.pctEl.textContent =
    `${prog.pct}%` + (taskSubtasks(t).length ? ` · ${prog.done}/${prog.total}` : '');
}

/** 展开/折叠：仅切换包裹层 class，子项组始终在 DOM 中，靠 CSS 显隐。
 *  不做任何 DOM 增删（避免 Obsidian ItemView 下 after()/remove() 不生效导致“点不开”）。 */
function toggleExpand(t: Task, wrap: HTMLElement): void {
  if (expanded.has(t.id)) {
    expanded.delete(t.id);
    wrap.classList.remove('is-expanded');
  } else {
    expanded.add(t.id);
    wrap.classList.add('is-expanded');
  }
  const caret = wrap.querySelector('.pk-row__caret');
  if (caret) caret.textContent = expanded.has(t.id) ? '▾' : '▸';
}

function appendFocusButton(
  parent: HTMLElement,
  plugin: ProjectKanbanPlugin,
  taskId: string,
  subtaskId?: string,
): void {
  if (!plugin.focus) return;
  const button = parent.createEl('button', { cls: 'pk-focus-btn' });
  const refresh = (pinned: boolean): void => {
    button.classList.toggle('is-pinned', pinned);
    button.setAttribute('aria-pressed', String(pinned));
    button.setAttribute('aria-label', pinned ? '移出今日聚焦' : '加入今日聚焦');
    button.setAttribute('title', pinned ? '移出今日聚焦' : '加入今日聚焦');
    button.empty();
    setIcon(button, 'target');
  };
  button.dataset.taskId = taskId;
  if (subtaskId) button.dataset.subtaskId = subtaskId;
  refresh(plugin.focus.isPinned(taskId, subtaskId));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    refresh(plugin.focus!.toggle(taskId, subtaskId));
  });
}

export function renderTaskBoard(host: HTMLElement, plugin: ProjectKanbanPlugin): void {
  taskHost = host;
  rowRefs.clear();
  host.empty();
  const store = plugin.store;
  const board = host.createDiv({ cls: 'pk-board pk-task-board' });

  // 进入看板即触发自动归档（优化-009 的每日笔记同步已移除：复盘统一在「今日完成」记录，不再由插件另建「看板已完成」块）
  void store.archiveDueTasks();

  // 整盘为空：引导式空状态
  if (store.getTasks().length === 0) {
    const body = board.createDiv({ cls: 'pk-board__empty-host' });
    renderEmptyState(body, {
      icon: '✅',
      title: '还没有任务',
      desc: '新建一个任务，或先去项目看板创建项目并挂上任务。任务可拆成带量化目标的子项。',
      ctaText: '＋ 新建任务',
      onCta: () => openTaskForm(plugin),
    });
    return;
  }

  // 筛选行（自定义下拉，避免原生 select 被主题裁剪半行）
  const filters = board.createDiv({ cls: 'pk-filters' });
  const projOpts = buildProjectOptions(store.getProjects());
  // 兜底：若筛选的项目已被删除，回退到「全部」
  if (taskFilter.projectId !== 'all' && taskFilter.projectId !== '__none__') {
    if (!store.getProject(taskFilter.projectId)) taskFilter.projectId = 'all';
  }
  const projSel = renderSelect(filters, {
    options: ['全部项目', '游离任务', ...projOpts.options.slice(1)],
    values: ['all', '__none__', ...projOpts.values.slice(1)],
    value: taskFilter.projectId,
  });
  projSel.addClass('pk-input--sm');
  projSel.addEventListener('change', () => {
    taskFilter.projectId = projSel.value;
    renderTaskBoard(host, plugin);
  });

  const prioSel = renderSelect(filters, {
    options: ['全部优先级', ...PRIORITIES],
    values: ['all', ...PRIORITIES],
    value: taskFilter.priority,
  });
  prioSel.addClass('pk-input--sm');
  prioSel.addEventListener('change', () => {
    taskFilter.priority = prioSel.value;
    renderTaskBoard(host, plugin);
  });

  // 查看归档开关（优化-009）：开启后在表格底部显示「已归档」折叠区
  const archToggle = filters.createEl('button', {
    cls: 'pk-btn pk-btn--ghost pk-btn--sm pk-filters__arch',
    text: store.getSettings().showArchived ? '隐藏归档' : '查看归档',
  });
  archToggle.addEventListener('click', () => {
    const nextShowArchived = !store.getSettings().showArchived;
    if (!nextShowArchived) revealedArchivedTaskId = null;
    void store.setSettings({ showArchived: nextShowArchived });
    renderTaskBoard(host, plugin);
  });

  // 树形表格
  const table = board.createDiv({ cls: 'pk-table' });
  const head = table.createDiv({ cls: 'pk-table__head' });
  ['', '', '任务', '优先级', '进度', '编辑'].forEach((h) =>
    head.createEl('div', { cls: 'pk-table__h', text: h }),
  );

  let tasks = store.getTasks();
  if (taskFilter.projectId === '__none__') tasks = tasks.filter((t) => !t.projectId);
  else if (taskFilter.projectId !== 'all') tasks = tasks.filter((t) => t.projectId === taskFilter.projectId);
  if (taskFilter.priority !== 'all') tasks = tasks.filter((t) => t.priority === taskFilter.priority);
  tasks = tasks.slice().sort(taskSort);

  // 优化-009：按 活跃 / 已完成 / 已归档 分桶（排序已让 done/archive 沉底）
  const showArchived = store.getSettings().showArchived;
  const activeTasks = tasks.filter((t) => !taskIsDone(t) && !t.archived);
  const doneTasks = tasks.filter((t) => taskIsDone(t) && !t.archived);
  const archivedTasks = tasks.filter((t) =>
    t.archived && (showArchived || t.id === revealedArchivedTaskId),
  );
  // 今日完成（按当前筛选），用于顶部汇总条
  const todayTasks = tasks.filter((t) => isCompletedToday(t));

  // 顶部「今日完成 N 项」汇总（优化-009）：直接回答“我今天完成了哪些”
  if (todayTasks.length > 0) {
    const todaySec = board.createDiv({ cls: 'pk-today' });
    const todayBar = todaySec.createDiv({ cls: 'pk-today__bar' });
    todayBar.createSpan({ cls: 'pk-today__icon', text: '✅' });
    todayBar.createSpan({ cls: 'pk-today__label', text: `今日完成 ${todayTasks.length} 项` });
    todayBar.createSpan({ cls: 'pk-today__caret', text: todayExpanded ? '▾' : '▸' });
    todayBar.addEventListener('click', () => {
      todayExpanded = !todayExpanded;
      renderTaskBoard(host, plugin);
    });
    if (todayExpanded) {
      const list = todaySec.createDiv({ cls: 'pk-today__list' });
      todayTasks
        .slice()
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
        .forEach((t) => {
          const item = list.createDiv({ cls: 'pk-today__item' });
          item.createEl('span', { cls: 'pk-today__time', text: t.completedAt ? timeOf(t.completedAt) : '' });
          item.createEl('span', { cls: 'pk-today__name', text: t.name });
          const p = t.projectId ? store.getProject(t.projectId) : undefined;
          if (p) item.createEl('span', { cls: 'pk-today__proj', text: p.name });
          item.addEventListener('click', () => new TaskDetailModal(plugin.app, plugin, t).open());
        });
    }
  }

  // 活跃任务行
  activeTasks.forEach((t) => table.appendChild(renderTaskRow(t, plugin)));

  // 已完成折叠条（优化-009）：默认收起，避免成千上万灰色任务刷屏
  if (doneTasks.length > 0) {
    const bar = table.createDiv({ cls: 'pk-donebar' });
    bar.createSpan({ cls: 'pk-donebar__label', text: `已完成 ${doneTasks.length} 项` });
    bar.createSpan({ cls: 'pk-donebar__caret', text: doneExpanded ? '▾' : '▸' });
    bar.addEventListener('click', () => {
      doneExpanded = !doneExpanded;
      renderTaskBoard(host, plugin);
    });
    if (doneExpanded) {
      const grp = table.createDiv({ cls: 'pk-donegroup' });
      doneTasks.forEach((t) => grp.appendChild(renderTaskRow(t, plugin)));
    }
  }

  // 已归档折叠条（优化-009：仅开启查看归档时显示）
  if (archivedTasks.length > 0) {
    const bar = table.createDiv({ cls: 'pk-donebar pk-donebar--archived' });
    bar.createSpan({ cls: 'pk-donebar__label', text: `已归档 ${archivedTasks.length} 项` });
    bar.createSpan({ cls: 'pk-donebar__caret', text: archivedExpanded ? '▾' : '▸' });
    bar.addEventListener('click', () => {
      archivedExpanded = !archivedExpanded;
      renderTaskBoard(host, plugin);
    });
    if (archivedExpanded) {
      const grp = table.createDiv({ cls: 'pk-donegroup' });
      archivedTasks.forEach((t) => grp.appendChild(renderTaskRow(t, plugin)));
    }
  }
}

function renderTaskRow(t: Task, plugin: ProjectKanbanPlugin): HTMLElement {
  const store = plugin.store;
  const subs = taskSubtasks(t);
  const isOpen = expanded.has(t.id);

  // 包裹层：行 + 子项组（子项组始终存在于 DOM，折叠靠 CSS 显隐）
  const isDone = taskIsDone(t);
  const wrap = document.createElement('div');
  wrap.dataset.taskId = t.id;
  wrap.className =
    'pk-task' +
    (isOpen ? ' is-expanded' : '') +
    (isDone ? ' is-done' : '') +
    (t.archived ? ' is-archived' : '');

  const row = document.createElement('div');
  row.className = 'pk-row';

  // 展开/折叠（点击 caret 或整行均可）
  const caret = row.createEl('span', { cls: 'pk-row__caret' });
  caret.textContent = isOpen ? '▾' : '▸';
  caret.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand(t, wrap);
  });

  // 完成勾选（有子项时联动置全部子项 done；否则置 done）
  const cb = row.createEl('input', { cls: 'pk-row__check' });
  cb.type = 'checkbox';
  cb.checked = taskIsDone(t);
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => void store.setTaskDone(t.id, cb.checked));

  // 名称（已归档标记置于单元格内，避免破坏网格列；优化-009）
  const nameCell = row.createEl('div', { cls: 'pk-row__name' });
  const nameMain = nameCell.createEl('div', { cls: 'pk-row__name-main' });
  nameMain.createEl('span', { cls: 'pk-row__name-text', text: t.name });
  if (!t.archived) appendFocusButton(nameMain, plugin, t.id);
  if (t.archived) {
    nameMain.createEl('span', { cls: 'pk-row__arch', text: '已归档' });
  }
  const meta = nameCell.createEl('div', { cls: 'pk-row__meta' });
  const projectName = t.projectId ? (store.getProject(t.projectId)?.name ?? '项目已删除') : '游离任务';
  meta.createEl('span', { cls: 'pk-row__meta-item pk-row__meta-project', text: '归属 ' + projectName });
  meta.createEl('span', {
    cls: 'pk-row__meta-item pk-row__meta-due' + (isOverdue(t.dueDate) && !taskIsDone(t) ? ' is-overdue' : ''),
    text: '截止 ' + (t.dueDate ?? '未设置'),
  });

  // 优先级彩色标签（清晰可读，替代仅小圆点）
  const prio = row.createEl('div', { cls: 'pk-row__prio' });
  prio.appendChild(priorityPill(t.priority));

  // 进度（替代状态：0%=未开始，100%=完成）
  const prog = taskProgress(t);
  const progCell = row.createEl('div', { cls: 'pk-row__prog' });
  const progWrap = progressBar(prog.pct, 'var(--pk-accent)');
  progCell.appendChild(progWrap);
  const progFill = progWrap.querySelector('.pk-progress__fill') as HTMLElement;
  const pctEl = progCell.createEl('span', {
    cls: 'pk-row__pct',
    text: `${prog.pct}%` + (subs.length ? ` · ${prog.done}/${prog.total}` : ''),
  });
  rowRefs.set(t.id, { row, progFill, pctEl });

  // 编辑按钮（避免与整行展开冲突）
  const edit = row.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '编辑' });
  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    new TaskDetailModal(plugin.app, plugin, t).open();
  });

  // 点行展开子项（避开 caret / checkbox / 编辑按钮）
  row.addEventListener('click', () => toggleExpand(t, wrap));

  wrap.appendChild(row);
  wrap.appendChild(buildSubgroup(t, plugin));
  return wrap;
}

/** 子项组容器：缩进 + 引导线，内部放置子项行或空占位。 */
function buildSubgroup(t: Task, plugin: ProjectKanbanPlugin): HTMLElement {
  const subs = taskSubtasks(t);
  const group = document.createElement('div');
  group.className = 'pk-subgroup';
  if (subs.length === 0) {
    group.createDiv({
      cls: 'pk-subgroup__placeholder',
      text: '暂无子项，点「编辑」可添加带量化目标的子项',
    });
  } else {
    subs
      .map((subtask, index) => ({ subtask, index }))
      .sort((a, b) => subtaskSort(a.subtask, b.subtask) || a.index - b.index)
      .forEach(({ subtask }) => group.appendChild(renderSubtaskRow(t, subtask, plugin)));
  }
  return group;
}

function renderSubtaskRow(t: Task, s: Subtask, plugin: ProjectKanbanPlugin): HTMLElement {
  const store = plugin.store;
  const row = document.createElement('div');
  row.className = 'pk-row pk-row--sub';
  row.dataset.taskId = t.id;
  row.dataset.subtaskId = s.id;

  // 完成勾选（静默持久化 + 局部刷新父进度，不触发整板重渲染）
  const cb = row.createEl('input', { cls: 'pk-row__check' });
  cb.type = 'checkbox';
  cb.checked = s.done;
  cb.addEventListener('change', () => {
    void store.updateSubtask(t.id, s.id, { done: cb.checked });
    updateParentProgress(t);
  });

  const name = row.createEl('div', { cls: 'pk-row__name pk-row__sub-name' });
  name.createEl('span', { cls: 'pk-row__name-text', text: s.name });
  if (!t.archived) appendFocusButton(name, plugin, t.id, s.id);

  // 量化目标：内联「当前」输入框 + /目标 + 进度条（优化-004 请求 5）
  if (s.target > 0) {
    const pct = Math.min(100, Math.round(((s.current || 0) / s.target) * 100));
    const curWrap = row.createEl('div', { cls: 'pk-row__cur' });
    const curI = curWrap.createEl('input', { cls: 'pk-input pk-input--cur' });
    curI.type = 'number';
    curI.value = String(s.current || 0);
    curI.placeholder = '当前';
    curWrap.createEl('span', { cls: 'pk-row__slash', text: '/' });
    curWrap.createEl('span', {
      cls: 'pk-row__tgt',
      text: String(s.target) + (s.unit ? ' ' + s.unit : ''),
    });

    const progCell = row.createEl('div', { cls: 'pk-row__prog' });
    const progWrap = progressBar(pct, 'var(--pk-accent)');
    progCell.appendChild(progWrap);
    const fill = progWrap.querySelector('.pk-progress__fill') as HTMLElement;
    const pctEl = progCell.createEl('span', { cls: 'pk-row__pct', text: `${pct}%` });

    // 输入即更新：局部刷新本行进度 + 父任务聚合进度 + 静默落库（不丢焦点、不频闪）
    curI.addEventListener('input', () => {
      const current = Number(curI.value) || 0;
      const npct = Math.min(100, Math.round((current / s.target) * 100));
      fill.style.width = `${npct}%`;
      pctEl.textContent = `${npct}%`;
      void store.updateSubtask(t.id, s.id, { current }, true);
      updateParentProgress(t);
    });
    curI.addEventListener('change', () => {
      void store.updateSubtask(t.id, s.id, { current: Number(curI.value) || 0 });
    });
  }

  return row;
}

export function openTaskForm(plugin: ProjectKanbanPlugin): void {
  new TaskFormModal(plugin.app, plugin).open();
}

export function revealTaskInBoard(
  host: HTMLElement,
  plugin: ProjectKanbanPlugin,
  taskId: string,
  subtaskId?: string,
): void {
  taskFilter = { projectId: 'all', priority: 'all' };
  expanded.add(taskId);
  const task = plugin.store.getTasks().find((item: Task) => item.id === taskId) as Task | undefined;
  if (task?.archived) {
    revealedArchivedTaskId = task.id;
    archivedExpanded = true;
  } else {
    revealedArchivedTaskId = null;
    if (task && taskIsDone(task)) doneExpanded = true;
  }
  renderTaskBoard(host, plugin);
  window.requestAnimationFrame(() => {
    const candidates = Array.from(host.querySelectorAll<HTMLElement>('[data-task-id]'));
    const target = subtaskId
      ? candidates.find((element) => element.dataset.taskId === taskId && element.dataset.subtaskId === subtaskId)
      : candidates.find((element) => element.dataset.taskId === taskId && !element.dataset.subtaskId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('is-focus-target');
    window.setTimeout(() => target.classList.remove('is-focus-target'), 1500);
  });
}

/** 新建任务弹窗（优化 005-2）：横版两列 + 子项结构化三字段录入（子项/目标值/单位）。 */
class TaskFormModal extends Modal {
  private plugin: ProjectKanbanPlugin;
  private inputs: Record<string, FieldControl> = {};
  private editor!: SubtaskEditorHandle;

  constructor(app: import('obsidian').App, plugin: ProjectKanbanPlugin) {
    super(app);
    this.plugin = plugin;
    this.modalEl.addClass('pk-modal-el', 'pk-task-form-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');
    contentEl.createEl('div', { cls: 'pk-modal__title', text: '新建任务' });

    const layout = contentEl.createDiv({ cls: 'pk-task-form-layout' });
    const main = layout.createDiv({ cls: 'pk-task-form-main' });
    const form = main.createDiv({ cls: 'pk-modal__grid' });
    this.inputs['name'] = renderField(form, {
      key: 'name',
      label: '任务名称',
      type: 'text',
      placeholder: '例如：完成首页设计稿',
      span: 'full',
    });
    this.inputs['priority'] = renderField(form, {
      key: 'priority',
      label: '优先级',
      type: 'select',
      options: PRIORITIES,
      value: 'P2',
      span: 'half',
    });
    const { options, values } = buildProjectOptions(this.plugin.store.getProjects());
    this.inputs['projectId'] = renderField(form, {
      key: 'projectId',
      label: '归属项目',
      type: 'select',
      options,
      values,
      value: '__none__',
      span: 'half',
    });
    this.inputs['dueDate'] = renderField(form, {
      key: 'dueDate',
      label: '截止日期',
      type: 'date',
      span: 'half',
    });
    // 子项编辑器：子项 / 目标值 / 单位 三字段（新建不显示「当前」，默认从 0 计）
    const subSec = main.createDiv({ cls: 'pk-detail__tasks' });
    const subContainer = subSec.createDiv({ cls: 'pk-sub-editor' });
    this.editor = mountSubtaskEditor(subContainer, [], { showCurrent: false, showDone: false });
    const addSub = subSec.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '＋ 添加子项' });
    addSub.addEventListener('click', () => this.editor.add());

    const actions = main.createDiv({ cls: 'pk-modal__actions is-split' });
    const cancel = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = actions.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '确定' });
    ok.addEventListener('click', () => {
      const projectId = this.inputs['projectId'].value === '__none__' ? null : this.inputs['projectId'].value;
      void this.plugin.store.addTask({
        name: this.inputs['name'].value.trim() || '未命名任务',
        priority: (this.inputs['priority'].value as Priority) ?? 'P2',
        projectId,
        dueDate: this.inputs['dueDate'].value.trim() || null,
        tags: [],
        subtasks: this.editor.getSubtasks(),
        note: this.inputs['note'].value,
        done: false,
      });
      this.close();
    });

    const notePanel = layout.createDiv({ cls: 'pk-task-form-note' });
    this.inputs['note'] = renderField(notePanel, {
      key: 'note',
      label: '备注 / 思考',
      type: 'textarea',
      placeholder: '记录背景、思路或需要注意的事项',
      span: 'full',
    });

    // 自动聚焦任务名称
    this.inputs['name'].focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 任务详情 / 编辑弹窗：全字段编辑 + 子项编辑器（增删改量化目标，含单位） + 删除 */
class TaskDetailModal extends Modal {
  private plugin: ProjectKanbanPlugin;
  private task: Task;
  private inputs: Record<string, FieldControl> = {};
  private doneFlag: boolean;

  constructor(app: import('obsidian').App, plugin: ProjectKanbanPlugin, task: Task) {
    super(app);
    this.plugin = plugin;
    this.task = task;
    this.doneFlag = task.done;
    this.modalEl.addClass('pk-modal-el');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');

    contentEl.createEl('div', { cls: 'pk-modal__title', text: '任务详情' });

    const { options, values } = buildProjectOptions(this.plugin.store.getProjects());
    const currentValue = this.task.projectId == null ? '__none__' : this.task.projectId;

    const form = contentEl.createDiv({ cls: 'pk-modal__grid' });
    this.inputs['name'] = renderField(form, {
      key: 'name',
      label: '任务名称',
      type: 'text',
      value: this.task.name,
      span: 'full',
    });
    this.inputs['priority'] = renderField(form, {
      key: 'priority',
      label: '优先级',
      type: 'select',
      options: PRIORITIES,
      value: this.task.priority,
      span: 'half',
    });
    this.inputs['projectId'] = renderField(form, {
      key: 'projectId',
      label: '归属项目',
      type: 'select',
      options,
      values,
      value: currentValue,
      span: 'half',
    });
    this.inputs['dueDate'] = renderField(form, {
      key: 'dueDate',
      label: '截止日期',
      type: 'date',
      value: this.task.dueDate ?? '',
      span: 'half',
    });
    this.inputs['tags'] = renderField(form, {
      key: 'tags',
      label: '标签（逗号分隔）',
      type: 'text',
      value: this.task.tags.join(', '),
      placeholder: '如：公众号, 内容',
      span: 'half',
    });
    this.inputs['note'] = renderField(form, {
      key: 'note',
      label: '备注 / 思考',
      type: 'textarea',
      value: this.task.note,
      span: 'full',
    });

    const hasSubs = taskSubtasks(this.task).length > 0;

    // 完成状态（无子项任务用开关；有子项任务完成度由子项决定）
    if (!hasSubs) {
      const doneWrap = contentEl.createDiv({ cls: 'pk-done-toggle' });
      const cb = doneWrap.createEl('input');
      cb.type = 'checkbox';
      cb.checked = this.doneFlag;
      cb.addEventListener('change', () => {
        this.doneFlag = cb.checked;
      });
      doneWrap.createSpan({ text: this.doneFlag ? '已完成（进度 100%）' : '未开始（进度 0%）' });
    } else {
      const prog = taskProgress(this.task);
      contentEl.createDiv({
        cls: 'pk-detail__empty',
        text: `完成度由 ${taskSubtasks(this.task).length} 个子项决定，当前进度 ${prog.pct}%（勾选下方子项可推进）`,
      });
    }

    // 子项编辑器（优化 005-2：子项/目标值/单位 三字段 + 当前/完成，回车续行）
    const subSec = contentEl.createDiv({ cls: 'pk-detail__tasks' });
    const subContainer = subSec.createDiv({ cls: 'pk-sub-editor' });
    const editor = mountSubtaskEditor(subContainer, taskSubtasks(this.task), {
      showCurrent: true,
      showDone: true,
    });
    const addSub = subSec.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '＋ 添加子项' });
    addSub.addEventListener('click', () => editor.add());

    const actions = contentEl.createDiv({ cls: 'pk-modal__actions is-split' });
    const del = actions.createEl('button', { cls: 'pk-btn pk-btn--danger', text: '删除' });
    del.addEventListener('click', () => {
      new ConfirmModal(this.app, {
        title: '确认删除',
        message: `确定删除任务「${this.task.name}」吗？此操作不可撤销。`,
        confirmText: '确认删除',
        danger: true,
        onConfirm: () => {
          void this.plugin.store.deleteTask(this.task.id);
          this.close();
        },
      }).open();
    });
    const right = actions.createDiv({ cls: 'pk-modal__actions-right' });
    const cancel = right.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = right.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '保存' });
    save.addEventListener('click', () => {
      const projectId = this.inputs['projectId'].value === '__none__' ? null : this.inputs['projectId'].value;
      void this.plugin.store.updateTask(this.task.id, {
        name: this.inputs['name'].value.trim() || '未命名任务',
        priority: this.inputs['priority'].value as Priority,
        projectId,
        dueDate: this.inputs['dueDate'].value.trim() || null,
        tags: parseTags(this.inputs['tags'].value),
        subtasks: editor.getSubtasks(),
        note: this.inputs['note'].value,
        done: this.doneFlag,
      });
      this.close();
    });

    // 自动聚焦任务名称
    const nameInput = this.inputs['name'];
    if (nameInput) nameInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 时间戳格式化为本地 HH:MM（优化-009：今日完成条展示完成时刻）。 */
function timeOf(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// （优化-009 的每日笔记同步 syncTodayDone / ensureFolderPath 已移除：复盘统一在「今日完成」记录，不再由插件另建「看板已完成」块）
