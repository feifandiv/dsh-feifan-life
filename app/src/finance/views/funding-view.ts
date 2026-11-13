import {
  FundingPeriodType,
  FundingPlan,
  LedgerBucket,
  PlannedExpense,
  PlannedExpenseKind,
  PlannedExpenseStatus,
  PlannedIncome,
  PlannedIncomeStatus,
  uid,
} from '../models';
import { ExpenseFundingSource, fundingPlanTotals, fundingSources, orderedFundingExpenses } from '../funding';
import { confirmDialog, field, FlModal, toast } from '../components';
import { formatMoney } from '../calc';
import { ViewCtx } from './base';

const initialMonth = nextMonthKey();
let periodType: FundingPeriodType = 'month';
let monthKey = initialMonth;
let yearKey = String(new Date().getFullYear());
let initializedLedgerId = '';

function nextMonthKey(): string {
  const now = new Date();
  return monthKeyOf(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function activePeriodKey(): string {
  return periodType === 'month' ? monthKey : yearKey;
}

function periodLabel(): string {
  if (periodType === 'year') return `${yearKey} 年`;
  const [year, month] = monthKey.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

function shiftPeriod(delta: number): void {
  if (periodType === 'year') {
    yearKey = String(Number(yearKey) + delta);
    return;
  }
  const [year, month] = monthKey.split('-').map(Number);
  monthKey = monthKeyOf(new Date(year, month - 1 + delta, 1));
}

function planOf(bucket: LedgerBucket): FundingPlan | undefined {
  const key = activePeriodKey();
  return bucket.fundingPlans.find((plan) => plan.periodType === periodType && plan.periodKey === key);
}

function initializePeriod(bucket: LedgerBucket): void {
  if (initializedLedgerId === bucket.id) return;
  initializedLedgerId = bucket.id;

  const now = new Date();
  const currentMonth = monthKeyOf(now);
  const nextMonth = nextMonthKey();
  const monthlyPlans = bucket.fundingPlans
    .filter((plan) => plan.periodType === 'month' && /^\d{4}-\d{2}$/.test(plan.periodKey))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  const hasMonth = (key: string) => monthlyPlans.some((plan) => plan.periodKey === key);
  monthKey = hasMonth(currentMonth)
    ? currentMonth
    : hasMonth(nextMonth)
      ? nextMonth
      : monthlyPlans[0]?.periodKey ?? nextMonth;

  const currentYear = String(now.getFullYear());
  const annualPlans = bucket.fundingPlans
    .filter((plan) => plan.periodType === 'year' && /^\d{4}$/.test(plan.periodKey))
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  yearKey = annualPlans.some((plan) => plan.periodKey === currentYear)
    ? currentYear
    : annualPlans[0]?.periodKey ?? currentYear;
}

function ensurePlan(bucket: LedgerBucket): FundingPlan {
  const existing = planOf(bucket);
  if (existing) return existing;
  const now = Date.now();
  const plan: FundingPlan = {
    id: uid(),
    periodType,
    periodKey: activePeriodKey(),
    incomes: [],
    expenses: [],
    createdAt: now,
    updatedAt: now,
  };
  bucket.fundingPlans.push(plan);
  return plan;
}

function defaultPlanDate(): string {
  if (periodType === 'year') return `${yearKey}-01-01`;
  return `${monthKey}-15`;
}

function num(value: string): number {
  return Math.max(0, Number.parseFloat(value) || 0);
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function shortDate(value: string): string {
  if (!value) return '日期未定';
  return periodType === 'year' ? value.slice(5).replace('-', '/') : value.slice(8) + ' 日';
}

export function renderFundingView(host: HTMLElement, ctx: ViewCtx): void {
  const bucket = ctx.store.current();
  initializePeriod(bucket);
  const plan = planOf(bucket);
  const totals = fundingPlanTotals(plan);
  const symbol = ctx.store.get().settings.currencySymbol;
  const board = host.createDiv('fl-fp');

  renderHeader(board, ctx);
  renderSummary(board, totals, symbol);
  renderPool(board, totals, symbol);

  const workspace = board.createDiv('fl-fp-workspace');
  renderIncomePanel(workspace, ctx, plan, symbol);
  renderExpensePanel(workspace, ctx, plan, symbol);
}

function renderHeader(host: HTMLElement, ctx: ViewCtx): void {
  const header = host.createDiv('fl-fp-header');
  const identity = header.createDiv();
  identity.createDiv({ cls: 'fl-fp-title', text: '资金规划' });
  identity.createDiv({ cls: 'fl-fp-subtitle', text: ctx.store.current().name });

  const nav = header.createDiv('fl-fp-nav');
  const prev = nav.createEl('button', { cls: 'fl-icon-btn fl-fp-nav-btn', text: '‹', attr: { 'aria-label': '上一个周期' } });
  prev.addEventListener('click', () => {
    shiftPeriod(-1);
    ctx.rerender();
  });
  nav.createDiv({ cls: 'fl-fp-period', text: periodLabel() });
  const next = nav.createEl('button', { cls: 'fl-icon-btn fl-fp-nav-btn', text: '›', attr: { 'aria-label': '下一个周期' } });
  next.addEventListener('click', () => {
    shiftPeriod(1);
    ctx.rerender();
  });

  const modes = header.createDiv('fl-cat-seg fl-fp-modes');
  const month = modes.createEl('button', { text: '月度' });
  const year = modes.createEl('button', { text: '年度' });
  month.classList.toggle('is-active', periodType === 'month');
  year.classList.toggle('is-active', periodType === 'year');
  month.addEventListener('click', () => {
    periodType = 'month';
    ctx.rerender();
  });
  year.addEventListener('click', () => {
    periodType = 'year';
    ctx.rerender();
  });
}

function renderSummary(
  host: HTMLElement,
  totals: ReturnType<typeof fundingPlanTotals>,
  symbol: string,
): void {
  const summary = host.createDiv('fl-fp-summary');
  metric(summary, '确定收入', formatMoney(totals.confirmed, symbol), 'is-confirmed');
  metric(summary, '预估收入', formatMoney(totals.estimated, symbol), 'is-estimated');
  metric(summary, '已安排支出', formatMoney(totals.allocated, symbol), 'is-expense');
  metric(summary, '已实际支出', formatMoney(totals.actualSpent, symbol), 'is-actual');
  metric(
    summary,
    totals.over > 0 ? '超额安排' : '尚可安排',
    formatMoney(totals.over > 0 ? totals.over : totals.available, symbol),
    totals.over > 0 ? 'is-expense' : '',
  );
}

function metric(host: HTMLElement, label: string, value: string, cls: string): void {
  const item = host.createDiv('fl-fp-metric');
  item.createDiv({ cls: 'fl-fp-metric-label', text: label });
  item.createDiv({ cls: `fl-fp-metric-value ${cls}`, text: value });
}

function renderPool(
  host: HTMLElement,
  totals: ReturnType<typeof fundingPlanTotals>,
  symbol: string,
): void {
  const section = host.createDiv('fl-fp-pool');
  const head = section.createDiv('fl-fp-pool-head');
  const title = head.createDiv();
  title.createDiv({ cls: 'fl-fp-section-title', text: '收入与资金池' });
  title.createDiv({ cls: 'fl-fp-section-sub', text: `${periodLabel()}资金预演` });
  const total = head.createDiv('fl-fp-total');
  total.createDiv({ cls: 'fl-fp-total-value', text: formatMoney(totals.incomeTotal, symbol) });
  total.createDiv({ cls: 'fl-fp-section-sub', text: '预计可支配总额' });

  const source = section.createDiv('fl-fp-pool-block');
  const sourceCaption = source.createDiv('fl-fp-pool-caption');
  sourceCaption.createSpan({ text: '收入结构' });
  sourceCaption.createSpan({
    text: totals.incomeTotal > 0
      ? `${percent(totals.confirmed, totals.incomeTotal).toFixed(0)}% 确定 · ${percent(totals.estimated, totals.incomeTotal).toFixed(0)}% 预估`
      : '暂无收入',
  });
  const sourceTrack = source.createDiv('fl-fp-track fl-fp-track--source');
  segment(sourceTrack, totals.confirmed, totals.incomeTotal, 'is-confirmed');
  segment(sourceTrack, totals.estimated, totals.incomeTotal, 'is-estimated');

  const remaining = section.createDiv('fl-fp-pool-block');
  const remainingCaption = remaining.createDiv('fl-fp-pool-caption');
  remainingCaption.createSpan({ text: '分配后资金池' });
  remainingCaption.createSpan({
    cls: totals.over > 0 ? 'is-risk' : '',
    text: totals.over > 0 ? `超额 ${formatMoney(totals.over, symbol)}` : `剩余 ${formatMoney(totals.available, symbol)}`,
  });
  const remainingTrack = remaining.createDiv('fl-fp-track fl-fp-track--remaining');
  const remainingScale = totals.over > 0 ? totals.allocated : totals.incomeTotal;
  segment(remainingTrack, totals.confirmedLeft, remainingScale, 'is-confirmed');
  segment(remainingTrack, totals.estimatedLeft, remainingScale, 'is-estimated');
  if (totals.over > 0) segment(remainingTrack, totals.over, remainingScale, 'is-over');

  const legend = remaining.createDiv('fl-fp-legend');
  legendItem(legend, 'is-confirmed', `确定余额 ${formatMoney(totals.confirmedLeft, symbol)}`);
  legendItem(legend, 'is-estimated', `预估余额 ${formatMoney(totals.estimatedLeft, symbol)}`);
  legendItem(legend, 'is-used', `已安排 ${formatMoney(totals.allocated, symbol)}`);
  if (totals.over > 0) legendItem(legend, 'is-over', `超额 ${formatMoney(totals.over, symbol)}`);

  const coverage = section.createDiv(`fl-fp-coverage${totals.mandatoryGap > 0 ? ' is-risk' : ''}`);
  const coverageMain = coverage.createDiv('fl-fp-coverage-main');
  coverageMain.createSpan({ cls: 'fl-fp-coverage-dot' });
  const copy = coverageMain.createDiv();
  copy.createDiv({
    cls: 'fl-fp-coverage-title',
    text: totals.mandatoryGap > 0 ? '必要支出需要依赖预估收入' : '必要支出已被确定收入覆盖',
  });
  copy.createDiv({
    cls: 'fl-fp-section-sub',
    text: `必要 ${formatMoney(totals.mandatory, symbol)} · 弹性 ${formatMoney(totals.flexible, symbol)}`,
  });
  coverage.createDiv({
    cls: 'fl-fp-coverage-value',
    text: totals.mandatoryGap > 0
      ? `缺口 ${formatMoney(totals.mandatoryGap, symbol)}`
      : `安全余量 ${formatMoney(totals.mandatorySafety, symbol)}`,
  });
}

function segment(host: HTMLElement, value: number, total: number, cls: string): void {
  const el = host.createDiv(`fl-fp-segment ${cls}`);
  el.style.width = `${percent(value, total)}%`;
}

function legendItem(host: HTMLElement, cls: string, text: string): void {
  const item = host.createDiv('fl-fp-legend-item');
  item.createSpan({ cls: `fl-fp-swatch ${cls}` });
  item.createSpan({ text });
}

function renderIncomePanel(host: HTMLElement, ctx: ViewCtx, plan: FundingPlan | undefined, symbol: string): void {
  const panel = host.createDiv('fl-fp-panel');
  const header = panel.createDiv('fl-fp-panel-head');
  header.createDiv({ cls: 'fl-fp-panel-title', text: `收入来源 ${(plan?.incomes.length ?? 0)} 笔` });
  const add = header.createEl('button', { cls: 'fl-btn fl-btn-primary', text: '＋ 收入' });
  add.addEventListener('click', () => openIncomeModal(ctx));

  const confirmed = (plan?.incomes ?? []).filter((item) => item.status === 'confirmed');
  const estimated = (plan?.incomes ?? []).filter((item) => item.status === 'estimated');
  renderIncomeGroup(panel, ctx, '确定收入', confirmed, 'confirmed', symbol);
  renderIncomeGroup(panel, ctx, '预估收入', estimated, 'estimated', symbol);
}

function renderIncomeGroup(
  host: HTMLElement,
  ctx: ViewCtx,
  label: string,
  items: PlannedIncome[],
  tone: string,
  symbol: string,
): void {
  const group = host.createDiv('fl-fp-group');
  const heading = group.createDiv('fl-fp-group-head');
  heading.createSpan({ text: label });
  heading.createSpan({ text: formatMoney(items.reduce((sum, item) => sum + item.amount, 0), symbol) });
  if (items.length === 0) {
    group.createDiv({ cls: 'fl-fp-empty', text: '暂无项目' });
    return;
  }
  items
    .slice()
    .sort((a, b) => b.amount - a.amount || a.createdAt - b.createdAt)
    .forEach((item) => {
      const row = group.createDiv('fl-fp-entry');
      const main = row.createDiv('fl-fp-entry-main');
      main.createDiv({ cls: 'fl-fp-entry-name', text: item.name });
      main.createDiv({
        cls: 'fl-fp-entry-sub',
        text: `${shortDate(item.expectedDate)}${item.note ? ` · ${item.note}` : ''}`,
      });
      const value = row.createDiv('fl-fp-entry-value');
      value.createDiv({ cls: `fl-fp-entry-amount is-${tone}`, text: formatMoney(item.amount, symbol) });
      value.createSpan({ cls: `fl-fp-tag is-${tone}`, text: tone === 'confirmed' ? '确定' : '预估' });
      renderActions(row, () => openIncomeModal(ctx, item), () => deleteIncome(ctx, item));
    });
}

function renderExpensePanel(host: HTMLElement, ctx: ViewCtx, plan: FundingPlan | undefined, symbol: string): void {
  const panel = host.createDiv('fl-fp-panel');
  const header = panel.createDiv('fl-fp-panel-head');
  header.createDiv({ cls: 'fl-fp-panel-title', text: `支出安排 ${(plan?.expenses.length ?? 0)} 项` });
  const add = header.createEl('button', { cls: 'fl-btn fl-btn-primary', text: '＋ 支出' });
  add.addEventListener('click', () => openExpenseModal(ctx));

  const ordered = orderedFundingExpenses(plan);
  const sources = fundingSources(plan);
  const active = ordered.filter((item) => item.executionStatus !== 'completed');
  const completed = ordered.filter((item) => item.executionStatus === 'completed');
  renderExpenseGroup(panel, ctx, '必要支出', active.filter((item) => item.kind === 'mandatory'), sources, symbol);
  renderExpenseGroup(panel, ctx, '弹性支出', active.filter((item) => item.kind === 'flexible'), sources, symbol);
  if (completed.length > 0) renderExpenseGroup(panel, ctx, '已完成支出', completed, sources, symbol, true);
}

function renderExpenseGroup(
  host: HTMLElement,
  ctx: ViewCtx,
  label: string,
  items: PlannedExpense[],
  sources: Map<string, ExpenseFundingSource>,
  symbol: string,
  completedGroup = false,
): void {
  const group = host.createDiv(`fl-fp-group${completedGroup ? ' is-completed' : ''}`);
  const heading = group.createDiv('fl-fp-group-head');
  heading.createSpan({ text: label });
  const planned = items.reduce((sum, item) => sum + item.amount, 0);
  const actual = items.reduce((sum, item) => sum + item.actualAmount, 0);
  heading.createSpan({ text: `计划 ${formatMoney(planned, symbol)} · 已支 ${formatMoney(actual, symbol)}` });
  if (items.length === 0) {
    group.createDiv({ cls: 'fl-fp-empty', text: '暂无项目' });
    return;
  }
  items.forEach((item) => {
    const tone = item.kind === 'mandatory' ? 'mandatory' : 'flexible';
    const row = group.createDiv(`fl-fp-entry${item.executionStatus === 'completed' ? ' is-completed' : ''}`);
    const main = row.createDiv('fl-fp-entry-main');
    main.createDiv({ cls: 'fl-fp-entry-name', text: item.name });
    main.createDiv({ cls: 'fl-fp-entry-sub', text: `${shortDate(item.plannedDate)}${item.note ? ` · ${item.note}` : ''}` });
    main.createDiv({ cls: 'fl-fp-funding-source', text: sourceLabel(sources.get(item.id), symbol) });
    const value = row.createDiv('fl-fp-entry-value');
    value.createDiv({ cls: `fl-fp-entry-amount is-${tone}`, text: formatMoney(item.amount, symbol) });
    value.createSpan({ cls: `fl-fp-tag is-${tone}`, text: tone === 'mandatory' ? '必付' : '可选' });
    value.createDiv({
      cls: `fl-fp-entry-actual is-${item.executionStatus}`,
      text: actualExpenseLabel(item, symbol),
    });
    renderActions(
      row,
      () => openExpenseModal(ctx, item),
      () => deleteExpense(ctx, item),
      () => openActualExpenseModal(ctx, item),
      item.executionStatus === 'pending' ? '记实际' : '改实际',
    );
  });
}

function actualExpenseLabel(item: PlannedExpense, symbol: string): string {
  if (item.executionStatus === 'pending') return '待支出';
  const status = item.executionStatus === 'completed' ? '已完成' : '部分支出';
  const difference = item.actualAmount - item.amount;
  const variance =
    item.executionStatus !== 'completed' || Math.abs(difference) < 0.005
      ? ''
      : difference > 0
        ? ` · 超出 ${formatMoney(difference, symbol)}`
        : ` · 节余 ${formatMoney(-difference, symbol)}`;
  return `${status} ${formatMoney(item.actualAmount, symbol)}${variance}`;
}

function sourceLabel(source: ExpenseFundingSource | undefined, symbol: string): string {
  if (!source) return '';
  const parts: string[] = [];
  if (source.confirmed > 0) parts.push(`确定资金 ${formatMoney(source.confirmed, symbol)}`);
  if (source.estimated > 0) parts.push(`预估资金 ${formatMoney(source.estimated, symbol)}`);
  if (source.over > 0) parts.push(`未覆盖 ${formatMoney(source.over, symbol)}`);
  return parts.join(' + ');
}

function renderActions(
  host: HTMLElement,
  edit: () => void,
  remove: () => void,
  actual?: () => void,
  actualLabel = '记实际',
): void {
  const actions = host.createDiv('fl-fp-entry-actions');
  if (actual) {
    const actualBtn = actions.createEl('button', { cls: 'fl-icon-btn fl-icon-btn--text fl-fp-actual-btn', text: actualLabel });
    actualBtn.addEventListener('click', actual);
  }
  const editBtn = actions.createEl('button', { cls: 'fl-icon-btn fl-icon-btn--text', text: '编辑' });
  editBtn.addEventListener('click', edit);
  const deleteBtn = actions.createEl('button', { cls: 'fl-icon-btn fl-icon-btn--text', text: '删除' });
  deleteBtn.addEventListener('click', remove);
}

function selectField(
  label: string,
  options: { value: string; label: string }[],
  value: string,
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'fl-field';
  row.createEl('label', { text: label, cls: 'fl-field-label' });
  const select = row.createEl('select', { cls: 'fl-input' });
  options.forEach((option) => select.createEl('option', { value: option.value, text: option.label }));
  select.value = value;
  return { row, select };
}

function openIncomeModal(ctx: ViewCtx, edit?: PlannedIncome): void {
  const modal = new FlModal(ctx.app, edit ? '编辑规划收入' : '新增规划收入', (body, footer) => {
    const name = field('收入来源');
    name.input.value = edit?.name ?? '';
    body.appendChild(name.row);
    const amount = field('预计金额');
    amount.input.type = 'number';
    amount.input.step = '0.01';
    amount.input.value = edit ? String(edit.amount) : '';
    body.appendChild(amount.row);
    const status = selectField(
      '确定性',
      [
        { value: 'confirmed', label: '确定收入' },
        { value: 'estimated', label: '预估收入' },
      ],
      edit?.status ?? 'confirmed',
    );
    body.appendChild(status.row);
    const date = field('预计到账日期');
    date.input.type = 'date';
    date.input.value = edit?.expectedDate ?? defaultPlanDate();
    body.appendChild(date.row);
    const note = field('来源说明');
    note.input.value = edit?.note ?? '';
    body.appendChild(note.row);

    const save = footer.createEl('button', { cls: 'fl-btn fl-btn-primary', text: '保存' });
    save.addEventListener('click', () => {
      const incomeName = name.input.value.trim();
      const incomeAmount = num(amount.input.value);
      if (!incomeName) return toast('请填写收入来源');
      if (incomeAmount <= 0) return toast('请填写有效金额');
      void ctx.store.mutate((data) => {
        const plan = ensurePlan(data.ledgers[data.currentLedger]);
        if (edit) {
          const target = plan.incomes.find((item) => item.id === edit.id);
          if (target) Object.assign(target, {
            name: incomeName,
            amount: incomeAmount,
            status: status.select.value as PlannedIncomeStatus,
            expectedDate: date.input.value,
            note: note.input.value.trim(),
          });
        } else {
          plan.incomes.push({
            id: uid(),
            name: incomeName,
            amount: incomeAmount,
            status: status.select.value as PlannedIncomeStatus,
            expectedDate: date.input.value,
            note: note.input.value.trim(),
            createdAt: Date.now(),
          });
        }
        plan.updatedAt = Date.now();
      }).then(() => modal.close());
    });
    const cancel = footer.createEl('button', { cls: 'fl-btn', text: '取消' });
    cancel.addEventListener('click', () => modal.close());
    name.input.focus();
  });
  modal.open();
}

function openExpenseModal(ctx: ViewCtx, edit?: PlannedExpense): void {
  const modal = new FlModal(ctx.app, edit ? '编辑支出安排' : '新增支出安排', (body, footer) => {
    const name = field('支出用途');
    name.input.value = edit?.name ?? '';
    body.appendChild(name.row);
    const amount = field('分配金额');
    amount.input.type = 'number';
    amount.input.step = '0.01';
    amount.input.value = edit ? String(edit.amount) : '';
    body.appendChild(amount.row);
    const kind = selectField(
      '支出属性',
      [
        { value: 'mandatory', label: '必要支出' },
        { value: 'flexible', label: '弹性支出' },
      ],
      edit?.kind ?? 'mandatory',
    );
    body.appendChild(kind.row);
    const date = field('计划日期');
    date.input.type = 'date';
    date.input.value = edit?.plannedDate ?? defaultPlanDate();
    body.appendChild(date.row);
    const note = field('备注');
    note.input.value = edit?.note ?? '';
    body.appendChild(note.row);

    const save = footer.createEl('button', { cls: 'fl-btn fl-btn-primary', text: '保存' });
    save.addEventListener('click', () => {
      const expenseName = name.input.value.trim();
      const expenseAmount = num(amount.input.value);
      if (!expenseName) return toast('请填写支出用途');
      if (expenseAmount <= 0) return toast('请填写有效金额');
      void ctx.store.mutate((data) => {
        const plan = ensurePlan(data.ledgers[data.currentLedger]);
        if (edit) {
          const target = plan.expenses.find((item) => item.id === edit.id);
          if (target) Object.assign(target, {
            name: expenseName,
            amount: expenseAmount,
            kind: kind.select.value as PlannedExpenseKind,
            plannedDate: date.input.value,
            note: note.input.value.trim(),
          });
        } else {
          plan.expenses.push({
            id: uid(),
            name: expenseName,
            amount: expenseAmount,
            kind: kind.select.value as PlannedExpenseKind,
            plannedDate: date.input.value,
            note: note.input.value.trim(),
            executionStatus: 'pending',
            actualAmount: 0,
            actualDate: '',
            createdAt: Date.now(),
          });
        }
        plan.updatedAt = Date.now();
      }).then(() => modal.close());
    });
    const cancel = footer.createEl('button', { cls: 'fl-btn', text: '取消' });
    cancel.addEventListener('click', () => modal.close());
    name.input.focus();
  });
  modal.open();
}

function openActualExpenseModal(ctx: ViewCtx, expense: PlannedExpense): void {
  const modal = new FlModal(ctx.app, '记录实际支出', (body, footer) => {
    const notice = body.createDiv('fl-fp-actual-notice');
    notice.setText('只更新这笔规划的执行情况，不会新增账单或负债还款，避免重复记账。');

    const status = selectField(
      '执行状态',
      [
        { value: 'pending', label: '待支出（清除实际金额）' },
        { value: 'partial', label: '部分支出' },
        { value: 'completed', label: '已完成' },
      ],
      expense.executionStatus === 'pending' ? 'completed' : expense.executionStatus,
    );
    body.appendChild(status.row);

    const amount = field('实际支出金额');
    amount.input.type = 'number';
    amount.input.step = '0.01';
    amount.input.value = String(expense.actualAmount > 0 ? expense.actualAmount : expense.amount);
    body.appendChild(amount.row);

    const date = field('实际支出日期');
    date.input.type = 'date';
    date.input.value = expense.actualDate || new Date().toISOString().slice(0, 10);
    body.appendChild(date.row);

    status.select.addEventListener('change', () => {
      const pending = status.select.value === 'pending';
      amount.input.disabled = pending;
      date.input.disabled = pending;
    });

    const save = footer.createEl('button', { cls: 'fl-btn fl-btn-primary', text: '保存' });
    save.addEventListener('click', () => {
      const executionStatus = status.select.value as PlannedExpenseStatus;
      const actualAmount = executionStatus === 'pending' ? 0 : num(amount.input.value);
      if (executionStatus !== 'pending' && actualAmount <= 0) return toast('请填写有效的实际支出金额');
      void ctx.store.mutate((data) => {
        const plan = planOf(data.ledgers[data.currentLedger]);
        const target = plan?.expenses.find((item) => item.id === expense.id);
        if (!target || !plan) return;
        target.executionStatus = executionStatus;
        target.actualAmount = actualAmount;
        target.actualDate = executionStatus === 'pending' ? '' : date.input.value;
        plan.updatedAt = Date.now();
      }).then(() => modal.close());
    });
    const cancel = footer.createEl('button', { cls: 'fl-btn', text: '取消' });
    cancel.addEventListener('click', () => modal.close());
  });
  modal.open();
}

function deleteIncome(ctx: ViewCtx, income: PlannedIncome): void {
  confirmDialog(ctx.app, `删除规划收入「${income.name}」？`, () => {
    void ctx.store.mutate((data) => {
      const plan = planOf(data.ledgers[data.currentLedger]);
      if (!plan) return;
      plan.incomes = plan.incomes.filter((item) => item.id !== income.id);
      plan.updatedAt = Date.now();
    });
  });
}

function deleteExpense(ctx: ViewCtx, expense: PlannedExpense): void {
  confirmDialog(ctx.app, `删除支出安排「${expense.name}」？`, () => {
    void ctx.store.mutate((data) => {
      const plan = planOf(data.ledgers[data.currentLedger]);
      if (!plan) return;
      plan.expenses = plan.expenses.filter((item) => item.id !== expense.id);
      plan.updatedAt = Date.now();
    });
  });
}
