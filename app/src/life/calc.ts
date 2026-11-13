import { InputRecord, InventoryItem, INPUT_TYPES, RATING_OPTIONS } from './models';

export const PALETTE = [
  'var(--ll-accent)',
  'var(--ll-income)',
  'var(--ll-blue)',
  'var(--ll-warn)',
  'var(--ll-series-5)',
  'var(--ll-series-6)',
  'var(--ll-series-7)',
  'var(--ll-series-8)',
  'var(--ll-series-9)',
  'var(--ll-series-10)',
];

export interface InputStats {
  total: number;
  yearTotal: number;
  byType: Record<string, number>;
  sRated: number;
}

export interface InventoryPriceStats {
  count: number;
  min: number;
  max: number;
  average: number;
  median: number;
}

export interface InventoryStats {
  activeAmount: number;
  activeQuantity: number;
  prices: InventoryPriceStats;
  byLevel: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  byCategory: { name: string; value: number }[];
}

export function computeInputStats(inputs: InputRecord[], year = new Date().getFullYear()): InputStats {
  const byType: Record<string, number> = {};
  INPUT_TYPES.forEach((t) => (byType[t] = inputs.filter((x) => x.type === t).length));
  return {
    total: inputs.length,
    yearTotal: inputs.filter((x) => completedYear(x.completedMonth) === year).length,
    byType,
    sRated: inputs.filter((x) => x.rating === 'S').length,
  };
}

export function computeInventoryStats(items: InventoryItem[]): InventoryStats {
  const amount = (it: InventoryItem) => (Number(it.price) || 0) * (Number(it.quantity) || 0);
  const active = items.filter((x) => x.status === '使用' || x.status === '改造');
  const prices = active.map((x) => Number(x.price) || 0).filter((value) => value > 0).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length === 0
    ? 0
    : prices.length % 2 === 1
      ? prices[middle]
      : (prices[middle - 1] + prices[middle]) / 2;
  return {
    activeAmount: active.reduce((s, x) => s + amount(x), 0),
    activeQuantity: active.reduce((s, x) => s + (Number(x.quantity) || 0), 0),
    prices: {
      count: prices.length,
      min: prices[0] ?? 0,
      max: prices[prices.length - 1] ?? 0,
      average: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : 0,
      median,
    },
    byLevel: groupCount(items.map((x) => x.level || '未分级')),
    byStatus: groupCount(items.map((x) => x.status || '未知')),
    byCategory: groupAmount(items, (x) => x.category || '未分类'),
  };
}

export function completedYear(month: string): number | null {
  const m = String(month || '').match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function completedMonthIndex(month: string): number {
  const m = String(month || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 12 + Number(m[2]);
}

export function yearlyTrend(inputs: InputRecord[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  inputs.forEach((x) => {
    const y = completedYear(x.completedMonth);
    if (y) map.set(String(y), (map.get(String(y)) ?? 0) + 1);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, value]) => ({ name, value }));
}

export function currentYearMonths(inputs: InputRecord[], year = new Date().getFullYear()): { name: string; value: number }[] {
  const months = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}月`, value: 0 }));
  inputs.forEach((x) => {
    const m = String(x.completedMonth || '').match(/^(\d{4})-(\d{2})/);
    if (m && Number(m[1]) === year) months[Number(m[2]) - 1].value++;
  });
  return months;
}

export function ratingDistribution(inputs: InputRecord[]): { name: string; value: number }[] {
  return RATING_OPTIONS.map((level) => ({
    name: `${level}级`,
    value: inputs.filter((x) => x.rating === level).length,
  }));
}

export function categoryDistribution(inputs: InputRecord[], limit = 10): { name: string; value: number }[] {
  return compact(groupCount(inputs.map((x) => x.category || '未分类')), limit);
}

export function keywordRank(inputs: InputRecord[], limit = 12): { name: string; value: number }[] {
  const words = inputs.flatMap((x) => x.keywords);
  return compact(groupCount(words), limit);
}

export function formatMoney(n: number, symbol = '¥'): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol} ${abs}`;
}

function groupCount(values: string[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  values.filter(Boolean).forEach((x) => map.set(x, (map.get(x) ?? 0) + 1));
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function groupAmount(items: InventoryItem[], key: (item: InventoryItem) => string): { name: string; value: number }[] {
  const map = new Map<string, number>();
  items.forEach((x) => {
    const k = key(x);
    map.set(k, (map.get(k) ?? 0) + (Number(x.price) || 0) * (Number(x.quantity) || 0));
  });
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function compact(data: { name: string; value: number }[], limit = 8): { name: string; value: number }[] {
  if (data.length <= limit) return data;
  const keep = data.slice(0, limit - 1);
  const other = data.slice(limit - 1).reduce((sum, x) => sum + x.value, 0);
  return [...keep, { name: '其他', value: other }];
}
