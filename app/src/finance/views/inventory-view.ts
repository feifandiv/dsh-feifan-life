// 财务记账插件 · View 5 物资管理清单（全局，不受账本切换）
import {
  InventoryItem,
  uid,
  LEVEL_OPTIONS,
  LEVEL_ORDER,
  STATUS_OPTIONS,
  isDiscardStatus,
  genIdCard,
} from '../models';
import { ViewCtx } from './base';
import { confirmDialog, toast, FlModal, field, renderSelect, textareaField } from '../components';
import { formatMoney } from '../calc';
import { exportCsv, openCsvImportModal } from '../io';

// ── 物资清单筛选/排序状态（模块级，跨重渲染保留）──
let invFilterLevel: string = 'all';
let invFilterMonth: string = 'all';
let invFilterCat: string = 'all';
let invSort: string = 'inDesc'; // 默认：入库时间（晚→早）

interface Col {
  key: keyof InventoryItem;
  label: string;
  type: 'text' | 'number' | 'date';
}

const COLS: Col[] = [
  { key: 'name', label: '名称', type: 'text' },
  { key: 'price', label: '价格', type: 'number' },
  { key: 'quantity', label: '数量', type: 'number' },
  { key: 'unit', label: '单位', type: 'text' },
  { key: 'level', label: '等级', type: 'text' },
  { key: 'inDate', label: '入库时间', type: 'date' },
  { key: 'category', label: '类别', type: 'text' },
  { key: 'status', label: '状态', type: 'text' },
  { key: 'idCard', label: '身份证', type: 'text' },
  { key: 'notes', label: '备注', type: 'text' },
];

function todayMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

function distinctLevels(items: InventoryItem[]): string[] {
  return [...new Set(items.map((x) => String(x.level)))].sort();
}
function distinctMonths(items: InventoryItem[]): string[] {
  return [...new Set(items.map((x) => (x.inDate || '').slice(0, 7)).filter(Boolean))].sort().reverse();
}
function distinctCats(items: InventoryItem[]): string[] {
  return [...new Set(items.map((x) => x.category).filter(Boolean))].sort();
}

function applyInvView(items: InventoryItem[]): InventoryItem[] {
  let out = items.slice();
  if (invFilterLevel !== 'all') out = out.filter((x) => x.level === invFilterLevel);
  if (invFilterMonth !== 'all') out = out.filter((x) => (x.inDate || '').slice(0, 7) === invFilterMonth);
  if (invFilterCat !== 'all') out = out.filter((x) => x.category === invFilterCat);
  out.sort((a, b) => {
    switch (invSort) {
      case 'inAsc': return (a.inDate || '').localeCompare(b.inDate || '');
      case 'inDesc': return (b.inDate || '').localeCompare(a.inDate || '');
      case 'priceAsc': return (a.price || 0) - (b.price || 0);
      case 'priceDesc': return (b.price || 0) - (a.price || 0);
      case 'catAsc': return (a.category || '').localeCompare(b.category || '');
      case 'levelAsc': return (LEVEL_ORDER[a.level] ?? 0) - (LEVEL_ORDER[b.level] ?? 0);
      case 'levelDesc': return (LEVEL_ORDER[b.level] ?? 0) - (LEVEL_ORDER[a.level] ?? 0);
      default: return 0;
    }
  });
  // 稳定置底：废弃 / 转卖 始终排在最后，不受任何排序影响
  const normal = out.filter((x) => !isDiscardStatus(x.status));
  const discard = out.filter((x) => isDiscardStatus(x.status));
  return normal.concat(discard);
}

export function renderInventoryView(host: HTMLElement, ctx: ViewCtx): void {
  const sym = ctx.store.get().settings.currencySymbol;
  const allItems = ctx.store.get().inventory;

  const note = host.createDiv('fl-section-sub');
  note.setText('物资清单为全局模块，不受顶部账本切换影响。表格为只读展示，新增/修改请使用每行的「编辑」或顶部「+ 新增」。');
  note.style.marginBottom = '10px';

  // ── 工具栏：导入/导出/新增 + 筛选/排序 ──
  const bar = host.createDiv('fl-section-head fl-inv-bar');
  const acts = bar.createDiv('fl-actions');
  const imp = acts.createDiv('fl-btn');
  imp.setText('导入 CSV');
  imp.addEventListener('click', () => openCsvImportModal(ctx.store, () => ctx.rerender()));
  const exp = acts.createDiv('fl-btn');
  exp.setText('导出 CSV');
  exp.addEventListener('click', () => exportCsv(allItems));
  const add = acts.createDiv('fl-btn fl-btn-primary');
  add.setText('+ 新增');
  add.addEventListener('click', () => openInventoryModal(ctx));

  const filters = bar.createDiv('fl-inv-filters');
  const lvOpts = [
    { value: 'all', label: '全部等级' },
    ...distinctLevels(allItems).map((l) => ({ value: l, label: `${l} 级` })),
  ];
  const moOpts = [
    { value: 'all', label: '全部入库月' },
    ...distinctMonths(allItems).map((m) => ({ value: m, label: `${m}` })),
  ];
  const catOpts = [
    { value: 'all', label: '全部类别' },
    ...distinctCats(allItems).map((c) => ({ value: c, label: c })),
  ];
  const sortOpts = [
    { value: 'inDesc', label: '入库时间（晚→早）' },
    { value: 'inAsc', label: '入库时间（早→晚）' },
    { value: 'priceDesc', label: '价格（高→低）' },
    { value: 'priceAsc', label: '价格（低→高）' },
    { value: 'catAsc', label: '类别（A→Z）' },
    { value: 'levelDesc', label: '等级（高→低）' },
    { value: 'levelAsc', label: '等级（低→高）' },
  ];
  const mkSel = (opts: { value: string; label: string }[], value: string, onSel: (v: string) => void) => {
    const s = renderSelect({ options: opts, value, onSelect: onSel });
    s.style.width = 'auto';
    s.style.minWidth = '110px';
    filters.appendChild(s);
  };
  mkSel(lvOpts, invFilterLevel, (v) => { invFilterLevel = v; ctx.rerender(); });
  mkSel(moOpts, invFilterMonth, (v) => { invFilterMonth = v; ctx.rerender(); });
  mkSel(catOpts, invFilterCat, (v) => { invFilterCat = v; ctx.rerender(); });
  mkSel(sortOpts, invSort, (v) => { invSort = v; ctx.rerender(); });

  // ── 统计模块：总金额（所有物资金额总和）/ 总数量（所有物资总数量）──
  const stats = bar.createDiv('fl-inv-stats');
  const totalAmt = allItems.reduce(
    (s, x) => s + (Number(x.price) || 0) * (Number(x.quantity) || 0),
    0
  );
  const totalQty = allItems.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const sa = stats.createDiv('fl-inv-stat');
  sa.createDiv('fl-inv-stat-label').setText('总金额');
  sa.createDiv('fl-inv-stat-value').setText(formatMoney(totalAmt, sym));
  const sq = stats.createDiv('fl-inv-stat');
  sq.createDiv('fl-inv-stat-label').setText('总数量');
  sq.createDiv('fl-inv-stat-value').setText(String(totalQty));

  const items = applyInvView(allItems);
  const wrap = host.createDiv('fl-table-wrap');
  const table = wrap.createEl('table', { cls: 'fl-table' });
  const thead = table.createEl('thead');
  const htr = thead.createEl('tr');
  COLS.forEach((c) => htr.createEl('th', { text: c.label }));
  htr.createEl('th', { text: '操作' });

  const tbody = table.createEl('tbody');
  if (items.length === 0) {
    const tr = tbody.createEl('tr');
    const td = tr.createEl('td');
    td.colSpan = COLS.length + 1;
    td.setText(allItems.length === 0 ? '暂无物资，点击「+ 新增」或「导入 CSV」' : '无匹配筛选/排序条件');
  }
  items.forEach((it) => {
    const tr = tbody.createEl('tr');
    if (isDiscardStatus(it.status)) tr.addClass('fl-inv-row-discard');
    COLS.forEach((c) => {
      const td = tr.createEl('td');
      if (c.key === 'notes') {
        td.style.whiteSpace = 'normal';
        td.style.maxWidth = '220px';
      }
      const cur = (it as any)[c.key];
      if (c.key === 'price') {
        td.setText(formatMoney(cur ?? 0, sym));
      } else if (cur == null || cur === '') {
        td.setText('—');
      } else {
        td.setText(String(cur));
      }
    });
    const opTd = tr.createEl('td');
    const opRow = opTd.createDiv('fl-row-actions');
    const edit = opRow.createDiv('fl-icon-btn fl-icon-btn--text');
    edit.setText('编辑');
    edit.setAttribute('title', '编辑');
    edit.addEventListener('click', () => openInventoryModal(ctx, it));
    const del = opRow.createDiv('fl-icon-btn fl-icon-btn--text');
    del.setText('删除');
    del.setAttribute('title', '删除');
    del.addEventListener('click', () =>
      confirmDialog(ctx.app, `删除物资「${it.name}」？`, () => {
        ctx.store
          .mutate((d) => {
            d.inventory = d.inventory.filter((x) => x.id !== it.id);
          })
          .then(() => ctx.rerender());
      })
    );
  });
}

// ── 新增 / 编辑弹窗 ──
function openInventoryModal(ctx: ViewCtx, item?: InventoryItem): void {
  const isEdit = !!item;
  const modal = new FlModal(ctx.app, isEdit ? '编辑物资' : '新增物资', (body, footer) => {
    const mk = (
      label: string,
      type: 'text' | 'number' | 'date' | 'month' = 'text',
      val = ''
    ): HTMLInputElement => {
      const f = field(label);
      if (type === 'date') f.input.type = 'date';
      else if (type === 'month') f.input.type = 'month';
      else if (type === 'number') {
        f.input.type = 'number';
        f.input.step = '0.01';
      }
      f.input.value = val;
      body.appendChild(f.row);
      return f.input;
    };

    const nameI = mk('名称', 'text', item?.name ?? '');
    const priceI = mk('价格（元，保留两位小数）', 'number', item ? String(item.price) : '0');
    const qtyI = mk('数量', 'number', item ? String(item.quantity) : '1');
    const unitI = mk('单位', 'text', item?.unit ?? '');
    const inI = mk('入库时间（精确到月）', 'month', item?.inDate ?? todayMonth());
    const catI = mk('类别', 'text', item?.category ?? '');

    // 等级：A/B/C/S 下拉，默认 A
    const lvField = body.createDiv('fl-field');
    lvField.createEl('label', { text: '等级', cls: 'fl-field-label' });
    let levelVal: string =
      item && (LEVEL_OPTIONS as readonly string[]).includes(item.level) ? item.level : 'A';
    lvField.appendChild(
      renderSelect({
        options: LEVEL_OPTIONS.map((l) => ({ value: l, label: `${l} 级` })),
        value: levelVal,
        onSelect: (v) => (levelVal = v),
      })
    );

    // 状态：使用 / 废弃 / 转卖 / 改造 下拉，默认 使用
    const stField = body.createDiv('fl-field');
    stField.createEl('label', { text: '状态', cls: 'fl-field-label' });
    let statusVal: string = item?.status ?? '使用';
    stField.appendChild(
      renderSelect({
        options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
        value: statusVal,
        onSelect: (v) => (statusVal = v),
      })
    );

    // 身份证号：自动生成（只读预览，类别变化时实时更新）
    const idF = field('身份证号（自动生成）');
    const idI = idF.input;
    idI.readOnly = true;
    idI.style.background = 'var(--fl-surface-3)';
    body.appendChild(idF.row);
    const updateIdPreview = () => {
      idI.value = genIdCard(catI.value, ctx.store.get().inventory);
    };
    if (!isEdit) {
      catI.addEventListener('input', updateIdPreview);
      updateIdPreview();
    } else {
      idI.value = item.idCard ?? '';
    }

    // 备注
    const notesF = textareaField('备注');
    notesF.input.value = item?.notes ?? '';
    body.appendChild(notesF.row);

    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const round2 = (v: number) => Math.round(v * 100) / 100;
      const data: InventoryItem = {
        id: item?.id ?? uid(),
        name: nameI.value.trim() || '未命名物资',
        price: round2(parseFloat(priceI.value) || 0),
        quantity: parseFloat(qtyI.value) || 0,
        unit: unitI.value.trim(),
        level: levelVal,
        inDate: inI.value || todayMonth(),
        category: catI.value.trim(),
        status: statusVal as InventoryItem['status'],
        notes: notesF.input.value.trim(),
        idCard: isEdit
          ? item.idCard ?? undefined
          : genIdCard(catI.value, ctx.store.get().inventory),
      };
      ctx.store
        .mutate((d) => {
          if (item) {
            const i = d.inventory.findIndex((x) => x.id === item.id);
            if (i >= 0) d.inventory[i] = data;
          } else {
            d.inventory.push(data);
          }
        })
        .then(() => {
          modal.close();
          ctx.rerender();
        });
    });
    const cancel = footer.createEl('button', { text: '取消', cls: 'fl-btn' });
    cancel.addEventListener('click', () => modal.close());
  });
  modal.open();
}
