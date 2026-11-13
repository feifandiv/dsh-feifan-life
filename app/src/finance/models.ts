// 财务记账插件 · 数据模型
// 每个账本是自包含桶；物资全局独立。派生统计不持久化，由 calc.ts 现算。

export type LedgerId = 'personal' | 'business';
export type TxnType = '收入' | '支出';

export type FundingPeriodType = 'month' | 'year';
export type PlannedIncomeStatus = 'confirmed' | 'estimated';
export type PlannedExpenseKind = 'mandatory' | 'flexible';
export type PlannedExpenseStatus = 'pending' | 'partial' | 'completed';

export interface PlannedIncome {
  id: string;
  name: string;
  amount: number;
  status: PlannedIncomeStatus;
  expectedDate: string;
  note: string;
  createdAt: number;
}

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  kind: PlannedExpenseKind;
  plannedDate: string;
  note: string;
  executionStatus: PlannedExpenseStatus;
  actualAmount: number;
  actualDate: string;
  createdAt: number;
}

export interface FundingPlan {
  id: string;
  periodType: FundingPeriodType;
  periodKey: string; // 月度 YYYY-MM；年度 YYYY
  incomes: PlannedIncome[];
  expenses: PlannedExpense[];
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  level: 1 | 2 | 3;
  parentId: string | null;
  name: string;
  type: TxnType;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  type: TxnType;
  date: string; // YYYY-MM-DD
  cat1: string; // 冗余：一级（个人/生意，由账本决定）
  cat2: string; // 冗余：二级大类
  cat3: string; // 冗余：三级小类
  amount: number; // 两位小数
  note: string;
  createdAt: string;
}

export interface RepaymentRecord {
  id: string;
  debtId: string;
  amount: number;
  date: string;
  principalAmount: number;
  interestAmount: number;
  otherAmount: number;
  planId: string | null;
  remainingAfter: number;
}

export type DebtRepaymentMode = 'fixed' | 'interestOnly' | 'custom';

export interface DebtPaymentPlan {
  id: string;
  dueDate: string;
  amount: number;
}

export interface Debt {
  id: string;
  name: string;
  totalAmount: number;
  remaining: number;
  repaymentMode: DebtRepaymentMode;
  monthlyPayment: number;
  totalPeriods: number; // 统一数字
  borrowDate: string;
  firstRepaymentDate: string | null;
  finalRepaymentDate: string | null;
  plannedPayments: DebtPaymentPlan[];
  repayments: RepaymentRecord[];
}

export const DEBT_MODE_LABEL: Record<DebtRepaymentMode, string> = {
  fixed: '定额还款',
  interestOnly: '先息后本',
  custom: '自定义计划',
};

export function debtPrincipalPaid(d: Debt): number {
  return d.repayments.reduce((sum, r) => sum + (Number(r.principalAmount) || 0), 0);
}

export function debtInterestPaid(d: Debt): number {
  return d.repayments.reduce((sum, r) => sum + (Number(r.interestAmount) || 0), 0);
}

export function debtOtherPaid(d: Debt): number {
  return d.repayments.reduce((sum, r) => sum + (Number(r.otherAmount) || 0), 0);
}

export function debtPlanPaid(d: Debt, planId: string): number {
  return d.repayments
    .filter((r) => r.planId === planId)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

export interface CollectionRecord {
  id: string;
  receivableId: string;
  amount: number;
  date: string;
  remainingAfter: number;
}

export interface Receivable {
  id: string;
  name: string;
  totalAmount: number;
  remaining: number;
  dueDate: string | null;
  collections: CollectionRecord[];
  note: string;
}

export interface Asset {
  id: string;
  name: string;
  value: number;
  purchaseDate: string;
  note: string;
}

// ── 储蓄计划（目标储蓄，按月存）──
export interface SavingsDeposit {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
}

export interface SavingsPlan {
  id: string;
  name: string;
  targetAmount: number; // 目标总额
  startDate: string; // 开始 YYYY-MM-DD
  endDate: string; // 截止 YYYY-MM-DD
  periodAmount: number; // 每期（月）储蓄金额
  deposits: SavingsDeposit[];
}

export function savingsCurrent(p: SavingsPlan): number {
  return p.deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
}

export function savingsProgress(p: SavingsPlan): number {
  if (p.targetAmount <= 0) return 0;
  return Math.min(100, (savingsCurrent(p) / p.targetAmount) * 100);
}

export interface InventoryItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  level: string; // A | B | C | S
  inDate: string; // YYYY-MM
  category: string;
  status: '使用' | '废弃' | '转卖' | '改造';
  notes: string;
  idCard?: string; // 自动生成：类别前2字符 + YYYYMMDD + 当日同类序号
}

// ── 物资等级 / 状态常量与辅助 ──
export const LEVEL_OPTIONS = ['A', 'B', 'C', 'S'] as const;
export type Level = (typeof LEVEL_OPTIONS)[number];

export const STATUS_OPTIONS = ['使用', '废弃', '转卖', '改造'] as const;
export type InvStatus = (typeof STATUS_OPTIONS)[number];

// 排序权重：A < B < C < S
export const LEVEL_ORDER: Record<string, number> = { A: 1, B: 2, C: 3, S: 4 };

// 废弃 / 转卖 → 整行灰化并始终置底
export function isDiscardStatus(s: string | undefined): boolean {
  return s === '废弃' || s === '转卖' || s === '转手';
}

// 身份证号自动生成：类别前 2 字符 + 创建日 YYYYMMDD + 当日同类别序号（3 位补零）
export function genIdCard(category: string, items: InventoryItem[], date = new Date()): string {
  const prefix = (category || '').slice(0, 2);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  const base = `${prefix}${dateStr}`;
  let seq = 0;
  for (const it of items) {
    if (it.idCard && it.idCard.startsWith(base)) seq++;
  }
  return base + `${seq + 1}`.padStart(3, '0');
}

export interface LedgerBucket {
  id: LedgerId;
  name: string;
  monthlyBudget: number; // 默认 0，用户自填
  balanceOverride: number | null; // 平账：null=自动算
  categories: Category[];
  transactions: Transaction[];
  debts: Debt[];
  receivables: Receivable[];
  assets: Asset[];
  savings: SavingsPlan[];
  fundingPlans: FundingPlan[];
}

export interface FinanceData {
  schemaVersion: number;
  currentLedger: LedgerId;
  ledgers: Record<LedgerId, LedgerBucket>;
  inventory: InventoryItem[];
  settings: { currencySymbol: string };
}

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function createEmptyLedger(id: LedgerId, name: string): LedgerBucket {
  return {
    id,
    name,
    monthlyBudget: 0,
    balanceOverride: null,
    categories: [],
    transactions: [],
    debts: [],
    receivables: [],
    assets: [],
    savings: [],
    fundingPlans: [],
  };
}

export function createDefaultData(): FinanceData {
  return {
    schemaVersion: 5,
    currentLedger: 'personal',
    ledgers: {
      personal: createEmptyLedger('personal', '个人账本'),
      business: createEmptyLedger('business', '生意账本'),
    },
    inventory: [],
    settings: { currencySymbol: '¥' },
  };
}
