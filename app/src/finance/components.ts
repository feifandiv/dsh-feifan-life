import { createSelect } from '../design-system/select';
// 财务记账插件 · 共用 UI 组件
// 注意：obsidian 模块并未导出可独立调用的 createDiv/createEl 函数，
// 这两个方法是挂在 HTMLElement 原型上的（element.createDiv()）。
// 因此独立调用 createDiv({...}) 会报 "is not a function"。
// 这里用 document.createElement 创建根元素，其余沿用元素上的方法即可。
import { Notice } from 'obsidian';
import { FfFormModal } from '../design-system/modal';
import { formField } from '../design-system/fields';

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

// ── 弹窗基类（不透明实底，变量提升，压掉主题玻璃层）──
// 关键：bodyEl/footerEl 必须在 onOpen() 里创建，且所有 UI 构建也必须延迟到
// onOpen() 之后（Obsidian 的 Modal.open() 在部分版本/平台是异步调度 onOpen 的，
// 若 new 之后立即访问 bodyEl 会拿到 undefined，导致弹窗空白）。
// 做法：把 UI 构建逻辑作为 build 回调传入，FlModal 在 onOpen() 创建容器后调用它，
// 调用方只需 new FlModal(app, title, (body, footer) => { ... }).open()。
export class FlModal extends FfFormModal {
  constructor(app: any, title: string, build?: (body: HTMLElement, footer: HTMLElement) => void) {
    super(app, title, 'fl', build);
  }
}

// ── 确认弹窗（禁止原生 confirm）──
export class ConfirmModal extends FlModal {
  constructor(
    app: any,
    msg: string,
    private onConfirm: () => void,
    confirmText = '确认',
    danger = true
  ) {
    super(app, '确认操作', (body, footer) => {
      body.createEl('p', { text: msg, cls: 'fl-confirm-msg' });
      const ok = footer.createEl('button', {
        text: confirmText,
        cls: 'fl-btn ' + (danger ? 'fl-btn-danger' : 'fl-btn-primary'),
      });
      ok.addEventListener('click', () => {
        this.onConfirm();
        this.close();
      });
      const cancel = footer.createEl('button', { text: '取消', cls: 'fl-btn' });
      cancel.addEventListener('click', () => this.close());
    });
  }
}

export function confirmDialog(
  app: any,
  msg: string,
  onConfirm: () => void,
  confirmText = '确认',
  danger = true
): void {
  new ConfirmModal(app, msg, onConfirm, confirmText, danger).open();
}

export function toast(msg: string): void {
  new Notice(msg);
}

// ── 字段行 ──
export function field(label: string): { row: HTMLElement; input: HTMLInputElement } {
  return formField(label, 'fl') as { row: HTMLElement; input: HTMLInputElement };
}

export function textareaField(label: string): { row: HTMLElement; input: HTMLTextAreaElement } {
  return formField(label, 'fl', true) as { row: HTMLElement; input: HTMLTextAreaElement };
}

// ── 轻量下拉（class 切换显隐，非 DOM 增删；可选搜索）──
export interface SelectOption {
  value: string;
  label: string;
}
export function renderSelect(opts: {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  onSelect: (value: string) => void;
  searchable?: boolean;
}): HTMLElement {
  return createSelect({ ...opts, prefix: 'fl' });
}

// ── 进度条 ──
export function progressBar(pct: number): HTMLElement {
  const wrap = el('div', 'fl-progress');
  const bar = wrap.createDiv({ cls: 'fl-progress-bar' });
  const p = Math.max(0, Math.min(100, pct));
  bar.style.width = p + '%';
  return wrap;
}

// ── 空状态 ──
export function emptyState(parent: HTMLElement, title: string, desc?: string): HTMLElement {
  const el = parent.createDiv('fl-empty');
  el.createDiv({ cls: 'fl-empty-icon', text: '◇' });
  el.createDiv({ cls: 'fl-empty-title', text: title });
  if (desc) el.createDiv({ cls: 'fl-empty-desc', text: desc });
  return el;
}
