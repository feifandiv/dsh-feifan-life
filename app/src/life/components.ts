import { createSelect } from '../design-system/select';
import { Notice, setIcon } from 'obsidian';
import { FfFormModal } from '../design-system/modal';
import { formField } from '../design-system/fields';

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

export class LlModal extends FfFormModal {
  constructor(app: any, title: string, build?: (body: HTMLElement, footer: HTMLElement) => void) {
    super(app, title, 'll', build);
  }
}

export function toast(msg: string): void {
  new Notice(msg);
}

export function confirmDialog(
  app: any,
  msg: string,
  onConfirm: () => void,
  confirmText = '确认',
  danger = true
): void {
  const modal = new LlModal(app, '确认操作', (body, footer) => {
    body.createEl('p', { text: msg, cls: 'll-confirm-msg' });
    const ok = footer.createEl('button', {
      text: confirmText,
      cls: 'll-btn ' + (danger ? 'll-btn-danger' : 'll-btn-primary'),
    });
    ok.addEventListener('click', () => {
      onConfirm();
      modal.close();
    });
    const cancel = footer.createEl('button', { text: '取消', cls: 'll-btn' });
    cancel.addEventListener('click', () => modal.close());
  });
  modal.open();
}

export function field(label: string): { row: HTMLElement; input: HTMLInputElement } {
  return formField(label, 'll') as { row: HTMLElement; input: HTMLInputElement };
}

export function textareaField(label: string): { row: HTMLElement; input: HTMLTextAreaElement } {
  return formField(label, 'll', true) as { row: HTMLElement; input: HTMLTextAreaElement };
}

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
  return createSelect({ ...opts, prefix: 'll' });
}

export function iconButton(icon: string, title: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'll-icon-btn';
  btn.setAttribute('title', title);
  setIcon(btn, icon);
  btn.addEventListener('click', onClick);
  return btn;
}

export function actionButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'll-op-btn';
  btn.setText(label);
  btn.addEventListener('click', onClick);
  return btn;
}

export function emptyState(parent: HTMLElement, title: string, desc?: string): void {
  const box = parent.createDiv('ll-empty');
  box.createDiv({ cls: 'll-empty-icon', text: '◇' });
  box.createDiv({ cls: 'll-empty-title', text: title });
  if (desc) box.createDiv({ cls: 'll-empty-desc', text: desc });
}

export function statCard(parent: HTMLElement, label: string, value: string, cls = ''): HTMLElement {
  const card = parent.createDiv('ll-stat' + (cls ? ` ${cls}` : ''));
  card.createDiv({ cls: 'll-stat-label', text: label });
  card.createDiv({ cls: 'll-stat-value', text: value });
  return card;
}
