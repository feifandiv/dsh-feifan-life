// 财务记账插件 · 纯函数计算层
// 统计与余额联动全部现算，不持久化冗余，避免「写入不同步」。

import { Category, LedgerBucket, Transaction, TxnType } from './models';

export interface LedgerStats {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyProfit: number;
  budgetRemaining: number;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  assetsSum: number;
  receivablesRemaining: number;
  debtsRemaining: number;
  netWorth: number;
}

function isThisMonth(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function computeLedgerStats(b: LedgerBucket): LedgerStats {
  let monthlyIncome = 0;
  let monthlyExpense = 0;
  let totalIncome = 0;
  let totalExpense = 0;

  for (const t of b.transactions) {
    if (t.type === '收入') {
      totalIncome += t.amount;
      if (isThisMonth(t.date)) monthlyIncome += t.amount;
    } else {
      totalExpense += t.amount;
      if (isThisMonth(t.date)) monthlyExpense += t.amount;
    }
  }

  // 负债联动：借入视为累计收入，还款视为累计支出
  for (const debt of b.debts) {
    totalIncome += debt.totalAmount;
    for (const r of debt.repayments) totalExpense += r.amount;
  }

  const balance =
    b.balanceOverride != null ? b.balanceOverride : totalIncome - totalExpense;
  const budgetRemaining = b.monthlyBudget - monthlyExpense;

  // 资产与应收仅计入净资产，不进入账本余额
  const assetsSum = b.assets.reduce((s, a) => s + a.value, 0);
  const receivablesRemaining = b.receivables.reduce((s, r) => s + r.remaining, 0);
  const debtsRemaining = b.debts.reduce((s, d) => s + d.remaining, 0);
  const netWorth = balance + assetsSum + receivablesRemaining - debtsRemaining;

  return {
    monthlyIncome,
    monthlyExpense,
    monthlyProfit: monthlyIncome - monthlyExpense,
    budgetRemaining,
    totalIncome,
    totalExpense,
    balance,
    assetsSum,
    receivablesRemaining,
    debtsRemaining,
    netWorth,
  };
}

export interface CatNode {
  cat: Category;
  children: CatNode[];
}

export function categoryTree(cats: Category[]): CatNode[] {
  const map = new Map<string, CatNode>();
  cats.forEach((c) => map.set(c.id, { cat: c, children: [] }));
  const roots: CatNode[] = [];
  cats.forEach((c) => {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) map.get(c.parentId)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

// 三级类目下拉选项：以「三级 · 二级」呈现
export function categoryOptions(
  cats: Category[],
  type: TxnType,
  transactions: Transaction[] = []
): { value: string; label: string; cat2: string; cat3: string; usage: number }[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const usage = new Map<string, number>();
  transactions.forEach((transaction) => {
    if (transaction.type !== type) return;
    const key = `${transaction.cat2}\u0000${transaction.cat3}`;
    usage.set(key, (usage.get(key) ?? 0) + 1);
  });
  return cats
    .filter((c) => c.level === 3 && c.type === type)
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      const cat2 = parent ? parent.name : '';
      return {
        value: c.id,
        label: `${c.name} · ${cat2}`,
        cat2,
        cat3: c.name,
        usage: usage.get(`${cat2}\u0000${c.name}`) ?? 0,
        sortOrder: c.sortOrder,
      };
    })
    .sort((a, b) => b.usage - a.usage || a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...option }) => option);
}

export function filterTransactions(
  txs: Transaction[],
  type: 'all' | TxnType,
  year: number | null,
  month: number | null
): Transaction[] {
  return txs
    .filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (year != null || month != null) {
        const d = new Date(t.date + 'T00:00:00');
        if (year != null && d.getFullYear() !== year) return false;
        if (month != null && d.getMonth() !== month) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export interface DateGroup {
  date: string;
  items: Transaction[];
}

export function groupByDate(txs: Transaction[]): DateGroup[] {
  const map = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!map.has(t.date)) map.set(t.date, []);
    map.get(t.date)!.push(t);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

export function formatMoney(n: number, symbol = '¥'): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol} ${abs}`;
}

// 最近 N 个月标签（含当月），用于趋势图
export function recentMonths(n: number): { year: number; month: number; label: string }[] {
  const out: { year: number; month: number; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: `${d.getMonth() + 1}月`,
    });
  }
  return out;
}

// 按类目(三级小类)汇总金额，用于圆环图
export function sumByCategory(
  txs: Transaction[],
  type: TxnType
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== type) continue;
    map.set(t.cat3, (map.get(t.cat3) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// 按二级大类(cat2)汇总金额，用于「大类」视图圆环图
export function sumByCategory2(
  txs: Transaction[],
  type: TxnType
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const key = t.cat2 || '未分类';
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// 二级分类统计：返回每个大类及其下小类的金额明细，供账本视图标题展示
export interface Cat2Total {
  cat2: string;
  total: number;
  children: { cat3: string; value: number }[];
}
export function categoryTotals(
  b: LedgerBucket,
  type: TxnType
): Cat2Total[] {
  const map = new Map<string, Cat2Total>();
  for (const t of b.transactions) {
    if (t.type !== type) continue;
    const cat2 = t.cat2 || '未分类';
    let node = map.get(cat2);
    if (!node) {
      node = { cat2, total: 0, children: [] };
      map.set(cat2, node);
    }
    node.total += t.amount;
    const child = node.children.find((c) => c.cat3 === t.cat3);
    if (child) child.value += t.amount;
    else node.children.push({ cat3: t.cat3, value: t.amount });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
