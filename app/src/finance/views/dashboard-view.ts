// 财务记账插件 · View 4 数据看板（手写 SVG，零依赖）
import { LedgerBucket, Transaction, TxnType } from '../models';
import { recentMonths, sumByCategory, sumByCategory2, formatMoney, computeLedgerStats } from '../calc';
import { ViewCtx } from './base';
import { renderStatCards } from './util';

const PALETTE = [
  'var(--fl-accent)',
  'var(--fl-income)',
  'var(--fl-blue)',
  'var(--fl-warn)',
  'var(--fl-series-5)',
  'var(--fl-series-6)',
  'var(--fl-series-7)',
  'var(--fl-series-8)',
  'var(--fl-series-9)',
  'var(--fl-series-10)',
];

type CompositionMode = 'month' | 'year' | 'all';
const compositionNow = new Date();
let compositionRange: { mode: CompositionMode; year: number; month: number } = {
  mode: 'month',
  year: compositionNow.getFullYear(),
  month: compositionNow.getMonth(),
};

export function renderDashboardView(host: HTMLElement, ctx: ViewCtx): void {
  const now = new Date();
  compositionRange = { mode: 'month', year: now.getFullYear(), month: now.getMonth() };
  renderStatCards(host, ctx.store);
  const b = ctx.store.current();
  const sym = ctx.store.get().settings.currencySymbol;

  const charts = host.createDiv('fl-charts');

  const trendCard = charts.createDiv('fl-chart-card wide');
  trendCard.createDiv({ cls: 'fl-chart-title', text: '近一年收支趋势' });
  trendCard.appendChild(monthTrendSvg(b));

  const dailyTrendCard = charts.createDiv('fl-chart-card wide');
  dailyTrendCard.createDiv({ cls: 'fl-chart-title', text: '盈亏曲线' });
  dailyTrendCard.appendChild(dailyTrendPanel(b, sym));

  const compositionPainters: Array<() => void> = [];
  renderCompositionFilter(charts, b, () => compositionPainters.forEach((paint) => paint()));
  compositionPainters.push(renderCatCard(charts, b, sym, '收入', '收入构成'));
  compositionPainters.push(renderCatCard(charts, b, sym, '支出', '支出构成'));

  const budCard = charts.createDiv('fl-chart-card wide');
  budCard.createDiv({ cls: 'fl-chart-title', text: '本月预算额度' });
  budCard.appendChild(budgetPanel(b, sym));

  renderCompareCard(charts, b, sym);
}

function transactionDate(transaction: Transaction): Date | null {
  const date = new Date(`${transaction.date}T00:00:00`);
  return isNaN(date.getTime()) ? null : date;
}

function compositionTransactions(b: LedgerBucket): Transaction[] {
  if (compositionRange.mode === 'all') return b.transactions;
  return b.transactions.filter((transaction) => {
    const date = transactionDate(transaction);
    if (!date || date.getFullYear() !== compositionRange.year) return false;
    return compositionRange.mode === 'year' || date.getMonth() === compositionRange.month;
  });
}

function compositionLabel(): string {
  if (compositionRange.mode === 'all') return '全部';
  if (compositionRange.mode === 'year') return `${compositionRange.year}年`;
  return `${compositionRange.year}年${compositionRange.month + 1}月`;
}

function renderCompositionFilter(host: HTMLElement, b: LedgerBucket, repaint: () => void): void {
  const toolbar = host.createDiv('fl-composition-filter');
  toolbar.createDiv({ cls: 'fl-composition-filter-label', text: '构成范围' });
  const controls = toolbar.createDiv('fl-composition-periods');
  const modes = toolbar.createDiv('fl-composition-modes');

  const monthKeys = new Set<string>();
  const years = new Set<number>([new Date().getFullYear()]);
  b.transactions.forEach((transaction) => {
    const date = transactionDate(transaction);
    if (!date) return;
    years.add(date.getFullYear());
    monthKeys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  });
  monthKeys.add(`${compositionRange.year}-${String(compositionRange.month + 1).padStart(2, '0')}`);
  years.add(compositionRange.year);

  const monthSelect = controls.createEl('select', {
    cls: 'fl-input fl-composition-period',
    attr: { 'aria-label': '选择构成月份' },
  });
  [...monthKeys]
    .sort((a, c) => c.localeCompare(a))
    .forEach((key) => {
      const [year, month] = key.split('-').map(Number);
      monthSelect.createEl('option', { value: key, text: `${year}年${month}月` });
    });
  monthSelect.value = `${compositionRange.year}-${String(compositionRange.month + 1).padStart(2, '0')}`;

  const yearSelect = controls.createEl('select', {
    cls: 'fl-input fl-composition-period',
    attr: { 'aria-label': '选择构成年份' },
  });
  [...years]
    .sort((a, c) => c - a)
    .forEach((year) => yearSelect.createEl('option', { value: String(year), text: `${year}年` }));
  yearSelect.value = String(compositionRange.year);

  const modeButtons = (['month', 'year', 'all'] as CompositionMode[]).map((mode) => {
    const labels: Record<CompositionMode, string> = { month: '月份', year: '年份', all: '全部' };
    const button = modes.createEl('button', { text: labels[mode], attr: { type: 'button' } });
    button.addEventListener('click', () => {
      compositionRange.mode = mode;
      sync();
      repaint();
    });
    return { mode, button };
  });

  monthSelect.addEventListener('change', () => {
    const [year, month] = monthSelect.value.split('-').map(Number);
    compositionRange.year = year;
    compositionRange.month = month - 1;
    repaint();
  });
  yearSelect.addEventListener('change', () => {
    compositionRange.year = Number(yearSelect.value);
    repaint();
  });

  function sync(): void {
    monthSelect.value = `${compositionRange.year}-${String(compositionRange.month + 1).padStart(2, '0')}`;
    yearSelect.value = String(compositionRange.year);
    modeButtons.forEach(({ mode, button }) => button.classList.toggle('is-active', mode === compositionRange.mode));
    monthSelect.toggleClass('is-visible', compositionRange.mode === 'month');
    yearSelect.toggleClass('is-visible', compositionRange.mode === 'year');
    controls.toggleClass('is-hidden', compositionRange.mode === 'all');
  }
  sync();
}

// 类目构成卡片：大类/小类可切换（手写 SVG 零依赖）
function renderCatCard(
  host: HTMLElement,
  b: LedgerBucket,
  sym: string,
  type: TxnType,
  title: string
): () => void {
  const card = host.createDiv('fl-chart-card');
  const head = card.createDiv('fl-chart-head');
  const titleEl = head.createDiv('fl-chart-title');
  const seg = head.createDiv('fl-cat-seg');
  let mode: 'l2' | 'l3' = 'l3';
  const bL3 = seg.createEl('button', { text: '小类' });
  const bL2 = seg.createEl('button', { text: '大类' });
  const setActive = () => {
    bL3.classList.toggle('is-active', mode === 'l3');
    bL2.classList.toggle('is-active', mode === 'l2');
  };
  bL3.addEventListener('click', () => {
    mode = 'l3';
    setActive();
    paint();
  });
  bL2.addEventListener('click', () => {
    mode = 'l2';
    setActive();
    paint();
  });
  setActive();
  const body = card.createDiv('fl-cat-body');
  function paint() {
    body.empty();
    titleEl.setText(`${title} · ${compositionLabel()}`);
    const transactions = compositionTransactions(b);
    const data = compactCategories(
      mode === 'l2'
        ? sumByCategory2(transactions, type)
        : sumByCategory(transactions, type)
    );
    body.appendChild(donutSvg(data, sym));
    body.appendChild(legend(data));
  }
  paint();
  return paint;
}

function compactCategories(data: { name: string; value: number }[], limit = 8): { name: string; value: number }[] {
  if (data.length <= limit) return data;
  const keep = data.slice(0, limit - 1);
  const other = data.slice(limit - 1).reduce((sum, item) => sum + item.value, 0);
  return [...keep, { name: '其他', value: other }];
}

function monthTrendSvg(b: LedgerBucket): HTMLElement {
  const months = recentMonths(12);
  const data = months.map((m) => {
    let inc = 0;
    let exp = 0;
    for (const t of b.transactions) {
      const d = new Date(t.date + 'T00:00:00');
      if (d.getFullYear() === m.year && d.getMonth() === m.month) {
        if (t.type === '收入') inc += t.amount;
        else exp += t.amount;
      }
    }
    return { label: m.label, inc, exp };
  });
  const W = 960;
  const H = 156;
  const pad = 18;
  const max = Math.max(1, ...data.map((d) => Math.max(d.inc, d.exp)));
  const groupW = (W - pad * 2) / data.length;
  const barW = groupW / 3;
  const baseY = H - pad;
  let bars = '';
  data.forEach((d, i) => {
    const x = pad + i * groupW + barW / 2;
    const incH = (d.inc / max) * (H - pad * 2);
    const expH = (d.exp / max) * (H - pad * 2);
    bars += `<rect x="${x}" y="${baseY - incH}" width="${barW * 0.68}" height="${incH}" rx="4" fill="var(--fl-income)"/>`;
    bars += `<rect x="${x + barW * 0.78}" y="${baseY - expH}" width="${barW * 0.68}" height="${expH}" rx="4" fill="var(--fl-expense)"/>`;
    bars += `<text x="${x + barW * 0.72}" y="${H - pad + 15}" text-anchor="middle" font-size="10.5" fill="var(--fl-text-sub)">${d.label}</text>`;
  });
  const svg = `<svg class="fl-wide-chart" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    <line x1="${pad}" y1="${baseY}" x2="${W - pad}" y2="${baseY}" stroke="var(--fl-border)"/>
    ${bars}
  </svg>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = svg;
  return wrap;
}

function donutSvg(
  data: { name: string; value: number }[],
  sym: string
): HTMLElement {
  if (data.length === 0) return noteWrap('暂无数据');
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 52;
  const cx = 68;
  const cy = 68;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  let arcs = '';
  data.slice(0, 10).forEach((d, i) => {
    const frac = d.value / total;
    const len = frac * circ;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="16" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  });
  const svg = `<svg viewBox="0 0 136 136" width="136" height="136" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--fl-surface-3)" stroke-width="16"/>
    ${arcs}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="11.5" fill="var(--fl-text-sub)">合计</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="13.5" font-weight="520" fill="var(--fl-text)">${formatMoney(total, sym)}</text>
  </svg>`;
  const wrap = document.createElement('div');
  wrap.style.textAlign = 'center';
  wrap.innerHTML = svg;
  return wrap;
}

function legend(data: { name: string; value: number }[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fl-legend';
  if (data.length === 0) return el;
  data.slice(0, 10).forEach((d, i) => {
    const item = el.createDiv('fl-legend-item');
    const dot = item.createDiv('fl-legend-dot');
    dot.style.background = PALETTE[i % PALETTE.length];
    item.createSpan({ text: `${d.name} ${formatMoney(d.value)}` });
  });
  return el;
}

function budgetPanel(b: LedgerBucket, sym: string): HTMLElement {
  const stats = computeLedgerStats(b);
  const budget = b.monthlyBudget;
  const exp = stats.monthlyExpense;
  if (budget <= 0) return noteWrap('未设置月预算');
  const pct = Math.min(100, (exp / budget) * 100);
  const wrap = document.createElement('div');
  wrap.className = 'fl-budget-card';
  const main = wrap.createDiv('fl-budget-main');
  main.createDiv({ cls: 'fl-budget-value', text: formatMoney(budget, sym) });
  main.createDiv({ cls: 'fl-budget-meta', text: `已用 ${formatMoney(exp, sym)} · 剩余 ${formatMoney(stats.budgetRemaining, sym)}` });
  const bar = wrap.createDiv('fl-budget-track');
  const urgency = pct >= 90 ? ' is-high' : pct >= 70 ? ' is-mid' : ' is-low';
  const fill = bar.createDiv('fl-budget-fill' + urgency + (pct > 100 ? ' is-over' : ''));
  fill.style.width = `${Math.min(100, pct)}%`;
  wrap.createDiv({ cls: 'fl-budget-pct', text: `${pct.toFixed(0)}%` });
  return wrap;
}

function dailyTrendPanel(b: LedgerBucket, sym: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fl-daily-trend';
  const controls = wrap.createDiv('fl-line-controls');
  const chart = wrap.createDiv('fl-line-chart');
  let visible = new Set(['income', 'expense', 'profit']);
  const defs = [
    { key: 'income', label: '收入' },
    { key: 'expense', label: '支出' },
    { key: 'profit', label: '盈亏' },
  ];
  const paint = () => {
    chart.empty();
    chart.appendChild(dailyTrendSvg(b, visible, sym));
  };
  defs.forEach((d) => {
    const btn = controls.createEl('button', { text: d.label, cls: 'fl-line-toggle is-active' });
    btn.addEventListener('click', () => {
      if (visible.has(d.key) && visible.size > 1) visible.delete(d.key);
      else visible.add(d.key);
      btn.classList.toggle('is-active', visible.has(d.key));
      paint();
    });
  });
  paint();
  return wrap;
}

function dailyTrendSvg(b: LedgerBucket, visible: Set<string>, sym: string): HTMLElement {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const data = Array.from({ length: days }, (_, i) => ({ day: i + 1, income: 0, expense: 0, profit: 0 }));
  for (const t of b.transactions) {
    const d = new Date(t.date + 'T00:00:00');
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const item = data[d.getDate() - 1];
    if (!item) continue;
    if (t.type === '收入') item.income += t.amount;
    else item.expense += t.amount;
  }
  data.forEach((d) => {
    d.profit = d.income - d.expense;
  });
  const series = [
    { key: 'income', color: 'var(--fl-income)', label: '收入', values: data.map((d) => d.income) },
    { key: 'expense', color: 'var(--fl-expense)', label: '支出', values: data.map((d) => d.expense) },
    { key: 'profit', color: 'var(--fl-profit)', label: '盈亏', values: data.map((d) => d.profit) },
  ].filter((s) => visible.has(s.key));
  const vals = series.flatMap((s) => s.values);
  const min = Math.min(0, ...vals);
  const max = Math.max(1, ...vals);
  const W = 960;
  const H = 190;
  const pad = 20;
  const x = (idx: number) => pad + (idx / Math.max(1, days - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / Math.max(1, max - min)) * (H - pad * 2);
  const smoothPath = (values: number[]) => {
    if (values.length === 0) return '';
    let d = `M ${x(0)} ${y(values[0])}`;
    for (let i = 1; i < values.length; i++) {
      const x0 = x(i - 1);
      const y0 = y(values[i - 1]);
      const x1 = x(i);
      const y1 = y(values[i]);
      const mid = (x0 + x1) / 2;
      d += ` C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`;
    }
    return d;
  };
  const axisY = y(0);
  const paths = series
    .map((s) => `<path d="${smoothPath(s.values)}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round"/>`)
    .join('');
  const labels = [1, Math.ceil(days / 2), days]
    .map((d) => `<text x="${x(d - 1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--fl-text-faint)">${d}日</text>`)
    .join('');
  const legend = series
    .map((s, i) => `<text x="${pad + i * 86}" y="15" font-size="10.5" fill="${s.color}">${s.label}</text>`)
    .join('');
  const summary = `<text x="${W - pad}" y="15" text-anchor="end" font-size="10.5" fill="var(--fl-text-sub)">本月支出 ${formatMoney(data.reduce((sum, d) => sum + d.expense, 0), sym)}</text>`;
  const svg = `<svg class="fl-wide-chart" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
    ${legend}
    ${summary}
    <line x1="${pad}" y1="${axisY}" x2="${W - pad}" y2="${axisY}" stroke="var(--fl-border)"/>
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--fl-border)"/>
    ${paths}
    ${labels}
  </svg>`;
  const el = document.createElement('div');
  el.innerHTML = svg;
  return el;
}

function renderCompareCard(host: HTMLElement, b: LedgerBucket, sym: string): void {
  const card = host.createDiv('fl-chart-card wide');
  const head = card.createDiv('fl-chart-head');
  head.createDiv({ cls: 'fl-chart-title', text: '分类收支对比' });
  const seg = head.createDiv('fl-cat-seg');
  let type: TxnType = '支出';
  let level: 'l2' | 'l3' = 'l2';
  const body = card.createDiv('fl-compare-list');
  const controls = [
    { label: '支出', action: () => (type = '支出'), active: () => type === '支出' },
    { label: '收入', action: () => (type = '收入'), active: () => type === '收入' },
    { label: '二级', action: () => (level = 'l2'), active: () => level === 'l2' },
    { label: '三级', action: () => (level = 'l3'), active: () => level === 'l3' },
  ];
  const buttons = controls.map((c) => {
    const btn = seg.createEl('button', { text: c.label });
    btn.addEventListener('click', () => {
      c.action();
      paint();
    });
    return { btn, active: c.active };
  });
  const paint = () => {
    buttons.forEach((b0) => b0.btn.classList.toggle('is-active', b0.active()));
    body.empty();
    const header = body.createDiv('fl-compare-row fl-compare-row--head');
    header.createDiv({ cls: 'fl-compare-name', text: level === 'l2' ? '二级分类' : '三级分类' });
    header.createDiv({ cls: 'fl-compare-value', text: '本月' });
    header.createDiv({ cls: 'fl-compare-ratio', text: '占比' });
    header.createDiv({ cls: 'fl-compare-prev', text: '上月' });
    const rows = categoryCompareRows(b, type, level);
    if (rows.length === 0) {
      body.createDiv({ cls: 'fl-empty-desc', text: '暂无本月分类数据' });
      return;
    }
    rows.slice(0, 12).forEach((r) => {
      const row = body.createDiv('fl-compare-row');
      row.createDiv({ cls: 'fl-compare-name', text: r.name });
      const value = row.createDiv({ cls: 'fl-compare-value ' + (type === '支出' ? 'expense' : 'income') });
      value.createSpan({ text: formatMoney(r.current, sym) });
      if (r.previous > 0) {
        const direction = r.current > r.previous ? 'up' : r.current < r.previous ? 'down' : 'flat';
        const favorable = type === '支出' ? direction === 'down' : direction === 'up';
        const trendClass = direction === 'flat'
          ? 'is-flat'
          : favorable
            ? 'is-favorable'
            : 'is-unfavorable';
        const trendLabel = direction === 'up' ? '较上月增加' : direction === 'down' ? '较上月减少' : '与上月持平';
        value.createSpan({
          cls: `fl-compare-trend ${trendClass}`,
          text: direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→',
          attr: { title: trendLabel, 'aria-label': trendLabel },
        });
      }
      row.createDiv({ cls: 'fl-compare-ratio', text: `${r.ratio.toFixed(1)}%` });
      row.createDiv({
        cls: 'fl-compare-prev',
        text: r.previous > 0 ? formatMoney(r.previous, sym) : '',
      });
    });
  };
  paint();
}

function categoryCompareRows(
  b: LedgerBucket,
  type: TxnType,
  level: 'l2' | 'l3'
): { name: string; current: number; previous: number; ratio: number }[] {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const prev = new Date(curY, curM - 1, 1);
  const prevY = prev.getFullYear();
  const prevM = prev.getMonth();
  const keyOf = (t: { cat2: string; cat3: string }) => (level === 'l2' ? t.cat2 || '未分类' : t.cat3 || '未分类');
  const collect = (year: number, month: number) => {
    const map = new Map<string, number>();
    for (const t of b.transactions) {
      if (t.type !== type) continue;
      const d = new Date(t.date + 'T00:00:00');
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const k = keyOf(t);
      map.set(k, (map.get(k) ?? 0) + t.amount);
    }
    return map;
  };
  const cur = collect(curY, curM);
  const pre = collect(prevY, prevM);
  const names = new Set([...cur.keys(), ...pre.keys()]);
  const total = [...cur.values()].reduce((sum, value) => sum + value, 0);
  return [...names]
    .map((name) => {
      const current = cur.get(name) ?? 0;
      const previous = pre.get(name) ?? 0;
      const ratio = total > 0 ? (current / total) * 100 : 0;
      return { name, current, previous, ratio };
    })
    .filter((r) => r.current !== 0 || r.previous !== 0)
    .sort((a, b) => b.current - a.current);
}

function noteWrap(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fl-empty';
  el.createDiv({ cls: 'fl-empty-desc', text });
  return el;
}
