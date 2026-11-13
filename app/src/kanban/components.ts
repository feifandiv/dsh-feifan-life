import { createSelect } from '../design-system/select';
// 共享 UI 组件（迭代 002 起）
// 玻璃弹窗表单 + 玻璃确认弹窗 + 优先级圆点 + 进度条 + 字段渲染helper。

import { App } from "obsidian";
import { FfModal as Modal } from "../design-system/modal";
import { Priority, PRIORITY_LABEL, Subtask, uid } from './models';

/** 字段控件统一类型：所有控件都暴露 .value（字符串）。 */
export type FieldControl = HTMLElement & { value: string };

export function renderSelect(
  parent: HTMLElement,
  opts: { options: string[]; values?: string[]; value?: string },
): FieldControl {
  const control = createSelect({ prefix: 'pk', options: opts.options.map((label, index) => ({ label, value: (opts.values ?? opts.options)[index] })), value: opts.value ?? (opts.values ?? opts.options)[0] });
  parent.appendChild(control);
  return control as FieldControl;
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date';
  options?: string[];
  /** select 选项的「值」（与 options 平行）。不传则等于 options（显示即值）。
   *  用途：归属项目等需要显示名 ≠ 存储值（id）的下拉，避免同名反查错位。 */
  values?: string[];
  value?: string;
  placeholder?: string;
  /** 布局跨度（优化 005）：详情/表单横版两列网格用。
   *  'full' = 占满整行（默认）；'half' = 占半行，与相邻 half 并排。 */
  span?: 'full' | 'half';
}

/** 渲染单个字段（label + input），返回控件（统一暴露 .value）。 */
export function renderField(parent: HTMLElement, field: FieldDef): FieldControl {
  const row = parent.createDiv({
    cls: 'pk-field' + (field.span === 'half' ? ' pk-field--half' : ' pk-field--full'),
  });
  row.createEl('label', { cls: 'pk-field__label', text: field.label });
  let input: FieldControl;
  if (field.type === 'textarea') {
    const el = row.createEl('textarea', { cls: 'pk-input' });
    el.value = field.value ?? '';
    if (field.placeholder) el.placeholder = field.placeholder;
    input = el as FieldControl;
  } else if (field.type === 'select') {
    // 自定义下拉，避免原生 <select> 在主题下被裁剪/半行
    input = renderSelect(row, {
      options: field.options ?? [],
      values: field.values,
      value: field.value,
    });
  } else if (field.type === 'date') {
    // 日历选择器（迭代 008）：Electron 原生弹日历，杜绝日期瞎填。
    const el = row.createEl('input', { cls: 'pk-input' });
    el.type = 'date';
    el.value = field.value ?? '';
    input = el as FieldControl;
  } else {
    const el = row.createEl('input', { cls: 'pk-input' });
    el.type = 'text';
    el.value = field.value ?? '';
    if (field.placeholder) el.placeholder = field.placeholder;
    input = el as FieldControl;
  }
  return input;
}

/** 玻璃态表单弹窗（STYLE.md 玻璃拟态 + 10.8 禁止原生 confirm） */
export class FormModal extends Modal {
  private titleText: string;
  private fields: FieldDef[];
  private onSubmit: (values: Record<string, string>) => void;
  private inputs: Record<string, FieldControl> = {};

  constructor(
    app: App,
    opts: {
      title: string;
      fields: FieldDef[];
      onSubmit: (values: Record<string, string>) => void;
      modalClass?: string;
    },
  ) {
    super(app);
    this.titleText = opts.title;
    this.fields = opts.fields;
    this.onSubmit = opts.onSubmit;
    this.modalEl.addClass('pk-modal-el');
    if (opts.modalClass) this.modalEl.addClass(opts.modalClass);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');

    contentEl.createEl('div', { cls: 'pk-modal__title', text: this.titleText });

    const form = contentEl.createDiv({ cls: 'pk-modal__grid' });
    this.fields.forEach((f) => {
      this.inputs[f.key] = renderField(form, f);
    });
    // 自动聚焦首个输入框，减少一步点击
    const first = Object.values(this.inputs)[0];
    if (first) first.focus();

    const actions = contentEl.createDiv({ cls: 'pk-modal__actions' });
    const cancel = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = actions.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '确定' });
    ok.addEventListener('click', () => {
      const values: Record<string, string> = {};
      for (const f of this.fields) values[f.key] = this.inputs[f.key].value;
      this.onSubmit(values);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 子项录入编辑器（优化 005）：结构化为「子项 / 目标值 / 单位」三字段（详情模式额外含「当前/完成」），
 *  回车在「单位」框后自动新建下一行并把光标送到新行首，形成顺畅的连续录入节奏。
 *  - showCurrent：详情编辑时显示「当前」列（新建任务不显示，默认从 0 计）。
 *  - showDone：是否显示每行完成勾选（详情模式默认开）。
 *  返回 getSubtasks()（落库用，名称去空兜底）与 add()（外部「＋ 添加」按钮调用）。 */
export interface SubtaskEditorHandle {
  getSubtasks: () => Subtask[];
  add: () => void;
}

export function mountSubtaskEditor(
  container: HTMLElement,
  initial: Subtask[],
  opts: { showCurrent?: boolean; showDone?: boolean } = {},
): SubtaskEditorHandle {
  const showCurrent = opts.showCurrent ?? false;
  const showDone = opts.showDone ?? showCurrent;

  // 内部可变副本（落库时由 getSubtasks 导出）
  const subs: Subtask[] = initial.map((s) => ({ ...s }));
  // 渲染后需要把光标送到的目标（索引 + 字段角色）
  let pendingFocus: { index: number; field: 'name' | 'current' | 'target' | 'unit' } | null = null;
  interface RowRef {
    name: HTMLInputElement;
    current?: HTMLInputElement;
    target: HTMLInputElement;
    unit: HTMLInputElement;
  }
  let refs: RowRef[] = [];

  const focusField = (i: number, field: 'name' | 'current' | 'target' | 'unit'): void => {
    const r = refs[i];
    if (!r) return;
    const el =
      field === 'name' ? r.name : field === 'current' ? r.current : field === 'target' ? r.target : r.unit;
    el?.focus();
  };

  const addRow = (): void => {
    subs.push({ id: uid(), name: '', target: 0, current: 0, done: false, unit: '' });
    pendingFocus = { index: subs.length - 1, field: 'name' };
    render();
  };

  const render = (): void => {
    container.empty();
    refs = [];
    const title = container.createDiv({ cls: 'pk-detail__tasks-title' });
    title.textContent = `子项与量化目标（${subs.length}）`;
    if (subs.length === 0) {
      container.createDiv({ cls: 'pk-detail__empty', text: '暂无子项，在下方输入框录入，或点「＋ 添加子项」' });
    }
    subs.forEach((s, idx) => {
      const rowEl = container.createDiv({ cls: 'pk-sub' });

      if (showDone) {
        const cb = rowEl.createEl('input', { cls: 'pk-sub__check' });
        cb.type = 'checkbox';
        cb.checked = s.done;
        cb.addEventListener('change', () => {
          s.done = cb.checked;
        });
      }

      const del = rowEl.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '✕' });
      del.addEventListener('click', () => {
        subs.splice(idx, 1);
        pendingFocus = null;
        render();
      });

      // 子项名称
      const nameI = rowEl.createEl('input', { cls: 'pk-input pk-sub__name' });
      nameI.value = s.name;
      nameI.placeholder = '子项';
      nameI.addEventListener('input', () => {
        s.name = nameI.value;
      });
      nameI.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusField(idx, showCurrent ? 'current' : 'target');
        }
      });

      // 当前（仅详情模式）
      let curI: HTMLInputElement | undefined;
      if (showCurrent) {
        curI = rowEl.createEl('input', { cls: 'pk-input pk-input--num' });
        curI.type = 'number';
        curI.value = String(s.current || 0);
        curI.placeholder = '当前';
        curI.addEventListener('input', () => {
          s.current = Number(curI!.value) || 0;
        });
        curI.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            focusField(idx, 'target');
          }
        });
      }

      // 目标值
      const tgtI = rowEl.createEl('input', { cls: 'pk-input pk-input--num' });
      tgtI.type = 'number';
      tgtI.value = String(s.target || 0);
      tgtI.placeholder = '目标';
      tgtI.addEventListener('input', () => {
        s.target = Number(tgtI.value) || 0;
      });
      tgtI.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          focusField(idx, 'unit');
        }
      });

      // 单位
      const unitI = rowEl.createEl('input', { cls: 'pk-input pk-subedit__unit' });
      unitI.value = s.unit ?? '';
      unitI.placeholder = '单位';
      unitI.addEventListener('input', () => {
        s.unit = unitI.value;
      });
      unitI.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addRow(); // 回车在「单位」框 → 自动新建下一行，光标送新行首
        }
      });

      refs.push({ name: nameI, current: curI, target: tgtI, unit: unitI });
    });

    // 应用待定聚焦（新建行后把光标送到对应字段）
    if (pendingFocus) {
      const f = pendingFocus;
      pendingFocus = null;
      focusField(f.index, f.field);
    }
  };

  render();
  return {
    getSubtasks: () => subs.map((s) => ({ ...s, name: s.name.trim() || '未命名子项' })),
    add: addRow,
  };
}

/** 玻璃态确认弹窗（删除等危险操作，禁止原生 confirm） */
export class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmText: string;
  private danger: boolean;
  private onConfirm: () => void;

  constructor(
    app: App,
    opts: {
      title: string;
      message: string;
      confirmText?: string;
      danger?: boolean;
      onConfirm: () => void;
    },
  ) {
    super(app);
    this.titleText = opts.title;
    this.message = opts.message;
    this.confirmText = opts.confirmText ?? '确定';
    this.danger = opts.danger ?? false;
    this.onConfirm = opts.onConfirm;
    this.modalEl.addClass('pk-modal-el');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');

    contentEl.createEl('div', { cls: 'pk-modal__title', text: this.titleText });
    contentEl.createEl('div', { cls: 'pk-modal__msg', text: this.message });

    const actions = contentEl.createDiv({ cls: 'pk-modal__actions is-split' });
    const cancel = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = actions.createEl('button', {
      cls: this.danger ? 'pk-btn pk-btn--danger' : 'pk-btn pk-btn--primary',
      text: this.confirmText,
    });
    ok.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 优先级圆点（颜色由 CSS 变量 --p0..--p3 驱动） */
export function priorityDot(p: Priority): HTMLElement {
  const el = document.createElement('span');
  el.className = 'pk-dot';
  el.style.background = `var(--${p.toLowerCase()})`;
  el.title = p;
  el.setAttribute('aria-label', p);
  return el;
}

/** 优先级彩色标签（清晰可读，替代仅小圆点，优化） */
export function priorityPill(p: Priority): HTMLElement {
  const el = document.createElement('span');
  el.className = `pk-pill is-${p.toLowerCase()}`;
  el.style.color = `var(--${p.toLowerCase()})`;
  el.textContent = p;
  el.title = PRIORITY_LABEL[p] ?? p;
  el.setAttribute('aria-label', p);
  return el;
}

/** 进度条（3px 卡内） */
export function progressBar(pct: number, colorVar: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pk-progress';
  const fill = document.createElement('div');
  fill.className = 'pk-progress__fill';
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  fill.style.background = colorVar;
  wrap.appendChild(fill);
  return wrap;
}

/** 引导式空状态（STYLE.md 10.7：虚线圆 + 图标 + 标题 + 描述 + 可选 CTA）。
 *  用于整个看板无数据时的友好占位，替代「4 列灰字」。 */
export function renderEmptyState(
  parent: HTMLElement,
  opts: { icon?: string; title: string; desc: string; ctaText?: string; onCta?: () => void },
): void {
  const box = parent.createDiv({ cls: 'pk-empty' });
  const icon = box.createDiv({ cls: 'pk-empty__icon' });
  icon.textContent = opts.icon ?? '🗂';
  box.createEl('div', { cls: 'pk-empty__title', text: opts.title });
  box.createEl('div', { cls: 'pk-empty__desc', text: opts.desc });
  if (opts.ctaText && opts.onCta) {
    const btn = box.createEl('button', { cls: 'pk-btn pk-btn--primary', text: opts.ctaText });
    btn.addEventListener('click', opts.onCta);
  }
}
