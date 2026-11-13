import { setIcon } from 'obsidian';
import { INPUT_TYPES, InputType } from '../models';
import { ViewCtx } from './base';

type OptionView = InputType | '清单';
let activeType: OptionView = '读书';

export function renderOptionsView(host: HTMLElement, ctx: ViewCtx): void {
  const typeBar = host.createDiv('ll-option-types');
  const views: OptionView[] = [...INPUT_TYPES, '清单'];
  views.forEach((type) => {
    const button = typeBar.createEl('button', { cls: 'll-tab', text: type });
    button.classList.toggle('is-active', activeType === type);
    button.addEventListener('click', () => {
      activeType = type;
      ctx.rerender();
    });
  });

  const grid = host.createDiv('ll-option-grid' + (activeType === '清单' ? ' is-single' : ''));
  if (activeType === '清单') {
    renderOptionGroup(grid, ctx, '物资类别', ctx.store.settings().inventoryCategories, (next) => {
      ctx.store.settings().inventoryCategories = next;
    });
  } else {
    renderOptionGroup(grid, ctx, '输入类别', ctx.store.settings().inputCategories[activeType], (next) => {
      ctx.store.settings().inputCategories[activeType] = next;
    });
    renderOptionGroup(grid, ctx, '榜单', ctx.store.settings().inputLists[activeType], (next) => {
      ctx.store.settings().inputLists[activeType] = next;
    });
  }
}

function renderOptionGroup(
  parent: HTMLElement,
  ctx: ViewCtx,
  title: string,
  values: string[],
  update: (next: string[]) => void
): void {
  const section = parent.createDiv('ll-option-section');
  section.createDiv({ cls: 'll-option-title', text: title });
  const chips = section.createDiv('ll-option-chips');
  if (values.length === 0) chips.createSpan({ cls: 'll-option-empty', text: '暂无选项' });
  values.forEach((value) => {
    const chip = chips.createDiv('ll-option-chip');
    chip.createSpan({ text: value });
    const remove = chip.createEl('button', { cls: 'll-option-remove', attr: { title: `删除${value}` } });
    setIcon(remove, 'x');
    remove.addEventListener('click', () => {
      update(values.filter((x) => x !== value));
      void ctx.store.save().then(() => ctx.rerender());
    });
  });

  const addRow = section.createDiv('ll-option-add');
  const input = addRow.createEl('input', { cls: 'll-input', attr: { placeholder: `新增${title}` } });
  const add = addRow.createEl('button', { cls: 'll-btn ll-btn-primary', text: '添加' });
  const submit = () => {
    const value = input.value.trim();
    if (!value || values.includes(value)) return;
    update([...values, value]);
    void ctx.store.save().then(() => ctx.rerender());
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
}
