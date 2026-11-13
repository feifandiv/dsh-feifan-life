import {
  PALETTE,
  categoryDistribution,
  computeInputStats,
  computeInventoryStats,
  currentYearMonths,
  formatMoney,
  InventoryPriceStats,
  keywordRank,
  ratingDistribution,
  yearlyTrend,
} from '../calc';
import { statCard } from '../components';
import { ViewCtx } from './base';

export function renderDashboardView(host: HTMLElement, ctx: ViewCtx): void {
  const inputs = ctx.store.get().inputs;
  const inventory = ctx.store.get().inventory;
  const inputStats = computeInputStats(inputs);
  const invStats = computeInventoryStats(inventory);

  const stats = host.createDiv('ll-stats ll-stats--overview');
  statCard(stats, '输入总数', String(inputStats.total));
  statCard(stats, '读书输入', String(inputStats.byType['读书'] ?? 0));
  statCard(stats, '观影输入', String(inputStats.byType['观影'] ?? 0));
  statCard(stats, '学习输入', String(inputStats.byType['学习'] ?? 0));
  statCard(stats, '物资清单', String(invStats.activeQuantity));
  statCard(stats, '今年输入数', String(inputStats.yearTotal));
  statCard(stats, 'S级记录', String(inputStats.sRated));
  statCard(stats, '物资金额', formatMoney(invStats.activeAmount), 'll-stat--money');

  const charts = host.createDiv('ll-charts');
  chartCard(charts, '年度输入趋势', barSvg(yearlyTrend(inputs), 880, 170));
  chartCard(charts, `${new Date().getFullYear()} 月度节奏`, barSvg(currentYearMonths(inputs), 880, 170));
  chartCard(charts, '评级分布', donutWithLegend(ratingDistribution(inputs)));
  chartCard(charts, '输入类别构成', donutWithLegend(categoryDistribution(inputs)));
  chartCard(charts, '关键词排行', rankList(keywordRank(inputs)));
  chartCard(charts, '物资金额分布', priceSummary(invStats.prices));
  chartCard(charts, '物资等级分布', donutWithLegend(invStats.byLevel));
  chartCard(charts, '物资状态分布', donutWithLegend(invStats.byStatus));
  chartCard(charts, '物资类别金额', rankList(invStats.byCategory.map((x) => ({ name: x.name, value: Math.round(x.value) }))));
}

function chartCard(parent: HTMLElement, title: string, body: HTMLElement, cls = ''): void {
  const card = parent.createDiv('ll-chart-card' + (cls ? ` ${cls}` : ''));
  card.createDiv({ cls: 'll-chart-title', text: title });
  card.appendChild(body);
}

function barSvg(data: { name: string; value: number }[], width: number, height: number): HTMLElement {
  if (data.length === 0) return noteWrap('暂无数据');
  const pad = 18;
  const max = Math.max(1, ...data.map((x) => x.value));
  const step = (width - pad * 2) / data.length;
  const barW = Math.max(10, step * 0.5);
  const baseY = height - pad - 18;
  let bars = '';
  data.forEach((d, i) => {
    const h = (d.value / max) * (height - pad * 2 - 22);
    const x = pad + i * step + (step - barW) / 2;
    bars += `<rect x="${x}" y="${baseY - h}" width="${barW}" height="${h}" rx="4" fill="${PALETTE[i % PALETTE.length]}"/>`;
    bars += `<text x="${x + barW / 2}" y="${height - pad}" text-anchor="middle" font-size="11" fill="var(--ll-text-sub)">${escapeXml(d.name)}</text>`;
    if (d.value > 0) bars += `<text x="${x + barW / 2}" y="${baseY - h - 5}" text-anchor="middle" font-size="10" fill="var(--ll-text-sub)">${d.value}</text>`;
  });
  return svgWrap(`<svg class="ll-wide-chart" viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">
    <line x1="${pad}" y1="${baseY}" x2="${width - pad}" y2="${baseY}" stroke="var(--ll-border)"/>
    ${bars}
  </svg>`);
}

function donutWithLegend(data: { name: string; value: number }[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'll-donut-wrap';
  wrap.appendChild(donutSvg(data));
  const legend = wrap.createDiv('ll-legend');
  data.slice(0, 10).forEach((d, i) => {
    const item = legend.createDiv('ll-legend-item');
    const dot = item.createDiv('ll-legend-dot');
    dot.style.background = PALETTE[i % PALETTE.length];
    item.createSpan({ text: `${d.name} ${d.value}` });
  });
  return wrap;
}

function donutSvg(data: { name: string; value: number }[]): HTMLElement {
  const active = data.filter((x) => x.value > 0);
  if (active.length === 0) return noteWrap('暂无数据');
  const total = active.reduce((s, x) => s + x.value, 0);
  const r = 48;
  const cx = 64;
  const cy = 64;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let arcs = '';
  active.forEach((d, i) => {
    const len = (d.value / total) * circ;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="15" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  });
  return svgWrap(`<svg viewBox="0 0 128 128" width="128" height="128" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--ll-surface-3)" stroke-width="15"/>
    ${arcs}
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="11" fill="var(--ll-text-sub)">合计</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="15" font-weight="620" fill="var(--ll-text)">${total}</text>
  </svg>`);
}

function rankList(data: { name: string; value: number }[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'll-rank';
  if (data.length === 0) return noteWrap('暂无数据');
  const max = Math.max(1, ...data.map((x) => x.value));
  data.slice(0, 12).forEach((d) => {
    const row = wrap.createDiv('ll-rank-row');
    row.createDiv({ cls: 'll-rank-name', text: d.name });
    const bar = row.createDiv('ll-rank-bar');
    bar.createDiv('ll-rank-fill').style.width = `${Math.max(4, (d.value / max) * 100)}%`;
    row.createDiv({ cls: 'll-rank-value', text: String(d.value) });
  });
  return wrap;
}

function priceSummary(stats: InventoryPriceStats): HTMLElement {
  if (!stats.count) return noteWrap('暂无有效金额数据');
  const wrap = document.createElement('div');
  wrap.className = 'll-price-bars';
  const metrics: Array<[string, number]> = [
    ['最低', stats.min],
    ['中位数', stats.median],
    ['平均', stats.average],
    ['最高', stats.max],
  ];
  const max = Math.max(1, ...metrics.map(([, value]) => value));
  metrics.forEach(([label, value]) => {
    const row = wrap.createDiv('ll-price-bars__row');
    row.createDiv({ cls: 'll-price-bars__label', text: label });
    const track = row.createDiv('ll-price-bars__track');
    track.createDiv('ll-price-bars__fill').style.width = `${Math.max(3, value / max * 100)}%`;
    row.createDiv({ cls: 'll-price-bars__value', text: formatMoney(value) });
  });
  return wrap;
}

function noteWrap(text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'll-chart-empty';
  div.setText(text);
  return div;
}

function svgWrap(svg: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = svg;
  return wrap;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] ?? c));
}
