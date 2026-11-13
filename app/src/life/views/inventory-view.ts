import {
  InventoryItem,
  LEVEL_OPTIONS,
  LEVEL_ORDER,
  STATUS_OPTIONS,
  isDiscardStatus,
  nowIso,
  todayMonth,
  uid,
} from '../models';
import { formatMoney } from '../calc';
import { actionButton, confirmDialog, emptyState, field, LlModal, renderSelect, textareaField } from '../components';
import { ViewCtx } from './base';

let invQuery = '';
let invFilterLevel = 'all';
let invFilterMonth = 'all';
let invFilterCat = 'all';
let invFilterStatus = 'all';
let invSort = 'createdDesc';

const ARCHIVE_VISIBLE_DAYS = 30;
const inventoryExpanded = new Set<string>();

const COLS: { key: keyof InventoryItem; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'price', label: '价格' },
  { key: 'quantity', label: '数量' },
  { key: 'unit', label: '单位' },
  { key: 'level', label: '等级' },
  { key: 'inDate', label: '入库时间' },
  { key: 'category', label: '类别' },
  { key: 'status', label: '状态' },
  { key: 'notes', label: '备注' },
];

const VISIBLE_COLS = COLS.filter((column) => !['inDate', 'status', 'notes'].includes(String(column.key)));

export function renderInventoryTopActions(parent: HTMLElement, ctx: ViewCtx): void {
  const search = parent.createEl('input', {
    cls: 'll-input ll-top-search',
    attr: { placeholder: '搜索物资清单' },
  });
  search.value = invQuery;
  search.addEventListener('input', () => {
    invQuery = search.value.trim();
    ctx.rerender();
  });
  const add = parent.createEl('button', { cls: 'll-btn ll-btn-primary', text: '+ 新增' });
  add.addEventListener('click', () => openInventoryModal(ctx));
}

export function renderInventoryView(host: HTMLElement, ctx: ViewCtx): void {
  const allItems = ctx.store.get().inventory;
  const toolbar = host.createDiv('ll-input-tools ll-inventory-tools');
  const filters = toolbar.createDiv('ll-filterbar ll-inventory-filters');
  appendSelect(filters, [{ value: 'all', label: '等级' }, ...distinct(allItems.map((x) => x.level)).map((level) => ({ value: level, label: `${level} 级` }))], invFilterLevel, (value) => {
    invFilterLevel = value;
    ctx.rerender();
  });
  appendSelect(filters, [{ value: 'all', label: '入库月' }, ...distinct(allItems.map((x) => x.inDate).filter(Boolean)).sort().reverse().map((month) => ({ value: month, label: month }))], invFilterMonth, (value) => {
    invFilterMonth = value;
    ctx.rerender();
  });
  appendSelect(filters, [{ value: 'all', label: '类别' }, ...distinct(allItems.map((x) => x.category).filter(Boolean)).sort().map((category) => ({ value: category, label: category }))], invFilterCat, (value) => {
    invFilterCat = value;
    ctx.rerender();
  });
  appendSelect(filters, [{ value: 'all', label: '状态' }, ...STATUS_OPTIONS.map((status) => ({ value: status, label: status }))], invFilterStatus, (value) => {
    invFilterStatus = value;
    ctx.rerender();
  });

  const sort = toolbar.createDiv('ll-sortbar');
  appendSelect(sort, sortOptions(), invSort, (value) => {
    invSort = value;
    ctx.rerender();
  });

  const visible = allItems.filter((item) => !isExpiredArchive(item));
  const filtered = applyInventoryView(visible, allItems);
  const active = filtered.filter((item) => !isDiscardStatus(item.status));
  const archived = filtered.filter((item) => isDiscardStatus(item.status));

  if (active.length > 0) renderInventoryTable(host, active, ctx, false);
  else if (archived.length === 0) {
    const empty = host.createDiv('ll-table-wrap ll-inventory-empty');
    emptyState(empty, allItems.length === 0 ? '暂无物资' : '无匹配结果', allItems.length === 0 ? '点击顶部「+ 新增」开始' : undefined);
  }

  if (archived.length > 0) {
    const group = host.createEl('details', { cls: 'll-archive-group' });
    group.open = invFilterStatus === '转卖' || invFilterStatus === '废弃' || invQuery.length > 0;
    group.createEl('summary', { text: `转卖与废弃 ${archived.length}` });
    renderInventoryTable(group, archived, ctx, true);
  }
}

function renderInventoryTable(parent: HTMLElement, items: InventoryItem[], ctx: ViewCtx, archived: boolean): void {
  const wrap = parent.createDiv('ll-table-wrap' + (archived ? ' ll-archive-table' : ''));
  const table = wrap.createEl('table', { cls: 'll-table ll-inventory-table' });
  const colgroup = table.createEl('colgroup');
  ['expand', ...VISIBLE_COLS.map((column) => String(column.key)), 'actions'].forEach((key) =>
    colgroup.createEl('col', { cls: `ll-inventory-col--${key}` })
  );
  const header = table.createEl('thead').createEl('tr');
  header.createEl('th');
  VISIBLE_COLS.forEach((column) => header.createEl('th', { text: column.label }));
  header.createEl('th', { text: '编辑' });
  const tbody = table.createEl('tbody');
  items.forEach((item) => renderInventoryRow(tbody, item, ctx, archived));
}

function renderInventoryRow(tbody: HTMLElement, item: InventoryItem, ctx: ViewCtx, archived: boolean): void {
  const row = tbody.createEl('tr');
  if (archived) row.addClass('ll-inv-row-discard');
  const isOpen = inventoryExpanded.has(item.id);
  const toggle = row.createEl('td', { cls: 'll-expand-hit', text: isOpen ? '▾' : '▸' });
  toggle.setAttribute('title', isOpen ? '收起详情' : '展开详情');
  toggle.setAttribute('aria-label', isOpen ? '收起详情' : '展开详情');
  toggle.addEventListener('click', () => {
    if (isOpen) inventoryExpanded.delete(item.id);
    else inventoryExpanded.add(item.id);
    ctx.rerender();
  });
  VISIBLE_COLS.forEach((column) => {
    const cell = row.createEl('td');
    const value = item[column.key];
    cell.setText(column.key === 'price' ? formatMoney(Number(value) || 0) : value == null || value === '' ? '-' : String(value));
  });
  const actions = row.createEl('td').createDiv('ll-row-actions');
  actions.appendChild(actionButton('编辑', () => openInventoryModal(ctx, item)));
  if (isOpen) {
    const detail = tbody.createEl('tr', { cls: 'll-expand-row' });
    if (archived) detail.addClass('ll-inv-row-discard');
    const cell = detail.createEl('td');
    cell.colSpan = 8;
    const box = cell.createDiv('ll-expand-box');
    const grid = box.createDiv({ cls: 'll-detail-grid' });
    const detailItem = (label: string, value: string, wide = false): void => {
      const detailCell = grid.createDiv({ cls: 'll-detail-item' + (wide ? ' is-wide' : '') });
      detailCell.createDiv({ cls: 'll-detail-label', text: label });
      detailCell.createDiv({ cls: 'll-detail-value', text: value || '-' });
    };
    detailItem('入库时间', item.inDate || '-');
    detailItem('状态', item.status || '-');
    detailItem('备注', item.notes || '-', true);
    const detailActions = box.createDiv({ cls: 'll-detail-actions' });
    detailActions.appendChild(actionButton('删除', () => {
      confirmDialog(ctx.app, `删除物资「${item.name}」？`, () => {
        void ctx.store.mutate((data) => {
          data.inventory = data.inventory.filter((current) => current.id !== item.id);
        }).then(() => ctx.rerender());
      });
    }));
  }
}

function openInventoryModal(ctx: ViewCtx, item?: InventoryItem): void {
  const isEdit = !!item;
  const modal = new LlModal(ctx.app, isEdit ? '编辑物资' : '新增物资', (body, footer) => {
    const name = makeInput(body, '名称', 'text', item?.name ?? '');
    const price = makeInput(body, '价格', 'number', item ? String(item.price) : '0');
    price.step = '0.01';
    const quantity = makeInput(body, '数量', 'number', item ? String(item.quantity) : '1');
    quantity.step = '0.01';
    const unit = makeInput(body, '单位', 'text', item?.unit ?? '');
    const inDate = makeInput(body, '入库时间', 'month', item?.inDate ?? todayMonth());

    let categoryVal = item?.category ?? '';
    const categoryRow = body.createDiv('ll-field');
    categoryRow.createEl('label', { cls: 'll-field-label', text: '类别' });
    const categoryOptions = distinct([...ctx.store.settings().inventoryCategories, categoryVal]);
    categoryRow.appendChild(renderSelect({
      options: [{ value: '', label: '—' }, ...categoryOptions.map((value) => ({ value, label: value }))],
      value: categoryVal,
      onSelect: (value) => (categoryVal = value),
    }));

    let levelVal = item?.level && (LEVEL_OPTIONS as readonly string[]).includes(item.level) ? item.level : 'A';
    const levelRow = body.createDiv('ll-field');
    levelRow.createEl('label', { cls: 'll-field-label', text: '等级' });
    levelRow.appendChild(renderSelect({
      options: LEVEL_OPTIONS.map((level) => ({ value: level, label: `${level} 级` })),
      value: levelVal,
      onSelect: (value) => (levelVal = value),
    }));

    let statusVal: InventoryItem['status'] = item?.status ?? '使用';
    const statusRow = body.createDiv('ll-field');
    statusRow.createEl('label', { cls: 'll-field-label', text: '状态' });
    statusRow.appendChild(renderSelect({
      options: STATUS_OPTIONS.map((status) => ({ value: status, label: status })),
      value: statusVal,
      onSelect: (value) => (statusVal = value as InventoryItem['status']),
    }));

    const notes = textareaField('备注');
    notes.input.value = item?.notes ?? '';
    body.appendChild(notes.row);

    const confirm = footer.createEl('button', { cls: 'll-btn ll-btn-primary', text: '确认' });
    confirm.addEventListener('click', () => {
      const statusChangedAt = statusVal === item?.status
        ? item?.statusChangedAt
        : isDiscardStatus(statusVal)
          ? nowIso()
          : undefined;
      const value: InventoryItem = {
        id: item?.id ?? uid(),
        name: name.value.trim() || '未命名物资',
        price: Math.round((Number(price.value) || 0) * 100) / 100,
        quantity: Number(quantity.value) || 0,
        unit: unit.value.trim(),
        level: levelVal,
        inDate: inDate.value || todayMonth(),
        category: categoryVal,
        status: statusVal,
        statusChangedAt,
        notes: notes.input.value.trim(),
      };
      void ctx.store.mutate((data) => {
        if (item) {
          const index = data.inventory.findIndex((current) => current.id === item.id);
          if (index >= 0) data.inventory[index] = value;
        } else data.inventory.push(value);
      }).then(() => {
        modal.close();
        ctx.rerender();
      });
    });
    const cancel = footer.createEl('button', { cls: 'll-btn', text: '取消' });
    cancel.addEventListener('click', () => modal.close());
  });
  modal.open();
}

function makeInput(body: HTMLElement, label: string, type: string, value: string): HTMLInputElement {
  const item = field(label);
  item.input.type = type;
  item.input.value = value;
  body.appendChild(item.row);
  return item.input;
}

function applyInventoryView(items: InventoryItem[], source: InventoryItem[]): InventoryItem[] {
  const query = invQuery.toLowerCase();
  const sourceOrder = new Map(source.map((item, index) => [item.id, index]));
  let output = items.slice();
  if (query) {
    output = output.filter((item) => [item.name, item.unit, item.level, item.inDate, item.category, item.status, item.notes]
      .join(' ')
      .toLowerCase()
      .includes(query));
  }
  if (invFilterLevel !== 'all') output = output.filter((item) => item.level === invFilterLevel);
  if (invFilterMonth !== 'all') output = output.filter((item) => item.inDate === invFilterMonth);
  if (invFilterCat !== 'all') output = output.filter((item) => item.category === invFilterCat);
  if (invFilterStatus !== 'all') output = output.filter((item) => item.status === invFilterStatus);

  const fallback = (a: InventoryItem, b: InventoryItem) => (sourceOrder.get(b.id) ?? 0) - (sourceOrder.get(a.id) ?? 0);
  output.sort((a, b) => {
    if (invSort === 'priceDesc') return b.price - a.price || fallback(a, b);
    if (invSort === 'priceAsc') return a.price - b.price || fallback(a, b);
    if (invSort === 'quantityDesc') return b.quantity - a.quantity || fallback(a, b);
    if (invSort === 'quantityAsc') return a.quantity - b.quantity || fallback(a, b);
    if (invSort === 'levelDesc') return (LEVEL_ORDER[b.level] ?? 0) - (LEVEL_ORDER[a.level] ?? 0) || fallback(a, b);
    if (invSort === 'levelAsc') return (LEVEL_ORDER[a.level] ?? 0) - (LEVEL_ORDER[b.level] ?? 0) || fallback(a, b);
    if (invSort === 'inDesc') return b.inDate.localeCompare(a.inDate) || fallback(a, b);
    if (invSort === 'inAsc') return a.inDate.localeCompare(b.inDate) || fallback(a, b);
    if (invSort === 'catDesc') return b.category.localeCompare(a.category) || fallback(a, b);
    if (invSort === 'catAsc') return a.category.localeCompare(b.category) || fallback(a, b);
    return fallback(a, b);
  });
  return output;
}

function isExpiredArchive(item: InventoryItem): boolean {
  if (!isDiscardStatus(item.status) || !item.statusChangedAt) return false;
  const changed = Date.parse(item.statusChangedAt);
  if (!Number.isFinite(changed)) return false;
  return Date.now() - changed >= ARCHIVE_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
}

function appendSelect(parent: HTMLElement, options: { value: string; label: string }[], value: string, onSelect: (value: string) => void): void {
  parent.appendChild(renderSelect({ options, value, onSelect, searchable: options.length > 12 }));
}

function sortOptions() {
  return [
    { value: 'createdDesc', label: '排序：新建 ↓' },
    { value: 'priceDesc', label: '排序：价格 ↓' },
    { value: 'priceAsc', label: '排序：价格 ↑' },
    { value: 'quantityDesc', label: '排序：数量 ↓' },
    { value: 'quantityAsc', label: '排序：数量 ↑' },
    { value: 'levelDesc', label: '排序：等级 ↓' },
    { value: 'levelAsc', label: '排序：等级 ↑' },
    { value: 'inDesc', label: '排序：入库月 ↓' },
    { value: 'inAsc', label: '排序：入库月 ↑' },
    { value: 'catAsc', label: '排序：类别 A-Z' },
    { value: 'catDesc', label: '排序：类别 Z-A' },
  ];
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
