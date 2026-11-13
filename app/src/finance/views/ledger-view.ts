// 财务记账插件 · View 1 账本视图
import { Category, TxnType, uid } from '../models';
import { categoryTree, formatMoney, categoryTotals, CatNode } from '../calc';
import { ViewCtx } from './base';
import {
  FlModal,
  field,
  confirmDialog,
  toast,
  emptyState,
} from '../components';
import { openTransactionModal } from './detail-view';

export function renderLedgerView(host: HTMLElement, ctx: ViewCtx): void {
  const b = ctx.store.current();
  const sym = ctx.store.get().settings.currencySymbol;
  const stats = ctx.store.currentStats();

  // ── 账本概述 ──
  const sumSec = host.createDiv('fl-section');
  const head = sumSec.createDiv('fl-section-head');
  head.createDiv({ cls: 'fl-section-title', text: b.name });
  const acts = head.createDiv('fl-actions');
  const rename = acts.createDiv('fl-btn');
  rename.setText('改名');
  rename.addEventListener('click', () => openLedgerNameModal(ctx));
  const budget = acts.createDiv('fl-btn');
  budget.setText('月预算');
  budget.addEventListener('click', () => openBudgetModal(ctx));
  const settle = acts.createDiv('fl-btn');
  settle.setText('平账');
  settle.addEventListener('click', () => openSettleModal(ctx));

  const grid = sumSec.createDiv('fl-ledger-summary');
  cell(grid, '余额', formatMoney(b.balanceOverride != null ? b.balanceOverride : stats.balance, sym));
  cell(grid, '累计收入', formatMoney(stats.totalIncome, sym), 'income');
  cell(grid, '累计支出', formatMoney(stats.totalExpense, sym), 'expense');
  cell(grid, '月预算', formatMoney(b.monthlyBudget, sym));
  cell(grid, '预算剩余', formatMoney(stats.budgetRemaining, sym));

  // ── 类目 ──
  renderCategorySection(host, ctx, '收入');
  renderCategorySection(host, ctx, '支出');
}

function cell(
  parent: HTMLElement,
  k: string,
  v: string,
  cls?: 'income' | 'expense'
): void {
  const c = parent.createDiv('fl-summary-cell');
  c.createDiv({ cls: 'k', text: k });
  c.createDiv({ cls: 'v' + (cls ? ' ' + cls : ''), text: v });
}

function renderCategorySection(host: HTMLElement, ctx: ViewCtx, type: TxnType): void {
  const b = ctx.store.current();
  const sym = ctx.store.get().settings.currencySymbol;
  const sec = host.createDiv('fl-section');
  const head = sec.createDiv('fl-section-head');
  head.createDiv({
    cls: 'fl-section-title',
    text: type === '收入' ? '收入类目' : '支出类目',
  });
  const add = head.createDiv('fl-btn');
  add.setText('+ 添加');
  add.addEventListener('click', () => openCategoryModal(ctx, type, undefined));

  const cats = b.categories.filter((c) => c.type === type);
  if (cats.length === 0) {
    emptyState(sec, '暂无类目', '点击「+ 添加」创建收支类目');
    return;
  }
  const totals = categoryTotals(b, type);
  const tree = categoryTree(cats);
  tree.forEach((node2) => {
    const totalVal = totals.find((t) => t.cat2 === node2.cat.name)?.total ?? 0;
    const g = sec.createDiv('fl-cat-group');
    const head = g.createDiv('fl-cat-group-head');
    head.createDiv({ cls: 'fl-cat-group-title', text: node2.cat.name });
    head.createDiv({
      cls: 'fl-cat-group-amt ' + (type === '收入' ? 'income' : 'expense'),
      text: formatMoney(totalVal, sym),
    });
    const manage = head.createDiv('fl-btn fl-btn-mini');
    manage.setText('管理');
    manage.addEventListener('click', () => openCategoryGroupModal(ctx, type, node2));
    const chips = g.createDiv('fl-chips');
    node2.children.forEach((node3) => {
      const chip = chips.createDiv('fl-chip ' + (type === '收入' ? 'is-income' : 'is-expense'));
      chip.createSpan({ text: node3.cat.name });
      const edit = chip.createDiv('fl-chip-edit');
      edit.setText('改');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        openCategoryModal(ctx, type, node3.cat);
      });
      const del = chip.createDiv('fl-chip-edit');
      del.setText('删');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog(
          ctx.app,
          `删除类目「${node3.cat.name}」？其下子项一并删除，历史记账不受影响。`,
          () => {
            ctx.store
              .mutate((d) => {
                const lb = d.ledgers[d.currentLedger];
                lb.categories = lb.categories.filter((c) => c.id !== node3.cat.id);
              })
              .then(() => ctx.rerender());
          }
        );
      });
      chip.addEventListener('click', () =>
        openTransactionModal(ctx.app, ctx.store, {
          type,
          cat2: node2.cat.name,
          cat3: node3.cat.name,
        })
      );
    });
  });
}

// ── 账本改名 ──
function openLedgerNameModal(ctx: ViewCtx): void {
  const modal = new FlModal(ctx.app, '账本改名', (body, footer) => {
    const f = field('账本名称');
    f.input.value = ctx.store.current().name;
    body.appendChild(f.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name = f.input.value.trim();
      if (!name) {
        toast('名称不能为空');
        return;
      }
      ctx.store
        .mutate((d) => {
          d.ledgers[d.currentLedger].name = name;
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

// ── 月预算 ──
function openBudgetModal(ctx: ViewCtx): void {
  const modal = new FlModal(ctx.app, '设置月预算', (body, footer) => {
    const f = field('月预算（元，默认 0）');
    f.input.type = 'number';
    f.input.step = '0.01';
    f.input.value = String(ctx.store.current().monthlyBudget);
    body.appendChild(f.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const v = parseFloat(f.input.value);
      ctx.store
        .mutate((d) => {
          d.ledgers[d.currentLedger].monthlyBudget = isNaN(v) ? 0 : v;
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

// ── 平账 ──
function openSettleModal(ctx: ViewCtx): void {
  const modal = new FlModal(ctx.app, '平账', (body, footer) => {
    const info = body.createDiv('fl-card-sub');
    info.setText('输入一个金额覆盖当前余额；留空并点「恢复自动」则改回由收支自动计算。');
    const f = field('覆盖余额（元）');
    f.input.type = 'number';
    f.input.step = '0.01';
    const b = ctx.store.current();
    f.input.value = b.balanceOverride != null ? String(b.balanceOverride) : '';
    body.appendChild(f.row);
    const ok = footer.createEl('button', { text: '覆盖', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const v = parseFloat(f.input.value);
      if (isNaN(v)) {
        toast('请输入有效金额');
        return;
      }
      ctx.store
        .mutate((d) => {
          d.ledgers[d.currentLedger].balanceOverride = v;
        })
        .then(() => {
          modal.close();
          ctx.rerender();
        });
    });
    const reset = footer.createEl('button', { text: '恢复自动', cls: 'fl-btn' });
    reset.addEventListener('click', () => {
      ctx.store
        .mutate((d) => {
          d.ledgers[d.currentLedger].balanceOverride = null;
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

// ── 类目增改 ──
export function openCategoryModal(
  ctx: ViewCtx,
  type: TxnType,
  editCat?: Category
): void {
  const b = ctx.store.current();
  const modal = new FlModal(ctx.app, editCat ? '编辑类目' : '添加类目', (body, footer) => {
    const typeField = field('类型');
    typeField.input.value = type;
    typeField.input.readOnly = true;
    body.appendChild(typeField.row);

    const f2 = field('二级大类（如：职业 / 生存）');
    f2.input.value = editCat ? parentName(b.categories, editCat.parentId) : '';
    body.appendChild(f2.row);

    const f3 = field('三级名称（如：工资 / 餐饮）');
    f3.input.value = editCat ? editCat.name : '';
    body.appendChild(f3.row);

    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name2 = f2.input.value.trim() || '其他';
      const name3 = f3.input.value.trim();
      if (!name3) {
        toast('请填写三级名称');
        return;
      }
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          let l2 = lb.categories.find(
            (c) => c.level === 2 && c.type === type && c.name === name2
          );
          if (!l2) {
            l2 = {
              id: uid(),
              level: 2,
              parentId: null,
              name: name2,
              type,
              sortOrder: lb.categories.length,
            };
            lb.categories.push(l2);
          }
          if (editCat) {
            const l3 = lb.categories.find((c) => c.id === editCat.id);
            if (l3) {
              l3.name = name3;
              l3.parentId = l2.id;
            }
          } else {
            const dup = lb.categories.find(
              (c) => c.level === 3 && c.parentId === l2.id && c.name === name3
            );
            if (!dup) {
              lb.categories.push({
                id: uid(),
                level: 3,
                parentId: l2.id,
                name: name3,
                type,
                sortOrder: lb.categories.length,
              });
            }
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

function parentName(cats: Category[], pid: string | null): string {
  if (!pid) return '';
  return cats.find((c) => c.id === pid)?.name ?? '';
}

// ── 二级类目管理弹窗（集中增删改该二级下的所有三级 + 二级改名/删整组）──
function openCategoryGroupModal(ctx: ViewCtx, type: TxnType, node2: CatNode): void {
  const modal = new FlModal(ctx.app, '管理类目组', (body, footer) => {
    const l2 = node2.cat;

    // 二级改名 / 删除整组
    const topRow = body.createDiv('fl-cat-group-manage');
    const rename = topRow.createDiv('fl-btn fl-btn-mini');
    rename.setText('改名二级');
    rename.addEventListener('click', () => {
      const v = window.prompt('二级大类名称', l2.name);
      if (v == null) return;
      const name = v.trim();
      if (!name) {
        toast('名称不能为空');
        return;
      }
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          const found = lb.categories.find((c) => c.id === l2.id);
          if (found) found.name = name;
        })
        .then(() => {
          ctx.rerender();
          // 重开弹窗刷新标题与列表
          modal.close();
          openCategoryGroupModal(ctx, type, categoryTree(ctx.store.current().categories).find((n) => n.cat.id === l2.id)!);
        });
    });
    const delGroup = topRow.createDiv('fl-btn fl-btn-mini fl-btn-danger');
    delGroup.setText('删除整组');
    delGroup.addEventListener('click', () => {
      confirmDialog(ctx.app, `删除二级「${l2.name}」及其下全部三级？历史记账不受影响。`, () => {
        ctx.store
          .mutate((d) => {
            const lb = d.ledgers[d.currentLedger];
            const ids = new Set([l2.id, ...node2.children.map((c) => c.cat.id)]);
            lb.categories = lb.categories.filter((c) => !ids.has(c.id));
          })
          .then(() => {
            modal.close();
            ctx.rerender();
          });
      });
    });

    // 三级列表
    const listWrap = body.createDiv('fl-cat-manage-list');
    const renderList = () => {
      listWrap.empty();
      if (node2.children.length === 0) {
        emptyState(listWrap, '暂无三级类目', '在下方输入框新增');
        return;
      }
      node2.children.forEach((node3) => {
        const item = listWrap.createDiv('fl-cat-manage-item');
        item.createDiv({ cls: 'fl-cat-manage-name', text: node3.cat.name });
        const acts = item.createDiv('fl-row-actions');
        const ed = acts.createDiv('fl-icon-btn fl-icon-btn--text');
        ed.setText('编辑');
        ed.addEventListener('click', () => {
          const v = window.prompt('三级名称', node3.cat.name);
          if (v == null) return;
          const name = v.trim();
          if (!name) {
            toast('名称不能为空');
            return;
          }
          ctx.store
            .mutate((d) => {
              const lb = d.ledgers[d.currentLedger];
              const found = lb.categories.find((c) => c.id === node3.cat.id);
              if (found) found.name = name;
            })
            .then(() => {
              node3.cat.name = name;
              renderList();
              ctx.rerender();
            });
        });
        const dl = acts.createDiv('fl-icon-btn fl-icon-btn--text');
        dl.setText('删除');
        dl.addEventListener('click', () => {
          confirmDialog(ctx.app, `删除三级「${node3.cat.name}」？历史记账不受影响。`, () => {
            ctx.store
              .mutate((d) => {
                const lb = d.ledgers[d.currentLedger];
                lb.categories = lb.categories.filter((c) => c.id !== node3.cat.id);
              })
              .then(() => {
                node2.children = node2.children.filter((c) => c.cat.id !== node3.cat.id);
                renderList();
                ctx.rerender();
              });
          });
        });
      });
    };
    renderList();

    // 新增三级（只填三级名，自动归属当前二级）
    const addRow = body.createDiv('fl-cat-manage-add');
    const input = addRow.createEl('input', { cls: 'fl-input', attr: { placeholder: '新增三级名称，回车或点添加' } });
    const addBtn = addRow.createDiv('fl-btn fl-btn-primary fl-btn-mini');
    addBtn.setText('添加');
    const doAdd = () => {
      const name = input.value.trim();
      if (!name) {
        toast('请填写三级名称');
        return;
      }
      const lb = ctx.store.current();
      const dup = lb.categories.find((c) => c.level === 3 && c.parentId === l2.id && c.name === name);
      if (dup) {
        toast('该三级已存在');
        return;
      }
      ctx.store
        .mutate((d) => {
          const bucket = d.ledgers[d.currentLedger];
          bucket.categories.push({
            id: uid(),
            level: 3,
            parentId: l2.id,
            name,
            type,
            sortOrder: bucket.categories.length,
          });
        })
        .then(() => {
          const fresh = categoryTree(ctx.store.current().categories).find((n) => n.cat.id === l2.id);
          if (fresh) node2.children = fresh.children;
          input.value = '';
          renderList();
          ctx.rerender();
          input.focus();
        });
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd();
      }
    });

    const close = footer.createEl('button', { text: '关闭', cls: 'fl-btn' });
    close.addEventListener('click', () => modal.close());
  });
  modal.open();
}
