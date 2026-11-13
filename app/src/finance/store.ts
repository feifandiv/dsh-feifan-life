// 财务记账插件 · 数据存储（data.json 单一真相源）

import { Notice } from 'obsidian';
import { StoreHost } from '../models/root';
import {
  FinanceData,
  LedgerBucket,
  LedgerId,
  InventoryItem,
  Debt,
  DebtRepaymentMode,
  FundingPlan,
  PlannedIncome,
  PlannedExpense,
  uid,
  createDefaultData,
} from './models';
import { computeLedgerStats, LedgerStats } from './calc';
import { normalizeInventoryItem } from '../life/store';

type Listener = () => void;

function normalize(saved: any): FinanceData {
  const def = createDefaultData();
  if (!saved || typeof saved !== 'object') return def;
  const data: FinanceData = {
    schemaVersion: Math.max(Number(saved.schemaVersion) || 1, 5),
    currentLedger: saved.currentLedger === 'business' ? 'business' : 'personal',
    ledgers: {
      personal: normalizeLedger(saved.ledgers?.personal, def.ledgers.personal),
      business: normalizeLedger(saved.ledgers?.business, def.ledgers.business),
    },
    inventory: Array.isArray(saved.inventory) ? saved.inventory.map(normalizeItem) : [],
    settings: saved.settings ?? { currencySymbol: '¥' },
  };
  return data;
}

// 物资条目归一：level 由历史 number 迁移为字符串 A/B/C/S；补齐 status/notes 默认值
const LEVEL_STR = ['A', 'B', 'C', 'S'];
function normalizeItem(it: any): InventoryItem {
  if (!it || typeof it !== 'object') {
    return { id: uid(), name: '', price: 0, quantity: 0, unit: '', level: 'A', inDate: '', category: '', status: '使用', notes: '', idCard: undefined };
  }
  let level = it.level;
  if (typeof level === 'number') level = LEVEL_STR[level] ?? 'A';
  if (typeof level !== 'string' || !LEVEL_STR.includes(level)) level = 'A';
  const st = it.status === '转手' ? '转卖' : it.status;
  const status: InventoryItem['status'] =
    st === '废弃' || st === '转卖' || st === '改造' ? st : '使用';
  return {
    id: it.id ?? uid(),
    name: it.name ?? '',
    price: Number(it.price) || 0,
    quantity: Number(it.quantity) || 0,
    unit: it.unit ?? '',
    level,
    inDate: it.inDate ?? '',
    category: it.category ?? '',
    status,
    notes: it.notes ?? '',
    idCard: it.idCard || undefined,
  };
}

function normalizeLedger(saved: any, fallback: LedgerBucket): LedgerBucket {
  if (!saved || typeof saved !== 'object') return fallback;
  return {
    id: saved.id ?? fallback.id,
    name: saved.name ?? fallback.name,
    monthlyBudget: Number(saved.monthlyBudget) || 0,
    balanceOverride: saved.balanceOverride == null ? null : Number(saved.balanceOverride),
    categories: Array.isArray(saved.categories) ? saved.categories : [],
    transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
    debts: Array.isArray(saved.debts) ? saved.debts.map(normalizeDebt) : [],
    receivables: Array.isArray(saved.receivables) ? saved.receivables : [],
    assets: Array.isArray(saved.assets) ? saved.assets : [],
    savings: Array.isArray(saved.savings) ? saved.savings : [],
    fundingPlans: Array.isArray(saved.fundingPlans) ? saved.fundingPlans.map(normalizeFundingPlan) : [],
  };
}

function normalizeFundingPlan(raw: any): FundingPlan {
  const now = Date.now();
  const periodType = raw?.periodType === 'year' ? 'year' : 'month';
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid(),
    periodType,
    periodKey: typeof raw?.periodKey === 'string' ? raw.periodKey : '',
    incomes: Array.isArray(raw?.incomes) ? raw.incomes.map(normalizePlannedIncome) : [],
    expenses: Array.isArray(raw?.expenses) ? raw.expenses.map(normalizePlannedExpense) : [],
    createdAt: Number(raw?.createdAt) || now,
    updatedAt: Number(raw?.updatedAt) || Number(raw?.createdAt) || now,
  };
}

function normalizePlannedIncome(raw: any): PlannedIncome {
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid(),
    name: typeof raw?.name === 'string' ? raw.name : '',
    amount: Math.max(0, Number(raw?.amount) || 0),
    status: raw?.status === 'estimated' ? 'estimated' : 'confirmed',
    expectedDate: typeof raw?.expectedDate === 'string' ? raw.expectedDate : '',
    note: typeof raw?.note === 'string' ? raw.note : '',
    createdAt: Number(raw?.createdAt) || Date.now(),
  };
}

function normalizePlannedExpense(raw: any): PlannedExpense {
  const executionStatus =
    raw?.executionStatus === 'partial' || raw?.executionStatus === 'completed'
      ? raw.executionStatus
      : 'pending';
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid(),
    name: typeof raw?.name === 'string' ? raw.name : '',
    amount: Math.max(0, Number(raw?.amount) || 0),
    kind: raw?.kind === 'flexible' ? 'flexible' : 'mandatory',
    plannedDate: typeof raw?.plannedDate === 'string' ? raw.plannedDate : '',
    note: typeof raw?.note === 'string' ? raw.note : '',
    executionStatus,
    actualAmount: executionStatus === 'pending' ? 0 : Math.max(0, Number(raw?.actualAmount) || 0),
    actualDate: executionStatus === 'pending' || typeof raw?.actualDate !== 'string' ? '' : raw.actualDate,
    createdAt: Number(raw?.createdAt) || Date.now(),
  };
}

function normalizeDebt(raw: any): Debt {
  const totalAmount = Math.max(0, Number(raw?.totalAmount) || 0);
  const repayments = Array.isArray(raw?.repayments)
    ? raw.repayments.map((r: any) => {
        const amount = Math.max(0, Number(r?.amount) || 0);
        // 旧版把整笔还款直接冲减本金；迁移时保留这一结果，避免余额突变。
        const principalAmount = Math.max(
          0,
          Number.isFinite(Number(r?.principalAmount)) ? Number(r.principalAmount) : amount,
        );
        const interestAmount = Math.max(0, Number(r?.interestAmount) || 0);
        const otherAmount = Math.max(0, Number(r?.otherAmount) || 0);
        return {
          id: r?.id ?? uid(),
          debtId: r?.debtId ?? raw?.id ?? '',
          amount: principalAmount + interestAmount + otherAmount,
          date: r?.date ?? '',
          principalAmount,
          interestAmount,
          otherAmount,
          planId: typeof r?.planId === 'string' ? r.planId : null,
          remainingAfter: 0,
        };
      })
    : [];

  let runningRemaining = totalAmount;
  repayments
    .slice()
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .forEach((r: any) => {
      runningRemaining = Math.max(0, runningRemaining - r.principalAmount);
      r.remainingAfter = runningRemaining;
    });

  const mode: DebtRepaymentMode =
    raw?.repaymentMode === 'fixed' || raw?.repaymentMode === 'interestOnly' || raw?.repaymentMode === 'custom'
      ? raw.repaymentMode
      : Number(raw?.monthlyPayment) > 0
        ? 'fixed'
        : 'custom';

  return {
    id: raw?.id ?? uid(),
    name: raw?.name ?? '',
    totalAmount,
    remaining: runningRemaining,
    repaymentMode: mode,
    monthlyPayment: Math.max(0, Number(raw?.monthlyPayment) || 0),
    totalPeriods: Math.max(0, Math.round(Number(raw?.totalPeriods) || 0)),
    borrowDate: raw?.borrowDate ?? '',
    firstRepaymentDate: raw?.firstRepaymentDate || null,
    finalRepaymentDate: raw?.finalRepaymentDate || null,
    plannedPayments: Array.isArray(raw?.plannedPayments)
      ? raw.plannedPayments.map((p: any) => ({
          id: p?.id ?? uid(),
          dueDate: p?.dueDate ?? '',
          amount: Math.max(0, Number(p?.amount) || 0),
        }))
      : [],
    repayments,
  };
}

export class FinanceStore {
  private data: FinanceData;
  private listeners = new Set<Listener>();

  constructor(private host: StoreHost) {
    this.data = createDefaultData();
  }

  async load(): Promise<void> {
    const saved: any = this.host.root.data.finance ?? null;
    if (saved != null && (!saved.ledgers || typeof saved.ledgers !== 'object')) {
      new Notice('财务数据结构异常，已停止加载以避免覆盖原文件');
      throw new Error('Invalid finance-ledger data structure');
    }
    const previousVersion = Number(saved?.schemaVersion) || 1;
    this.data = normalize(saved);
    const financeInventory = this.data.inventory.slice();
    const canonical = this.canonicalInventory();
    const seenIds = new Set(canonical.map((item: any) => item.id));
    const seenSignatures = new Set(canonical.map(inventorySignature));
    for (const item of financeInventory) {
      const normalized = normalizeInventoryItem(item);
      const signature = inventorySignature(normalized);
      if (seenIds.has(normalized.id) || seenSignatures.has(signature)) continue;
      canonical.push(normalized);
      seenIds.add(normalized.id);
      seenSignatures.add(signature);
    }
    this.data.inventory = canonical as unknown as InventoryItem[];
    if (saved != null && (previousVersion < 5 || financeInventory.length > 0)) await this.save();
  }

  async save(): Promise<void> {
    this.syncInventoryReference();
    const snapshot = JSON.parse(JSON.stringify(this.data)) as Partial<FinanceData>;
    delete snapshot.inventory;
    this.host.root.data.finance = snapshot;
    await this.host.root.save();
  }


  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // 通知不等待磁盘；调用方仍可 await 完整的保存与回读校验。
  async mutate(fn: (d: FinanceData) => void): Promise<void> {
    const canonical = this.canonicalInventory();
    this.data.inventory = canonical as unknown as InventoryItem[];
    fn(this.data);
    if (this.data.inventory !== canonical as unknown as InventoryItem[]) {
      const replacement = this.data.inventory.map((item) => normalizeInventoryItem(item));
      canonical.splice(0, canonical.length, ...replacement);
      this.data.inventory = canonical as unknown as InventoryItem[];
    }
    const saved = this.save();
    this.notify();
    await saved;
  }

  get(): FinanceData {
    this.syncInventoryReference();
    return this.data;
  }

  current(): LedgerBucket {
    return this.data.ledgers[this.data.currentLedger];
  }

  setCurrentLedger(id: LedgerId): void {
    if (this.data.currentLedger === id) return;
    this.data.currentLedger = id;
    const saved = this.save();
    this.notify();
    void saved.catch(error => console.error('[非凡人生] 账本切换保存失败', error));
  }

  ledger(id: LedgerId): LedgerBucket {
    return this.data.ledgers[id];
  }

  ledgerStats(id: LedgerId): LedgerStats {
    return computeLedgerStats(this.data.ledgers[id]);
  }

  currentStats(): LedgerStats {
    return computeLedgerStats(this.data.ledgers[this.data.currentLedger]);
  }

  private canonicalInventory(): any[] {
    const life = this.host.root.data.life;
    if (!life || !Array.isArray(life.inventory)) throw new Error('Life inventory is not initialized');
    return life.inventory;
  }

  private syncInventoryReference(): void {
    this.data.inventory = this.canonicalInventory() as unknown as InventoryItem[];
  }
}

function inventorySignature(item: any): string {
  return [item.name, item.price, item.quantity, item.unit, item.inDate, item.category]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join('|');
}
