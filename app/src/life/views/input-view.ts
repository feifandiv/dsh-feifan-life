import {
  InputRecord,
  INPUT_TYPES,
  InputType,
  RATING_OPTIONS,
  RATING_ORDER,
  nowIso,
  splitKeywords,
  uid,
} from '../models';
import { completedMonthIndex } from '../calc';
import { actionButton, confirmDialog, emptyState, LlModal, renderSelect, textareaField } from '../components';
import { ViewCtx } from './base';

type TypeFilter = 'all' | InputType;

let typeFilter: TypeFilter = 'all';
let query = '';
let yearFilter = 'all';
let ratingFilter = 'all';
let categoryFilter = 'all';
let influenceFilter = 'all';
let listFilter = 'all';
let sortKey = 'monthDesc';
const expanded = new Set<string>();

export function renderInputTopActions(parent: HTMLElement, ctx: ViewCtx): void {
  const search = parent.createEl('input', {
    cls: 'll-input ll-top-search',
    attr: { placeholder: '搜索输入清单' },
  });
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value.trim();
    ctx.rerender();
  });
  const add = parent.createEl('button', { cls: 'll-btn ll-btn-primary', text: '+ 新增' });
  add.addEventListener('click', () => openInputModal(ctx, undefined, typeFilter === 'all' ? '读书' : typeFilter));
}

export function renderInputView(host: HTMLElement, ctx: ViewCtx): void {
  const all = ctx.store.get().inputs;
  const toolbar = host.createDiv('ll-input-tools');
  const filterSide = toolbar.createDiv('ll-filterbar');
  appendSelect(filterSide, typeOptions(), typeFilter, (v) => {
    typeFilter = v as TypeFilter;
    ctx.rerender();
  });
  appendSelect(filterSide, yearOptions(all), yearFilter, (v) => { yearFilter = v; ctx.rerender(); });
  appendSelect(filterSide, ratingOptions(), ratingFilter, (v) => { ratingFilter = v; ctx.rerender(); });
  appendSelect(filterSide, categoryOptions(all), categoryFilter, (v) => { categoryFilter = v; ctx.rerender(); });
  appendSelect(filterSide, influenceOptions(all), influenceFilter, (v) => { influenceFilter = v; ctx.rerender(); });
  appendSelect(filterSide, listOptions(all), listFilter, (v) => { listFilter = v; ctx.rerender(); });

  const sortSide = toolbar.createDiv('ll-sortbar');
  appendSelect(sortSide, sortOptions(), sortKey, (v) => { sortKey = v; ctx.rerender(); });

  const items = applyView(all);
  const wrap = host.createDiv('ll-table-wrap');
  const table = wrap.createEl('table', { cls: 'll-table ll-input-table' });
  const colgroup = table.createEl('colgroup');
  [
    'expand',
    'type',
    'name',
    'creator',
    'rating',
    'month',
    'influence',
    'actions',
  ].forEach((key) => colgroup.createEl('col', { cls: `ll-input-col--${key}` }));
  const thead = table.createEl('thead');
  const htr = thead.createEl('tr');
  ['', '类型', '名字', '创作者', '评级', '完成月', '影响力', '编辑'].forEach((h) =>
    htr.createEl('th', { text: h })
  );
  const tbody = table.createEl('tbody');
  if (items.length === 0) {
    const tr = tbody.createEl('tr');
    const td = tr.createEl('td');
    td.colSpan = 8;
    if (all.length === 0) emptyState(td, '暂无输入记录', '点击顶部「+ 新增」开始');
    else td.setText('无匹配筛选条件');
  }
  items.forEach((it) => renderRow(tbody, it, ctx));
}

function renderRow(tbody: HTMLElement, it: InputRecord, ctx: ViewCtx): void {
  const tr = tbody.createEl('tr');
  const isOpen = expanded.has(it.id);
  const toggle = tr.createEl('td', { cls: 'll-expand-hit', text: isOpen ? '▾' : '▸' });
  toggle.setAttribute('title', isOpen ? '收起详情' : '展开详情');
  toggle.setAttribute('aria-label', isOpen ? '收起详情' : '展开详情');
  toggle.addEventListener('click', () => {
    if (expanded.has(it.id)) expanded.delete(it.id);
    else expanded.add(it.id);
    ctx.rerender();
  });
  tr.createEl('td', { text: it.type });
  tr.createEl('td', { text: it.name || '未命名' });
  tr.createEl('td', { text: it.creator || '-' });
  tr.createEl('td', { text: it.rating || '-' });
  tr.createEl('td', { text: it.completedMonth || '-' });
  tr.createEl('td', { text: it.influence || '-' });
  const ops = tr.createEl('td');
  const rowOps = ops.createDiv('ll-row-actions');
  rowOps.appendChild(actionButton('编辑', () => openInputModal(ctx, it)));
  if (isOpen) {
    const detail = tbody.createEl('tr', { cls: 'll-expand-row' });
    const td = detail.createEl('td');
    td.colSpan = 8;
    const box = td.createDiv('ll-expand-box');
    const detailGrid = box.createDiv({ cls: 'll-detail-grid' });
    const detailItem = (label: string, value: string, wide = false): void => {
      const item = detailGrid.createDiv({ cls: 'll-detail-item' + (wide ? ' is-wide' : '') });
      item.createDiv({ cls: 'll-detail-label', text: label });
      item.createDiv({ cls: 'll-detail-value', text: value || '-' });
    };
    detailItem('类别', it.category || '-');
    detailItem('榜单', (it.listTags ?? []).join(' / ') || '-');
    detailItem('关键词', it.keywords.join(' / ') || '-', true);
    detailItem('备注', remarkText(it) || '-', true);
    const extra = extraSummary(it);
    if (extra) detailItem('补充信息', extra, true);
    const detailActions = box.createDiv({ cls: 'll-detail-actions' });
    detailActions.appendChild(actionButton('删除', () => {
      confirmDialog(ctx.app, `删除「${it.name}」？`, () => {
        void ctx.store.mutate((d) => {
          d.inputs = d.inputs.filter((x) => x.id !== it.id);
        }).then(() => ctx.rerender());
      });
    }));
  }
}

function openInputModal(ctx: ViewCtx, record?: InputRecord, defaultType: InputType = '读书'): void {
  const modal = new LlModal(ctx.app, record ? '编辑输入' : '新增输入', (body, footer) => {
    let typeVal: InputType = record?.type ?? defaultType;
    const dynamicHost = body.createDiv('ll-dynamic-form');

    const renderForm = () => {
      dynamicHost.empty();
      const typeRow = dynamicHost.createDiv('ll-field');
      typeRow.createEl('label', { text: '类型', cls: 'll-field-label' });
      typeRow.appendChild(renderSelect({
        options: INPUT_TYPES.map((t) => ({ value: t, label: t })),
        value: typeVal,
        onSelect: (v) => {
          typeVal = v as InputType;
          renderForm();
        },
      }));

      const name = inputField(dynamicHost, '名字', record?.name ?? '');
      const creator = inputField(dynamicHost, creatorLabel(typeVal), record?.creator ?? '');
      let ratingVal = record?.rating ?? '';
      selectField(dynamicHost, '评级', blankOptions(RATING_OPTIONS.map((x) => ({ value: x, label: `${x}级` }))), ratingVal, (v) => (ratingVal = v));
      let categoryVal = record?.category ?? '';
      selectField(
        dynamicHost,
        '类别',
        blankOptions(optionValues(ctx.store.settings().inputCategories[typeVal], categoryVal)),
        categoryVal,
        (v) => (categoryVal = v)
      );
      let completedMonth = record?.completedMonth ?? '';
      const month = inputField(dynamicHost, '完成月', record?.completedMonth?.match(/^\d{4}-\d{2}$/) ? record.completedMonth : '', 'month');
      completedMonth = month.value;
      month.addEventListener('input', () => (completedMonth = month.value));
      let influenceVal = record?.influence ?? '';
      selectField(dynamicHost, '影响力', blankOptions(optionValues(['S', 'A', 'B', 'C'], influenceVal)), influenceVal, (v) => (influenceVal = v));
      let listVal = (record?.listTags ?? [])[0] ?? '';
      selectField(
        dynamicHost,
        '榜单',
        blankOptions(optionValues(ctx.store.settings().inputLists[typeVal], listVal)),
        listVal,
        (v) => (listVal = v)
      );
      const extra = typeVal === '读书' ? inputField(dynamicHost, '译者', record?.translator ?? '') : null;
      const keywords = inputField(dynamicHost, '关键词', record?.keywords.join('/') ?? '', 'text', '用/分隔关键词');
      const remark = textareaField('备注');
      remark.input.value = remarkText(record);
      dynamicHost.appendChild(remark.row);

      const ok = footer.querySelector<HTMLButtonElement>('.ll-save-input');
      if (ok) {
        ok.onclick = () => {
          const stamp = nowIso();
          const value: InputRecord = {
            id: record?.id ?? uid(),
            type: typeVal,
            name: name.value.trim() || '未命名',
            creator: creator.value.trim(),
            rating: ratingVal,
            category: categoryVal,
            completedMonth,
            keywords: splitKeywords(keywords.value),
            description: remark.input.value.trim(),
            translator: typeVal === '读书' ? extra?.value.trim() || undefined : undefined,
            releaseYear: record?.releaseYear,
            note: undefined,
            influence: influenceVal || undefined,
            listTags: listVal ? [listVal] : [],
            sourceSheet: record?.sourceSheet,
            createdAt: record?.createdAt ?? stamp,
            updatedAt: stamp,
          };
          void ctx.store.mutate((d) => {
            if (record) {
              const i = d.inputs.findIndex((x) => x.id === record.id);
              if (i >= 0) d.inputs[i] = value;
            } else d.inputs.push(value);
          }).then(() => {
            modal.close();
            typeFilter = typeVal;
            ctx.rerender();
          });
        };
      }
    };

    const ok = footer.createEl('button', { cls: 'll-btn ll-btn-primary ll-save-input', text: '确认' });
    const cancel = footer.createEl('button', { cls: 'll-btn', text: '取消' });
    cancel.addEventListener('click', () => modal.close());
    renderForm();
    ok.focus();
  });
  modal.open();
}

function applyView(items: InputRecord[]): InputRecord[] {
  const q = query.toLowerCase();
  let out = typeFilter === 'all' ? items.slice() : items.filter((x) => x.type === typeFilter);
  if (q) out = out.filter((x) => [x.name, x.creator, x.category, x.keywords.join('/'), remarkText(x), x.influence ?? '', (x.listTags ?? []).join('/')].join(' ').toLowerCase().includes(q));
  if (yearFilter !== 'all') out = out.filter((x) => x.completedMonth.startsWith(yearFilter));
  if (ratingFilter !== 'all') out = out.filter((x) => x.rating === ratingFilter);
  if (categoryFilter !== 'all') out = out.filter((x) => x.category === categoryFilter);
  if (influenceFilter !== 'all') out = out.filter((x) => x.influence === influenceFilter);
  if (listFilter !== 'all') out = out.filter((x) => (x.listTags ?? []).includes(listFilter));
  out.sort((a, b) => {
    if (sortKey === 'monthAsc') return completedMonthIndex(a.completedMonth) - completedMonthIndex(b.completedMonth);
    if (sortKey === 'ratingDesc') return (RATING_ORDER[b.rating] ?? 0) - (RATING_ORDER[a.rating] ?? 0);
    if (sortKey === 'ratingAsc') return (RATING_ORDER[a.rating] ?? 99) - (RATING_ORDER[b.rating] ?? 99);
    if (sortKey === 'nameAsc') return a.name.localeCompare(b.name);
    return completedMonthIndex(b.completedMonth) - completedMonthIndex(a.completedMonth);
  });
  return out;
}

function inputField(parent: HTMLElement, label: string, value: string, type = 'text', placeholder = ''): HTMLInputElement {
  const row = parent.createDiv('ll-field');
  row.createEl('label', { text: label, cls: 'll-field-label' });
  const input = row.createEl('input', { cls: 'll-input' });
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function selectField(parent: HTMLElement, label: string, options: { value: string; label: string }[], value: string, onSelect: (v: string) => void): void {
  const row = parent.createDiv('ll-field');
  row.createEl('label', { text: label, cls: 'll-field-label' });
  row.appendChild(renderSelect({ options, value, onSelect, searchable: options.length > 12 }));
}

function appendSelect(parent: HTMLElement, options: { value: string; label: string }[], value: string, onSelect: (v: string) => void) {
  const sel = renderSelect({ options, value, onSelect, searchable: options.length > 12 });
  parent.appendChild(sel);
}

function typeOptions() {
  return [{ value: 'all', label: '类型' }, ...INPUT_TYPES.map((t) => ({ value: t, label: t }))];
}

function yearOptions(items: InputRecord[]) {
  return [{ value: 'all', label: '年份' }, ...unique(items.map((x) => x.completedMonth.slice(0, 4)).filter(Boolean)).sort().reverse().map((y) => ({ value: y, label: `${y}年` }))];
}

function ratingOptions() {
  return [{ value: 'all', label: '评级' }, ...RATING_OPTIONS.map((x) => ({ value: x, label: `${x}级` }))];
}

function categoryOptions(items: InputRecord[]) {
  const source = typeFilter === 'all' ? items : items.filter((x) => x.type === typeFilter);
  return [{ value: 'all', label: '类别' }, ...unique(source.map((x) => x.category).filter(Boolean)).sort().map((c) => ({ value: c, label: c }))];
}

function influenceOptions(items: InputRecord[]) {
  return [{ value: 'all', label: '影响力' }, ...unique(items.map((x) => x.influence ?? '').filter(Boolean)).sort().map((c) => ({ value: c, label: c }))];
}

function listOptions(items: InputRecord[]) {
  return [{ value: 'all', label: '榜单' }, ...unique(items.flatMap((x) => x.listTags ?? [])).sort().map((c) => ({ value: c, label: c }))];
}

function sortOptions() {
  return [
    { value: 'monthDesc', label: '排序：完成月 ↓' },
    { value: 'monthAsc', label: '排序：完成月 ↑' },
    { value: 'ratingDesc', label: '排序：评级 ↓' },
    { value: 'ratingAsc', label: '排序：评级 ↑' },
    { value: 'nameAsc', label: '排序：名字 A-Z' },
  ];
}

function optionValues(values: string[], current = '') {
  return unique([...values, current].filter(Boolean)).map((value) => ({ value, label: value }));
}

function blankOptions(options: { value: string; label: string }[]) {
  return [{ value: '', label: '—' }, ...options];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function creatorLabel(type: InputType): string {
  if (type === '读书') return '作者';
  if (type === '观影') return '导演';
  return '老师';
}

function remarkText(it?: InputRecord): string {
  return it?.description || it?.note || '';
}

function extraSummary(it: InputRecord): string {
  if (it.type === '读书' && it.translator) return `译者：${it.translator}`;
  if (it.type === '观影' && it.releaseYear) return `上映年份：${it.releaseYear}`;
  return '';
}
