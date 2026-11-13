// 财务记账插件 · View 3 资产负债表（我欠的钱 / 别人欠我钱 / 大资产 / 储蓄计划）
import {
  Asset,
  Debt,
  DebtPaymentPlan,
  DebtRepaymentMode,
  Receivable,
  SavingsPlan,
  DEBT_MODE_LABEL,
  debtInterestPaid,
  debtOtherPaid,
  debtPlanPaid,
  debtPrincipalPaid,
  uid,
  todayStr,
} from '../models';
import { savingsCurrent, savingsProgress } from '../models';
import { formatMoney } from '../calc';
import { ViewCtx } from './base';
import {
  FlModal,
  field,
  textareaField,
  progressBar,
  confirmDialog,
  toast,
  emptyState,
} from '../components';

let completedDebtsExpanded = false;

function debtProgress(d: Debt): number {
  if (d.totalAmount <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - d.remaining / d.totalAmount));
}

function isDebtCompleted(d: Debt): boolean {
  return d.remaining <= 0.005;
}

function orderedDebts(debts: Debt[]): Debt[] {
  return debts.slice().sort((a, b) => {
    const progressDifference = debtProgress(b) - debtProgress(a);
    if (Math.abs(progressDifference) > 1e-9) return progressDifference;
    if (Math.abs(a.remaining - b.remaining) > 0.005) return a.remaining - b.remaining;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function renderBalanceView(host: HTMLElement, ctx: ViewCtx): void {
  const b = ctx.store.current();
  const sym = ctx.store.get().settings.currencySymbol;
  const stats = ctx.store.currentStats();

  // 净资产小结
  const nw = host.createDiv('fl-section');
  const nwHead = nw.createDiv('fl-section-head');
  nwHead.createDiv({ cls: 'fl-section-title', text: '净资产小结（仅本账本）' });
  const nwGrid = nw.createDiv('fl-ledger-summary');
  nwCell(nwGrid, '净资产', formatMoney(stats.netWorth, sym));
  nwCell(nwGrid, '资产合计', formatMoney(stats.assetsSum, sym));
  nwCell(nwGrid, '应收合计', formatMoney(stats.receivablesRemaining, sym));
  nwCell(nwGrid, '负债合计', formatMoney(stats.debtsRemaining, sym), 'expense');

  // 负债
  const debtSec = host.createDiv('fl-section fl-section--debt');
  const dHead = debtSec.createDiv('fl-section-head');
  dHead.createDiv({ cls: 'fl-section-title', text: '负债' });
  const dAdd = dHead.createDiv('fl-btn');
  dAdd.setText('+ 新建负债');
  dAdd.addEventListener('click', () => openDebtModal(ctx));
  if (b.debts.length === 0) {
    emptyState(debtSec, '暂无负债');
  } else {
    const activeDebts = orderedDebts(b.debts.filter((debt) => !isDebtCompleted(debt)));
    const completedDebts = orderedDebts(b.debts.filter(isDebtCompleted));
    activeDebts.forEach((debt) => renderDebtCard(debtSec, ctx, debt));
    if (completedDebts.length > 0) {
      const fold = debtSec.createEl('button', {
        cls: `fl-debt-completed-fold${completedDebtsExpanded ? ' is-expanded' : ''}`,
        attr: { type: 'button', 'aria-expanded': String(completedDebtsExpanded) },
      });
      fold.createSpan({ cls: 'fl-debt-completed-fold-icon', text: completedDebtsExpanded ? '−' : '+' });
      fold.createSpan({ text: `已还清 ${completedDebts.length} 笔` });
      fold.createSpan({ cls: 'fl-debt-completed-fold-hint', text: completedDebtsExpanded ? '收起' : '展开' });
      fold.addEventListener('click', () => {
        completedDebtsExpanded = !completedDebtsExpanded;
        ctx.rerender();
      });
      if (completedDebtsExpanded) {
        const completedList = debtSec.createDiv('fl-debt-completed-list');
        completedDebts.forEach((debt) => renderDebtCard(completedList, ctx, debt, true));
      }
    }
  }

  // 应收
  const recSec = host.createDiv('fl-section');
  const rHead = recSec.createDiv('fl-section-head');
  rHead.createDiv({ cls: 'fl-section-title', text: '应收' });
  const rAdd = rHead.createDiv('fl-btn');
  rAdd.setText('+ 新建应收');
  rAdd.addEventListener('click', () => openReceivableModal(ctx));
  if (b.receivables.length === 0) emptyState(recSec, '暂无应收');
  b.receivables.forEach((r) => renderReceivableCard(recSec, ctx, r));

  // 储蓄
  const svSec = host.createDiv('fl-section');
  const svHead = svSec.createDiv('fl-section-head');
  svHead.createDiv({ cls: 'fl-section-title', text: '储蓄' });
  const svAdd = svHead.createDiv('fl-btn');
  svAdd.setText('+ 新建计划');
  svAdd.addEventListener('click', () => openSavingsModal(ctx));
  if (b.savings.length === 0) emptyState(svSec, '暂无储蓄计划', '点击「+ 新建计划」设定目标与每期储蓄');
  b.savings.forEach((p) => renderSavingsCard(svSec, ctx, p));

  // 固定资产
  const assetSec = host.createDiv('fl-section');
  const aHead = assetSec.createDiv('fl-section-head');
  aHead.createDiv({ cls: 'fl-section-title', text: '固定资产' });
  const aAdd = aHead.createDiv('fl-btn');
  aAdd.setText('+ 新建资产');
  aAdd.addEventListener('click', () => openAssetModal(ctx));
  if (b.assets.length === 0) emptyState(assetSec, '暂无资产');
  b.assets.forEach((a) => renderAssetCard(assetSec, ctx, a));
}

function nwCell(parent: HTMLElement, k: string, v: string, cls?: 'expense'): void {
  const c = parent.createDiv('fl-summary-cell' + (cls ? ` is-${cls}` : ''));
  c.createDiv({ cls: 'k', text: k });
  c.createDiv({ cls: 'v' + (cls ? ' ' + cls : ''), text: v });
}

function cardHeader(
  card: HTMLElement,
  title: string,
  sub: string,
  onEdit: () => void,
  onDelete: () => void
): void {
  const row = card.createDiv('fl-card-row');
  const left = row.createDiv();
  left.createDiv({ cls: 'fl-card-title', text: title });
  if (sub) left.createDiv({ cls: 'fl-card-sub', text: sub });
  const acts = row.createDiv('fl-actions');
  const ed = acts.createDiv('fl-icon-btn fl-icon-btn--text');
  ed.setText('编辑');
  ed.addEventListener('click', onEdit);
  const dl = acts.createDiv('fl-icon-btn fl-icon-btn--text');
  dl.setText('删除');
  dl.addEventListener('click', onDelete);
}

function selectField(
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'fl-field';
  row.createEl('label', { text: label, cls: 'fl-field-label' });
  const select = row.createEl('select', { cls: 'fl-input' });
  options.forEach((option) => {
    const el = select.createEl('option', { text: option.label });
    el.value = option.value;
  });
  select.value = value;
  return { row, select };
}

function addMonthsClamped(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return '';
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const d = new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function generateDebtPlan(
  mode: DebtRepaymentMode,
  totalAmount: number,
  monthlyPayment: number,
  totalPeriods: number,
  firstRepaymentDate: string | null,
  finalRepaymentDate: string | null,
): DebtPaymentPlan[] {
  if (mode === 'custom' || monthlyPayment <= 0 || totalPeriods <= 0 || !firstRepaymentDate) return [];
  return Array.from({ length: totalPeriods }, (_, index) => ({
    id: uid(),
    dueDate:
      index === totalPeriods - 1 && finalRepaymentDate
        ? finalRepaymentDate
        : addMonthsClamped(firstRepaymentDate, index),
    amount:
      mode === 'interestOnly' && index === totalPeriods - 1
        ? monthlyPayment + totalAmount
        : monthlyPayment,
  }));
}

function recalculateDebtRemaining(d: Debt): void {
  let remaining = d.totalAmount;
  d.repayments
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((r) => {
      remaining = Math.max(0, remaining - (Number(r.principalAmount) || 0));
      r.remainingAfter = remaining;
    });
  d.remaining = remaining;
}

function nextPendingPlan(d: Debt): DebtPaymentPlan | undefined {
  return d.plannedPayments
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .find((plan) => debtPlanPaid(d, plan.id) + 0.005 < plan.amount);
}

function renderDebtCard(parent: HTMLElement, ctx: ViewCtx, d: Debt, completed = false): void {
  const sym = ctx.store.get().settings.currencySymbol;
  const card = parent.createDiv(`fl-card fl-card--debt${completed ? ' is-completed' : ''}`);
  cardHeader(
    card,
    d.name,
    `总额 ${formatMoney(d.totalAmount, sym)} · 剩余 ${formatMoney(d.remaining, sym)}`,
    () => openDebtModal(ctx, d),
    () =>
      confirmDialog(ctx.app, `删除负债「${d.name}」？`, () => {
        ctx.store
          .mutate((data) => {
            const lb = data.ledgers[data.currentLedger];
            lb.debts = lb.debts.filter((x) => x.id !== d.id);
          })
          .then(() => ctx.rerender());
      })
  );
  const pct = debtProgress(d) * 100;
  const progress = card.createDiv('fl-debt-progress');
  progress.appendChild(progressBar(pct));
  progress.createSpan({ cls: 'fl-debt-progress-pct', text: `${Math.round(Math.max(0, Math.min(100, pct)))}%` });
  const metrics = card.createDiv('fl-debt-metrics');
  metrics.createDiv({ cls: 'fl-debt-mode', text: DEBT_MODE_LABEL[d.repaymentMode] });
  metrics.createDiv({
    cls: 'fl-card-sub',
    text: `已还本金 ${formatMoney(debtPrincipalPaid(d), sym)} · 利息 ${formatMoney(debtInterestPaid(d), sym)}${debtOtherPaid(d) > 0 ? ` · 其他 ${formatMoney(debtOtherPaid(d), sym)}` : ''}`,
  });
  const nextPlan = nextPendingPlan(d);
  const planInfo = card.createDiv('fl-debt-next');
  if (nextPlan) {
    const paid = debtPlanPaid(d, nextPlan.id);
    planInfo.createSpan({ cls: 'fl-card-sub', text: `下期 ${nextPlan.dueDate}` });
    planInfo.createSpan({ cls: 'fl-debt-next-amount', text: formatMoney(nextPlan.amount, sym) });
    if (paid > 0) planInfo.createSpan({ cls: 'fl-card-sub', text: `已还 ${formatMoney(paid, sym)}` });
  } else {
    planInfo.createSpan({
      cls: 'fl-card-sub',
      text: d.plannedPayments.length > 0 ? '计划已全部覆盖' : '未设置还款计划',
    });
  }
  const foot = card.createDiv('fl-card-foot');
  const info = foot.createDiv('fl-card-sub');
  info.textContent = `借债 ${d.borrowDate || '未设'}${d.finalRepaymentDate ? ' · 最终还款 ' + d.finalRepaymentDate : ''}`;
  const actions = foot.createDiv('fl-actions');
  const planBtn = actions.createDiv('fl-btn fl-btn-mini');
  planBtn.setText('计划');
  planBtn.addEventListener('click', () => openDebtPlanModal(ctx, d));
  const repayBtn = actions.createDiv('fl-btn fl-btn-mini');
  repayBtn.setText('还款');
  repayBtn.addEventListener('click', () => openRepayModal(ctx, d));

  if (d.repayments.length > 0) {
    const hist = card.createDiv('fl-debt-history-preview');
    d.repayments
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)
      .forEach((r) => {
        const row = hist.createDiv('fl-debt-history-row');
        row.createSpan({ cls: 'fl-card-sub', text: r.date });
        row.createSpan({ cls: 'fl-debt-history-total', text: formatMoney(r.amount, sym) });
        row.createSpan({
          cls: 'fl-card-sub',
          text: `本金 ${formatMoney(r.principalAmount, sym)} · 利息 ${formatMoney(r.interestAmount, sym)}`,
        });
      });
  }
}

function renderReceivableCard(parent: HTMLElement, ctx: ViewCtx, r: Receivable): void {
  const sym = ctx.store.get().settings.currencySymbol;
  const card = parent.createDiv('fl-card');
  cardHeader(
    card,
    r.name,
    `总额 ${formatMoney(r.totalAmount, sym)} · 剩余 ${formatMoney(r.remaining, sym)}`,
    () => openReceivableModal(ctx, r),
    () =>
      confirmDialog(ctx.app, `删除应收「${r.name}」？`, () => {
        ctx.store
          .mutate((data) => {
            const lb = data.ledgers[data.currentLedger];
            lb.receivables = lb.receivables.filter((x) => x.id !== r.id);
          })
          .then(() => ctx.rerender());
      })
  );
  const pct = r.totalAmount > 0 ? (1 - r.remaining / r.totalAmount) * 100 : 0;
  card.appendChild(progressBar(pct));
  const foot = card.createDiv('fl-card-foot');
  const info = foot.createDiv('fl-card-sub');
  info.textContent = `到期 ${r.dueDate ?? '未设'}${r.note ? ' · ' + r.note : ''}`;
  const collBtn = foot.createDiv('fl-btn fl-btn-mini');
  collBtn.setText('收回');
  collBtn.addEventListener('click', () => openCollectModal(ctx, r));

  if (r.collections.length > 0) {
    const hist = card.createDiv('fl-card-sub fl-card-hist');
    hist.textContent =
      '收回记录：' +
      r.collections
        .slice()
        .reverse()
        .map((c) => `${c.date} ${formatMoney(c.amount, sym)}`)
        .join(' / ');
  }
}

function renderAssetCard(parent: HTMLElement, ctx: ViewCtx, a: Asset): void {
  const sym = ctx.store.get().settings.currencySymbol;
  const card = parent.createDiv('fl-card');
  cardHeader(
    card,
    a.name,
    `${formatMoney(a.value, sym)} · ${a.purchaseDate}${a.note ? ' · ' + a.note : ''}`,
    () => openAssetModal(ctx, a),
    () =>
      confirmDialog(ctx.app, `删除资产「${a.name}」？`, () => {
        ctx.store
          .mutate((data) => {
            const lb = data.ledgers[data.currentLedger];
            lb.assets = lb.assets.filter((x) => x.id !== a.id);
          })
          .then(() => ctx.rerender());
      })
  );
}

// ── 负债弹窗 ──
function openDebtModal(ctx: ViewCtx, edit?: Debt): void {
  const modal = new FlModal(ctx.app, edit ? '编辑负债' : '新建负债', (body, footer) => {
    const fName = field('名称');
    fName.input.value = edit?.name ?? '';
    body.appendChild(fName.row);
    const lbInfo = field('关联账本');
    lbInfo.input.value = ctx.store.current().name;
    lbInfo.input.readOnly = true;
    body.appendChild(lbInfo.row);
    const fTotal = field('负债总额（元）');
    fTotal.input.type = 'number';
    fTotal.input.step = '0.01';
    fTotal.input.value = edit ? String(edit.totalAmount) : '';
    body.appendChild(fTotal.row);
    const fMode = selectField(
      '还款方式',
      Object.entries(DEBT_MODE_LABEL).map(([value, label]) => ({ value, label })),
      edit?.repaymentMode ?? 'custom',
    );
    body.appendChild(fMode.row);
    const fPay = field('每期预计金额（元）');
    fPay.input.type = 'number';
    fPay.input.step = '0.01';
    fPay.input.value = edit ? String(edit.monthlyPayment) : '';
    body.appendChild(fPay.row);
    const fPeriod = field('还款周期（期）');
    fPeriod.input.type = 'number';
    fPeriod.input.value = edit ? String(edit.totalPeriods) : '';
    body.appendChild(fPeriod.row);
    const fBorrow = field('借债日期');
    fBorrow.input.type = 'date';
    fBorrow.input.value = edit?.borrowDate ?? todayStr();
    body.appendChild(fBorrow.row);
    const fFirst = field('首次还款日');
    fFirst.input.type = 'date';
    fFirst.input.value = edit?.firstRepaymentDate ?? '';
    body.appendChild(fFirst.row);
    const fFinal = field('最终还款日');
    fFinal.input.type = 'date';
    fFinal.input.value = edit?.finalRepaymentDate ?? '';
    body.appendChild(fFinal.row);

    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name = fName.input.value.trim();
      const total = parseFloat(fTotal.input.value);
      if (!name) return toast('请填写名称');
      if (isNaN(total) || total <= 0) return toast('请填写有效总额');
      const repaymentMode = fMode.select.value as DebtRepaymentMode;
      const monthlyPayment = num(fPay.input.value);
      const totalPeriods = Math.round(num(fPeriod.input.value));
      const firstRepaymentDate = fFirst.input.value || null;
      const finalRepaymentDate = fFinal.input.value || null;
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          if (edit) {
            const t = lb.debts.find((x) => x.id === edit.id);
            if (t) {
              t.name = name;
              t.totalAmount = total;
              t.repaymentMode = repaymentMode;
              t.monthlyPayment = monthlyPayment;
              t.totalPeriods = totalPeriods;
              t.borrowDate = fBorrow.input.value;
              t.firstRepaymentDate = firstRepaymentDate;
              t.finalRepaymentDate = finalRepaymentDate;
              if (t.plannedPayments.length === 0) {
                t.plannedPayments = generateDebtPlan(
                  repaymentMode,
                  total,
                  monthlyPayment,
                  totalPeriods,
                  firstRepaymentDate,
                  finalRepaymentDate,
                );
              }
              recalculateDebtRemaining(t);
            }
          } else {
            const plannedPayments = generateDebtPlan(
              repaymentMode,
              total,
              monthlyPayment,
              totalPeriods,
              firstRepaymentDate,
              finalRepaymentDate,
            );
            lb.debts.push({
              id: uid(),
              name,
              totalAmount: total,
              remaining: total,
              repaymentMode,
              monthlyPayment,
              totalPeriods,
              borrowDate: fBorrow.input.value,
              firstRepaymentDate,
              finalRepaymentDate,
              plannedPayments,
              repayments: [],
            });
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

function openDebtPlanModal(ctx: ViewCtx, d: Debt): void {
  const sym = ctx.store.get().settings.currencySymbol;
  let plans = d.plannedPayments.map((p) => ({ ...p }));
  const modal = new FlModal(ctx.app, `还款计划 · ${d.name}`, (body, footer) => {
    const tools = body.createDiv('fl-debt-plan-tools');
    const generate = tools.createEl('button', { cls: 'fl-btn', text: '按基础信息生成' });
    const add = tools.createEl('button', { cls: 'fl-btn', text: '+ 添加一期' });
    const list = body.createDiv('fl-debt-plan-list');

    const renderPlans = (): void => {
      list.empty();
      if (plans.length === 0) {
        list.createDiv({ cls: 'fl-empty fl-debt-plan-empty', text: '暂无还款计划' });
        return;
      }
      plans
        .slice()
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .forEach((plan) => {
          const row = list.createDiv('fl-debt-plan-row');
          const date = row.createEl('input', { cls: 'fl-input' });
          date.type = 'date';
          date.value = plan.dueDate;
          date.addEventListener('change', () => {
            plan.dueDate = date.value;
          });
          const amount = row.createEl('input', { cls: 'fl-input' });
          amount.type = 'number';
          amount.step = '0.01';
          amount.value = String(plan.amount || '');
          amount.addEventListener('input', () => {
            plan.amount = num(amount.value);
          });
          const paid = debtPlanPaid(d, plan.id);
          row.createSpan({
            cls: 'fl-debt-plan-paid' + (paid + 0.005 >= plan.amount && plan.amount > 0 ? ' is-paid' : ''),
            text: paid > 0 ? `已还 ${formatMoney(paid, sym)}` : '未还',
          });
          const remove = row.createEl('button', { cls: 'fl-icon-btn fl-icon-btn--text', text: '删除' });
          remove.addEventListener('click', () => {
            plans = plans.filter((p) => p.id !== plan.id);
            renderPlans();
          });
        });
    };

    generate.addEventListener('click', () => {
      const generated = generateDebtPlan(
        d.repaymentMode,
        d.totalAmount,
        d.monthlyPayment,
        d.totalPeriods,
        d.firstRepaymentDate,
        d.finalRepaymentDate,
      );
      if (generated.length === 0) {
        return toast('请先在负债编辑中完善还款方式、每期金额、期数和首次还款日');
      }
      plans = generated;
      renderPlans();
    });
    add.addEventListener('click', () => {
      const latest = plans
        .slice()
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
      plans.push({
        id: uid(),
        dueDate: latest?.dueDate ? addMonthsClamped(latest.dueDate, 1) : todayStr(),
        amount: d.monthlyPayment || 0,
      });
      renderPlans();
    });
    renderPlans();

    if (d.repayments.length > 0) {
      body.createDiv({ cls: 'fl-debt-modal-section-title', text: '实际还款' });
      const history = body.createDiv('fl-debt-modal-history');
      d.repayments
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach((record) => {
          const row = history.createDiv('fl-debt-modal-history-row');
          const summary = row.createDiv();
          summary.createDiv({ cls: 'fl-debt-history-total', text: `${record.date} · ${formatMoney(record.amount, sym)}` });
          summary.createDiv({
            cls: 'fl-card-sub',
            text: `本金 ${formatMoney(record.principalAmount, sym)} · 利息 ${formatMoney(record.interestAmount, sym)}${record.otherAmount > 0 ? ` · 其他 ${formatMoney(record.otherAmount, sym)}` : ''}`,
          });
          const undo = row.createEl('button', { cls: 'fl-icon-btn fl-icon-btn--text', text: '撤销' });
          undo.addEventListener('click', () => {
            confirmDialog(ctx.app, `撤销 ${record.date} 的还款记录？`, () => {
              void ctx.store
                .mutate((data) => {
                  const debt = data.ledgers[data.currentLedger].debts.find((item) => item.id === d.id);
                  if (!debt) return;
                  debt.repayments = debt.repayments.filter((item) => item.id !== record.id);
                  recalculateDebtRemaining(debt);
                })
                .then(() => {
                  modal.close();
                  ctx.rerender();
                });
            });
          });
        });
    }

    const save = footer.createEl('button', { text: '保存', cls: 'fl-btn fl-btn-primary' });
    save.addEventListener('click', () => {
      if (plans.some((plan) => !plan.dueDate || plan.amount <= 0)) return toast('请完善每期日期和金额');
      void ctx.store
        .mutate((data) => {
          const debt = data.ledgers[data.currentLedger].debts.find((item) => item.id === d.id);
          if (!debt) return;
          debt.plannedPayments = plans.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
          const validIds = new Set(debt.plannedPayments.map((plan) => plan.id));
          debt.repayments.forEach((record) => {
            if (record.planId && !validIds.has(record.planId)) record.planId = null;
          });
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

function openRepayModal(ctx: ViewCtx, d: Debt): void {
  const modal = new FlModal(ctx.app, `还款 · ${d.name}`, (body, footer) => {
    const fDate = field('还款日期');
    fDate.input.type = 'date';
    fDate.input.value = todayStr();
    body.appendChild(fDate.row);
    const pendingPlans = d.plannedPayments
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .filter((plan) => debtPlanPaid(d, plan.id) + 0.005 < plan.amount);
    const fPlan = selectField(
      '归属计划',
      [
        { value: '', label: '不归属具体期次' },
        ...pendingPlans.map((plan) => ({
          value: plan.id,
          label: `${plan.dueDate} · ${formatMoney(plan.amount, ctx.store.get().settings.currencySymbol)}`,
        })),
      ],
      pendingPlans[0]?.id ?? '',
    );
    body.appendChild(fPlan.row);
    if (pendingPlans[0]) fDate.input.value = pendingPlans[0].dueDate;
    fPlan.select.addEventListener('change', () => {
      const plan = pendingPlans.find((item) => item.id === fPlan.select.value);
      if (plan) fDate.input.value = plan.dueDate;
    });

    const fPrincipal = field('其中本金（元）');
    fPrincipal.input.type = 'number';
    fPrincipal.input.step = '0.01';
    body.appendChild(fPrincipal.row);
    const fInterest = field('其中利息（元）');
    fInterest.input.type = 'number';
    fInterest.input.step = '0.01';
    body.appendChild(fInterest.row);
    const fOther = field('费用 / 预存（元）');
    fOther.input.type = 'number';
    fOther.input.step = '0.01';
    body.appendChild(fOther.row);
    const total = body.createDiv('fl-debt-repay-total');
    const refreshTotal = (): void => {
      total.setText(`本次实付 ${formatMoney(num(fPrincipal.input.value) + num(fInterest.input.value) + num(fOther.input.value), ctx.store.get().settings.currencySymbol)}`);
    };
    [fPrincipal.input, fInterest.input, fOther.input].forEach((input) => input.addEventListener('input', refreshTotal));
    refreshTotal();
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const principalAmount = num(fPrincipal.input.value);
      const interestAmount = num(fInterest.input.value);
      const otherAmount = num(fOther.input.value);
      const amount = principalAmount + interestAmount + otherAmount;
      if (amount <= 0) return toast('请至少填写一项还款金额');
      if (principalAmount > d.remaining + 0.005) return toast('本金还款不能超过剩余负债');
      ctx.store
        .mutate((data) => {
          const lb = data.ledgers[data.currentLedger];
          const t = lb.debts.find((x) => x.id === d.id);
          if (t) {
            t.repayments.push({
              id: uid(),
              debtId: t.id,
              amount,
              date: fDate.input.value,
              principalAmount,
              interestAmount,
              otherAmount,
              planId: fPlan.select.value || null,
              remainingAfter: t.remaining,
            });
            recalculateDebtRemaining(t);
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

// ── 应收弹窗 ──
function openReceivableModal(ctx: ViewCtx, edit?: Receivable): void {
  const modal = new FlModal(ctx.app, edit ? '编辑应收' : '新建应收', (body, footer) => {
    const fName = field('对象名称（谁欠我钱）');
    fName.input.value = edit?.name ?? '';
    body.appendChild(fName.row);
    const fTotal = field('总额（元）');
    fTotal.input.type = 'number';
    fTotal.input.step = '0.01';
    fTotal.input.value = edit ? String(edit.totalAmount) : '';
    body.appendChild(fTotal.row);
    const fDue = field('到期日');
    fDue.input.type = 'date';
    fDue.input.value = edit?.dueDate ?? '';
    body.appendChild(fDue.row);
    const fNote = textareaField('备注');
    fNote.input.value = edit?.note ?? '';
    body.appendChild(fNote.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name = fName.input.value.trim();
      const total = parseFloat(fTotal.input.value);
      if (!name) return toast('请填写对象名称');
      if (isNaN(total) || total <= 0) return toast('请填写有效总额');
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          if (edit) {
            const t = lb.receivables.find((x) => x.id === edit.id);
            if (t) {
              t.name = name;
              t.totalAmount = total;
              t.remaining = Math.min(t.remaining, total);
              t.dueDate = fDue.input.value || null;
              t.note = fNote.input.value;
            }
          } else {
            lb.receivables.push({
              id: uid(),
              name,
              totalAmount: total,
              remaining: total,
              dueDate: fDue.input.value || null,
              collections: [],
              note: fNote.input.value,
            });
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

function openCollectModal(ctx: ViewCtx, r: Receivable): void {
  const modal = new FlModal(ctx.app, `收回 · ${r.name}`, (body, footer) => {
    const fAmt = field('收回金额（元）');
    fAmt.input.type = 'number';
    fAmt.input.step = '0.01';
    body.appendChild(fAmt.row);
    const fDate = field('收回日期');
    fDate.input.type = 'date';
    fDate.input.value = todayStr();
    body.appendChild(fDate.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const amount = parseFloat(fAmt.input.value);
      if (isNaN(amount) || amount <= 0) return toast('请填写有效金额');
      ctx.store
        .mutate((data) => {
          const lb = data.ledgers[data.currentLedger];
          const t = lb.receivables.find((x) => x.id === r.id);
          if (t) {
            t.remaining = Math.max(0, t.remaining - amount);
            t.collections.push({
              id: uid(),
              receivableId: t.id,
              amount,
              date: fDate.input.value,
              remainingAfter: t.remaining,
            });
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

// ── 资产弹窗 ──
function openAssetModal(ctx: ViewCtx, edit?: Asset): void {
  const modal = new FlModal(ctx.app, edit ? '编辑资产' : '新建资产', (body, footer) => {
    const fName = field('名称');
    fName.input.value = edit?.name ?? '';
    body.appendChild(fName.row);
    const fValue = field('价值（元）');
    fValue.input.type = 'number';
    fValue.input.step = '0.01';
    fValue.input.value = edit ? String(edit.value) : '';
    body.appendChild(fValue.row);
    const fDate = field('购入日期');
    fDate.input.type = 'date';
    fDate.input.value = edit?.purchaseDate ?? todayStr();
    body.appendChild(fDate.row);
    const fNote = textareaField('备注');
    fNote.input.value = edit?.note ?? '';
    body.appendChild(fNote.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name = fName.input.value.trim();
      const value = parseFloat(fValue.input.value);
      if (!name) return toast('请填写名称');
      if (isNaN(value) || value < 0) return toast('请填写有效价值');
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          if (edit) {
            const t = lb.assets.find((x) => x.id === edit.id);
            if (t) {
              t.name = name;
              t.value = value;
              t.purchaseDate = fDate.input.value;
              t.note = fNote.input.value;
            }
          } else {
            lb.assets.push({
              id: uid(),
              name,
              value,
              purchaseDate: fDate.input.value,
              note: fNote.input.value,
            });
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

// ── 储蓄计划卡片 ──
function renderSavingsCard(parent: HTMLElement, ctx: ViewCtx, p: SavingsPlan): void {
  const sym = ctx.store.get().settings.currencySymbol;
  const cur = savingsCurrent(p);
  const pct = savingsProgress(p);
  const card = parent.createDiv('fl-card');
  cardHeader(
    card,
    p.name,
    `已存 ${formatMoney(cur, sym)} / 目标 ${formatMoney(p.targetAmount, sym)}（${pct.toFixed(0)}%）`,
    () => openSavingsModal(ctx, p),
    () =>
      confirmDialog(ctx.app, `删除储蓄计划「${p.name}」？`, () => {
        ctx.store
          .mutate((data) => {
            const lb = data.ledgers[data.currentLedger];
            lb.savings = lb.savings.filter((x) => x.id !== p.id);
          })
          .then(() => ctx.rerender());
      })
  );
  card.appendChild(progressBar(pct));
  const foot = card.createDiv('fl-card-foot');
  const info = foot.createDiv('fl-card-sub');
  info.textContent = `每期存 ${formatMoney(p.periodAmount, sym)} · 期限 ${p.startDate || '—'} ~ ${p.endDate || '—'}`;
  const depBtn = foot.createDiv('fl-btn fl-btn-mini fl-btn-primary');
  depBtn.setText('储蓄');
  depBtn.addEventListener('click', () => openDepositModal(ctx, p));

  if (p.deposits.length > 0) {
    const hist = card.createDiv('fl-card-sub fl-card-hist');
    hist.textContent =
      '储蓄记录：' +
      p.deposits
        .slice()
        .reverse()
        .map((d) => `${d.date} ${formatMoney(d.amount, sym)}`)
        .join(' / ');
  }
}

// ── 储蓄计划弹窗 ──
function openSavingsModal(ctx: ViewCtx, edit?: SavingsPlan): void {
  const modal = new FlModal(ctx.app, edit ? '编辑储蓄计划' : '新建储蓄计划', (body, footer) => {
    const fName = field('计划名称');
    fName.input.value = edit?.name ?? '';
    body.appendChild(fName.row);
    const fTarget = field('目标总额（元）');
    fTarget.input.type = 'number';
    fTarget.input.step = '0.01';
    fTarget.input.value = edit ? String(edit.targetAmount) : '';
    body.appendChild(fTarget.row);
    const fStart = field('开始日期');
    fStart.input.type = 'date';
    fStart.input.value = edit?.startDate ?? todayStr();
    body.appendChild(fStart.row);
    const fEnd = field('截止日期');
    fEnd.input.type = 'date';
    fEnd.input.value = edit?.endDate ?? '';
    body.appendChild(fEnd.row);
    const fPeriod = field('每期储蓄金额（元/月）');
    fPeriod.input.type = 'number';
    fPeriod.input.step = '0.01';
    fPeriod.input.value = edit ? String(edit.periodAmount) : '';
    body.appendChild(fPeriod.row);

    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const name = fName.input.value.trim();
      const target = parseFloat(fTarget.input.value);
      if (!name) return toast('请填写计划名称');
      if (isNaN(target) || target <= 0) return toast('请填写有效目标总额');
      ctx.store
        .mutate((d) => {
          const lb = d.ledgers[d.currentLedger];
          if (edit) {
            const t = lb.savings.find((x) => x.id === edit.id);
            if (t) {
              t.name = name;
              t.targetAmount = target;
              t.startDate = fStart.input.value;
              t.endDate = fEnd.input.value;
              t.periodAmount = num(fPeriod.input.value);
            }
          } else {
            lb.savings.push({
              id: uid(),
              name,
              targetAmount: target,
              startDate: fStart.input.value,
              endDate: fEnd.input.value,
              periodAmount: num(fPeriod.input.value),
              deposits: [],
            });
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

// ── 储蓄存入弹窗 ──
function openDepositModal(ctx: ViewCtx, p: SavingsPlan): void {
  const modal = new FlModal(ctx.app, `储蓄 · ${p.name}`, (body, footer) => {
    const fAmt = field('存入金额（元）');
    fAmt.input.type = 'number';
    fAmt.input.step = '0.01';
    body.appendChild(fAmt.row);
    const fDate = field('存入日期');
    fDate.input.type = 'date';
    fDate.input.value = todayStr();
    body.appendChild(fDate.row);
    const ok = footer.createEl('button', { text: '确认', cls: 'fl-btn fl-btn-primary' });
    ok.addEventListener('click', () => {
      const amount = parseFloat(fAmt.input.value);
      if (isNaN(amount) || amount <= 0) return toast('请填写有效金额');
      ctx.store
        .mutate((data) => {
          const lb = data.ledgers[data.currentLedger];
          const t = lb.savings.find((x) => x.id === p.id);
          if (t) {
            t.deposits.push({ id: uid(), date: fDate.input.value, amount });
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

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
