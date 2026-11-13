// 项目看板：分类泳道 个人/事业/工作 + 拖拽跨卡改分类。
import {  } from "obsidian";
import { FfModal as Modal } from "../../design-system/modal";
import type { KanbanCtx as ProjectKanbanPlugin } from '../models';
import {
  PROJECT_CATEGORIES,
  PRIORITIES,
  Project,
  ProjectCategory,
  Priority,
  projectProgress,
  projectSort,
  taskSort,
  taskStatusLabel,
  taskIsDone,
  isOverdue,
  parseTags,
} from '../models';
import { FormModal, ConfirmModal, priorityDot, progressBar, renderField, renderEmptyState, FieldControl } from '../components';

// 拖拽后极少数浏览器会冒泡一次 click，用该标志在 50ms 内吞掉误触
let justDragged = false;
function markDragged(): void {
  justDragged = true;
  setTimeout(() => {
    justDragged = false;
  }, 50);
}

export function renderProjectBoard(host: HTMLElement, plugin: ProjectKanbanPlugin): void {
  host.empty();
  const store = plugin.store;
  const board = host.createDiv({ cls: 'pk-board' });
  // 优化-009：进入看板即触发自动归档（异步、不阻塞渲染）
  void store.archiveDueTasks();

  // 头部
  const header = board.createDiv({ cls: 'pk-board__header' });
  header.createEl('div', { cls: 'pk-board__title', text: '项目看板' });
  const addBtn = header.createEl('button', {
    cls: 'pk-btn pk-btn--primary',
    text: '＋ 新建项目',
  });
  addBtn.addEventListener('click', () => openProjectForm(plugin));

  const all = store.getProjects();

  // 整盘为空：引导式空状态（替代 3 列灰字）
  if (all.length === 0) {
    const body = board.createDiv({ cls: 'pk-board__empty-host' });
    renderEmptyState(body, {
      icon: '📋',
      title: '还没有项目',
      desc: '新建项目会默认归入「个人」，之后拖拽卡片即可改到事业 / 工作。',
      ctaText: '＋ 新建项目',
      onCta: () => openProjectForm(plugin),
    });
    return;
  }

  // 列容器：三张固定分类卡（泳道），替代原状态 4 列
  const cols = board.createDiv({ cls: 'pk-columns' });
  for (const cat of PROJECT_CATEGORIES) {
    const list = all.filter((p) => p.category === cat);
    const col = cols.createDiv({ cls: 'pk-column' });
    const colHead = col.createDiv({ cls: 'pk-column__head' });
    colHead.createEl('span', { cls: 'pk-column__name', text: cat });
    colHead.createEl('span', { cls: 'pk-column__count', text: String(list.length) });

    const colBody = col.createDiv({ cls: 'pk-column__body' });
    // 拖放目标：拖卡片到此列即改为该分类（迭代 007）
    colBody.addEventListener('dragover', (e) => {
      e.preventDefault();
      colBody.addClass('pk-column__body--over');
    });
    colBody.addEventListener('dragleave', () => colBody.removeClass('pk-column__body--over'));
    colBody.addEventListener('drop', (e) => {
      e.preventDefault();
      colBody.removeClass('pk-column__body--over');
      const id = e.dataTransfer?.getData('text/plain');
      if (id) void store.updateProject(id, { category: cat });
    });

    if (list.length === 0) {
      colBody.createDiv({ cls: 'pk-column__empty', text: '拖拽项目到此' });
    } else {
      list
        .slice()
        .sort(projectSort)
        .forEach((p) => colBody.appendChild(renderProjectCard(p, plugin)));
    }
  }
}

function openProjectForm(plugin: ProjectKanbanPlugin): void {
  new FormModal(plugin.app, {
    title: '新建项目',
    modalClass: 'pk-project-form-modal',
    fields: [
      { key: 'name', label: '项目名称', type: 'text', placeholder: '例如：非凡人生管理系统', span: 'full' },
      { key: 'category', label: '分类', type: 'select', options: PROJECT_CATEGORIES, value: '个人', span: 'half' },
      { key: 'priority', label: '优先级', type: 'select', options: PRIORITIES, value: 'P2', span: 'half' },
      { key: 'dueDate', label: '截止日期', type: 'date', span: 'half' },
      { key: 'description', label: '描述', type: 'textarea', span: 'full' },
    ],
    onSubmit: (v) => {
      void plugin.store.addProject({
        name: v.name.trim() || '未命名项目',
        category: (v.category as ProjectCategory) ?? '个人',
        priority: (v.priority as Priority) ?? 'P2',
        dueDate: v.dueDate.trim(),
        tags: [],
        description: v.description,
      });
    },
  }).open();
}

function renderProjectCard(p: Project, plugin: ProjectKanbanPlugin): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pk-card';
  card.setAttribute('data-id', p.id);
  card.style.borderLeftColor = `var(--${p.priority.toLowerCase()})`;
  card.draggable = true;
  card.addEventListener('click', () => {
    if (justDragged) return; // 拖拽误触，吞掉
    new ProjectDetailModal(plugin.app, plugin, p).open();
  });
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', p.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    card.addClass('pk-card--dragging');
  });
  card.addEventListener('dragend', () => {
    card.removeClass('pk-card--dragging');
    markDragged();
  });

  const top = card.createDiv({ cls: 'pk-card__top' });
  top.appendChild(priorityDot(p.priority));
  top.createEl('div', { cls: 'pk-card__title', text: p.name });

  const prog = projectProgress(plugin.store.getTasks(), p.id);
  const meta = card.createDiv({ cls: 'pk-card__meta' });
  if (prog.total === 0) {
    meta.createEl('span', { cls: 'pk-card__sub', text: '无任务' });
  } else {
    meta.appendChild(progressBar(prog.pct, `var(--${p.priority.toLowerCase()})`));
    meta.createEl('span', { cls: 'pk-card__sub', text: `${prog.done}/${prog.total}` });
  }

  if (p.dueDate) {
    const due = card.createDiv({
      cls: 'pk-card__due' + (isOverdue(p.dueDate) && prog.pct < 100 ? ' is-overdue' : ''),
    });
    due.textContent = p.dueDate;
  }

  return card;
}

/** 项目详情 / 编辑弹窗（迭代 007）：全字段编辑（含分类/标签） + 任务清单 + 删除 */
class ProjectDetailModal extends Modal {
  private plugin: ProjectKanbanPlugin;
  private project: Project;
  private inputs: Record<string, FieldControl> = {};

  constructor(app: import('obsidian').App, plugin: ProjectKanbanPlugin, project: Project) {
    super(app);
    this.plugin = plugin;
    this.project = project;
    this.modalEl.addClass('pk-modal-el');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');

    contentEl.createEl('div', { cls: 'pk-modal__title', text: '项目详情' });

    const form = contentEl.createDiv({ cls: 'pk-modal__grid' });
    this.inputs['name'] = renderField(form, {
      key: 'name',
      label: '项目名称',
      type: 'text',
      value: this.project.name,
      span: 'full',
    });
    this.inputs['category'] = renderField(form, {
      key: 'category',
      label: '分类',
      type: 'select',
      options: PROJECT_CATEGORIES,
      value: this.project.category,
      span: 'half',
    });
    this.inputs['priority'] = renderField(form, {
      key: 'priority',
      label: '优先级',
      type: 'select',
      options: PRIORITIES,
      value: this.project.priority,
      span: 'half',
    });
    this.inputs['startDate'] = renderField(form, {
      key: 'startDate',
      label: '开始日期',
      type: 'date',
      value: this.project.startDate,
      span: 'half',
    });
    this.inputs['dueDate'] = renderField(form, {
      key: 'dueDate',
      label: '截止日期',
      type: 'date',
      value: this.project.dueDate,
      span: 'half',
    });
    this.inputs['tags'] = renderField(form, {
      key: 'tags',
      label: '标签（逗号分隔）',
      type: 'text',
      value: this.project.tags.join(', '),
      placeholder: '如：公众号, 内容',
      span: 'half',
    });
    this.inputs['description'] = renderField(form, {
      key: 'description',
      label: '描述',
      type: 'textarea',
      value: this.project.description,
      span: 'full',
    });
    // 任务清单（只读，完整编辑在任务看板）
    const tasks = this.plugin.store.getTasksOfProject(this.project.id);
    const sec = contentEl.createDiv({ cls: 'pk-detail__tasks' });
    sec.createEl('div', { cls: 'pk-detail__tasks-title', text: `任务清单（${tasks.length}）` });
    if (tasks.length === 0) {
      sec.createEl('div', { cls: 'pk-detail__empty', text: '暂无任务，去任务看板添加' });
    } else {
      tasks
        .slice()
        .sort(taskSort)
        .forEach((t) => {
          const item = sec.createDiv({ cls: 'pk-detail__task' + (taskIsDone(t) ? ' is-done' : '') });
          item.appendChild(priorityDot(t.priority));
          item.createEl('span', { cls: 'pk-detail__task-name', text: t.name });
          item.createEl('span', { cls: 'pk-detail__task-status', text: taskStatusLabel(t) });
          if (t.archived) item.createEl('span', { cls: 'pk-detail__task-arch', text: '已归档' });
        });
    }

    const actions = contentEl.createDiv({ cls: 'pk-modal__actions is-split' });
    const del = actions.createEl('button', { cls: 'pk-btn pk-btn--danger', text: '删除' });
    del.addEventListener('click', () => {
      new ConfirmModal(this.app, {
        title: '确认删除',
        message: `确定删除项目「${this.project.name}」吗？其下任务将变为游离任务，此操作不可撤销。`,
        confirmText: '确认删除',
        danger: true,
        onConfirm: () => {
          void this.plugin.store.deleteProject(this.project.id);
          this.close();
        },
      }).open();
    });
    const right = actions.createDiv({ cls: 'pk-modal__actions-right' });
    const cancel = right.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = right.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '保存' });
    save.addEventListener('click', () => {
      void this.plugin.store.updateProject(this.project.id, {
        name: this.inputs['name'].value.trim() || '未命名项目',
        category: this.inputs['category'].value as ProjectCategory,
        priority: this.inputs['priority'].value as Priority,
        startDate: this.inputs['startDate'].value.trim(),
        dueDate: this.inputs['dueDate'].value.trim(),
        tags: parseTags(this.inputs['tags'].value),
        description: this.inputs['description'].value,
      });
      this.close();
    });

    // 自动聚焦项目名称，便于快速改
    const nameInput = this.inputs['name'];
    if (nameInput) nameInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
