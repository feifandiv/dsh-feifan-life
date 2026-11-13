// 财务记账插件 · View 2 收支明细 + 记一笔弹窗
import { Category, LedgerBucket, TxnType, uid, todayStr } from '../models';
import { categoryOptions, filterTransactions, groupByDate, formatMoney } from '../calc';
import { FinanceStore } from '../store';
import { ViewCtx } from './base';
import {
  FlModal,
  field,
  textareaField,
  renderSelect,
  confirmDialog,
  toast,
  emptyState,
} from '../components';

export function renderDetailView(host: HTMLElement, ctx: ViewCtx): void {
  const b = ctx.store.current();
  const sym = ctx.store.get().settings.currencySymbol;
  const initialPeriod = detailInitialPeriod(b);

  let fType: 'all' | TxnType = 'all';
  let fYear: number | null = initialPeriod.year;
  let fMonth: number | null = initialPeriod.month;

  const filterSec = host.createDiv('fl-section fl-detail-filters');
  const fbar = filterSec.createDiv();
  fbar.style.display = 'flex';
  fbar.style.gap = '8px';
  fbar.style.flexWrap = 'wrap';
  fbar.style.alignItems = 'center';

  const typeSel = renderSelect({
    options: [
      { value: 'all', label: '全部类型' },
      { value: '收入', label: '收入' },
      { value: '支出', label: '支出' },
    ],
    value: 'all',
    onSelect: (v) => {
      fType = v as 'all' | TxnType;
      applyFilters();
    },
  });
  const yearSel = renderSelect({
    options: yearOptions(b),
    value: String(fYear),
    onSelect: (v) => {
      fYear = v === 'all' ? null : parseInt(v);
      applyFilters();
    },
  });
  const monthSel = renderSelect({
    options: [
      { value: 'all', label: '全部月份' },
      ...Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `${i + 1}月` })),
    ],
    value: String(fMonth),
    onSelect: (v) => {
      fMonth = v === 'all' ? null : parseInt(v);
      applyFilters();
    },
  });
  [typeSel, yearSel, monthSel].forEach((s) => {
    s.style.flex = '0 0 auto';
    s.style.width = 'auto';
    s.style.minWidth = '110px';
    fbar.appendChild(s);
  });

  const listEl = host.createDiv();

  function applyFilters() {
    listEl.empty();
    const txns = filterTransactions(b.transactions, fType, fYear, fMonth);
    if (txns.length === 0) {
      const otherLedgerId = b.id === 'personal' ? 'business' : 'personal';
      const otherLedger = ctx.store.ledger(otherLedgerId);
      const dataIsInOtherLedger = b.transactions.length === 0 && otherLedger.transactions.length > 0;
      const empty = emptyState(
        listEl,
        dataIsInOtherLedger
          ? `当前为${b.name}`
          : b.transactions.length > 0
            ? '当前筛选下暂无记录'
            : '暂无记录',
        dataIsInOtherLedger
          ? `${otherLedger.name}中有 ${otherLedger.transactions.length} 笔收支记录，数据没有丢失`
          : b.transactions.length > 0
            ? `该账本共有 ${b.transactions.length} 笔历史记录，可切换年份或月份查看`
            : '点击顶部「+ 记一笔」添加',
      );
      if (dataIsInOtherLedger) {
        const switchButton = empty.createEl('button', {
          cls: 'fl-btn fl-btn-primary fl-empty-action',
          text: `切换到${otherLedger.name}`,
        });
        switchButton.addEventListener('click', () => ctx.store.setCurrentLedger(otherLedgerId));
      }
      return;
    }
    const groups = groupByDate(txns);
    groups.forEach((g) => {
      const dg = listEl.createDiv('fl-date-group');
      dg.createDiv({ cls: 'fl-date-label', text: g.date });
      const list = dg.createDiv('fl-list');
      g.items.forEach((t) => {
        const card = list.createDiv('fl-card fl-txn-card ' + (t.type === '收入' ? 'is-income' : 'is-expense'));
        const row = card.createDiv('fl-card-row');
        const left = row.createDiv();
        const title = left.createDiv('fl-card-title fl-txn-title');
        title.createSpan({ cls: 'fl-txn-kind', text: t.type });
        title.createSpan({ text: `${t.cat3} · ${t.cat2}` });
        if (t.note) left.createDiv({ cls: 'fl-card-sub', text: t.note });
        const right = row.createDiv('fl-actions');
        right.createDiv({
          cls: 'fl-amount ' + (t.type === '收入' ? 'income' : 'expense'),
          text: formatMoney(t.amount, sym),
        });
        const ed = right.createDiv('fl-icon-btn fl-icon-btn--text');
        ed.setText('编辑');
        ed.addEventListener('click', () => openTransactionModal(ctx.app, ctx.store, t));
        const dl = right.createDiv('fl-icon-btn fl-icon-btn--text');
        dl.setText('删除');
        dl.addEventListener('click', () =>
          confirmDialog(ctx.app, '删除这条记录？', () => {
            ctx.store
              .mutate((d) => {
                const lb = d.ledgers[d.currentLedger];
                lb.transactions = lb.transactions.filter((x) => x.id !== t.id);
              })
              .then(() => ctx.rerender());
          })
        );
      });
    });
  }

  applyFilters();
}

function detailInitialPeriod(b: LedgerBucket): { year: number; month: number } {
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() };
  const hasCurrentMonth = b.transactions.some((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    return !isNaN(date.getTime())
      && date.getFullYear() === current.year
      && date.getMonth() === current.month;
  });
  if (hasCurrentMonth) return current;

  const latest = b.transactions
    .map((transaction) => new Date(`${transaction.date}T00:00:00`))
    .filter((date) => !isNaN(date.getTime()))
    .sort((a, c) => c.getTime() - a.getTime())[0];
  return latest ? { year: latest.getFullYear(), month: latest.getMonth() } : current;
}

function yearOptions(b: LedgerBucket): { value: string; label: string }[] {
  const set = new Set<number>();
  b.transactions.forEach((t) => {
    const y = new Date(t.date + 'T00:00:00').getFullYear();
    if (!isNaN(y)) set.add(y);
  });
  set.add(new Date().getFullYear());
  return [...set]
    .sort((a, c) => c - a)
    .map((y) => ({ value: String(y), label: `${y}年` }));
}

// ── 记一笔 / 编辑记录 ──
export function openTransactionModal(
  app: any,
  store: FinanceStore,
  prefill?: any,
  cb?: () => void
): void {
  const isEdit = !!(prefill && prefill.id);
  const modal = new FlModal(app, isEdit ? '编辑记录' : '记一笔', (body, footer) => {
    const b = store.current();

    const lbField = field('账本');
    lbField.input.value = b.name;
    lbField.input.readOnly = true;
    body.appendChild(lbField.row);

    let curType: TxnType = prefill?.type ?? '支出';
    let curCat2 = prefill?.cat2 ?? '';
    let curCat3 = prefill?.cat3 ?? '';

    const typeRow = field('类型');
    const typeSel = renderSelect({
      options: [
        { value: '收入', label: '收入' },
        { value: '支出', label: '支出' },
      ],
      value: curType,
      onSelect: (v) => {
        curType = v as TxnType;
        curCat2 = '';
        curCat3 = '';
        rebuildCat();
      },
    });
    typeRow.input.remove();
    typeRow.row.appendChild(typeSel);
    body.appendChild(typeRow.row);

    const dateField = field('日期');
    dateField.input.type = 'date';
    dateField.input.value = prefill?.date ?? todayStr();
    body.appendChild(dateField.row);

    const catRow = field('类目');
    let catSel: HTMLElement = document.createElement('div');
    catRow.input.remove();
    catRow.row.appendChild(catSel);
    body.appendChild(catRow.row);
    const quickRow = body.createDiv('fl-category-quick');

    function rebuildCat(selectedId?: string) {
      const options = categoryOptions(b.categories, curType, b.transactions);
      catSel.remove();
      catSel = renderSelect({
        options,
        value: selectedId,
        searchable: true,
        placeholder: '搜索类目（三级·二级）',
        onSelect: (v) => {
          const o = options.find((x) => x.value === v);
          if (o) {
            curCat2 = o.cat2;
            curCat3 = o.cat3;
            rebuildQuick(o.value);
          }
        },
      });
      catSel.addClass('fl-select--categories');
      catRow.row.appendChild(catSel);
      rebuildQuick(selectedId);
    }

    function rebuildQuick(selectedId?: string) {
      quickRow.empty();
      quickRow.createDiv({ cls: 'fl-category-quick-label', text: '常用类目' });
      const options = categoryOptions(b.categories, curType, b.transactions).slice(0, 8);
      const grid = quickRow.createDiv('fl-category-quick-grid');
      options.forEach((option) => {
        const button = grid.createEl('button', {
          cls: `fl-category-quick-item${option.value === selectedId ? ' is-active' : ''}`,
          attr: { type: 'button', title: option.label },
        });
        button.createSpan({ cls: 'fl-category-quick-name', text: option.cat3 });
        button.createSpan({ cls: 'fl-category-quick-parent', text: option.cat2 });
        button.addEventListener('click', () => {
          curCat2 = option.cat2;
          curCat3 = option.cat3;
          rebuildCat(option.value);
        });
      });
    }

    rebuildCat(findCatId(b.categories, curType, curCat2, curCat3));

    const amtField = field('金额（元）');
    amtField.input.type = 'number';
    amtField.input.step = '0.01';
    amtField.input.value = isEdit ? String(prefill.amount) : '';
    body.appendChild(amtField.row);

    const noteField = textareaField('备注');
    noteField.input.value = isEdit ? prefill.note : '';
    body.appendChild(noteField.row);

    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const amount = parseFloat(amtField.input.value);
      if (isNaN(amount) || amount <= 0) {
        toast('请输入有效金额');
        return;
      }
      if (!curCat3) {
        toast('请选择类目');
        return;
      }
      store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          const cat1 = lb.id === 'personal' ? '个人' : '生意';
          if (isEdit) {
            const t = lb.transactions.find((x) => x.id === prefill.id);
            if (t) {
              t.type = curType;
              t.date = dateField.input.value;
              t.cat1 = cat1;
              t.cat2 = curCat2;
              t.cat3 = curCat3;
              t.amount = amount;
              t.note = noteField.input.value;
            }
          } else {
            lb.transactions.push({
              id: uid(),
              type: curType,
              date: dateField.input.value,
              cat1,
              cat2: curCat2,
              cat3: curCat3,
              amount,
              note: noteField.input.value,
              createdAt: new Date().toISOString(),
            });
          }
        })
        .then(() => {
          modal.close();
          cb && cb();
        });
    });
    const cancel = footer.createEl('button', { text: '取消', cls: 'fl-btn' });
    cancel.addEventListener('click', () => modal.close());
  });
  modal.open();
}

function findCatId(
  cats: Category[],
  type: TxnType,
  cat2: string,
  cat3: string
): string | undefined {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const l3 = cats.find((c) => c.level === 3 && c.type === type && c.name === cat3);
  if (!l3) return undefined;
  const parent = l3.parentId ? byId.get(l3.parentId) : undefined;
  if (parent && parent.name === cat2) return l3.id;
  return undefined;
}
