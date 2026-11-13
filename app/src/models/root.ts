// 根数据模型：vault 内独立主数据，四个命名空间（finance/kanban/life/cmd）。
// 旧插件已冻结；非凡人生运行时不读取、不写入旧插件目录。

export const CC_SCHEMA_VERSION = 4;

export const PRIMARY_DATA_DIR = '.obsidian/plugins/feifan-life';
export const PRIMARY_DATA_PATH = PRIMARY_DATA_DIR + '/data.json';
export const COMPAT_DATA_PATH = PRIMARY_DATA_PATH;
export const BACKUP_DIR = PRIMARY_DATA_DIR + '/backups';
export const DAILY_BACKUP_DIR = BACKUP_DIR + '/daily';
export const WRITE_BACKUP_DIR = BACKUP_DIR + '/before-write';

export interface CmdQuote { t: string; s: string }
export interface CmdFocusPin { date: string; taskId: string; subtaskId?: string }

export interface TokenDayAgg { total: number; byModel: Record<string, number>; byAgent: Record<string, number> }

export interface CmdHabitSchedule {
  t: '每天' | '工作日' | '周末' | '每周';
  days?: number[];
}

export interface CmdHabit {
  id: string;
  name: string;
  sched: CmdHabitSchedule;
  times: number;
  unit?: string;
  rate?: number;
}

export interface TokenManualEntry {
  platform: string; asOf: string; tokens: number;
  peak?: number; cost?: number; requests?: number; note?: string;
}

export type InspirationType = '选题' | '观点' | '故事' | '案例' | '金句' | '开头' | '素材';
export type InspirationStatus = '收件箱' | '待使用' | '已使用' | '归档';

export interface CmdInspiration {
  id: string;
  title: string;
  content: string;
  type: InspirationType;
  status: InspirationStatus;
  tags: string[];
  source: string;
  captureMode: 'manual' | 'ai';
  relatedTo: string;
  createdAt: number;
  updatedAt: number;
  usedAt: number | null;
}

export type PlanningPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type PlanningGoalMode = 'adaptive' | 'cumulative';
export type PlanningPeriod = 'annual' | 'monthly' | 'custom';
export type PlanningSourceKind = 'manual' | 'tasks-completed' | 'life-inputs' | 'inventory-count' | 'habits-completed' | 'finance-income' | 'finance-expense';

export interface PlanningDataSource {
  kind: PlanningSourceKind;
  label: string;
}

export interface PlanningEvidence {
  id: string;
  name: string;
  done: boolean;
  createdAt: number;
}

export interface PlanningMetric {
  id: string;
  name: string;
  target: number;
  current: number;
  unit: string;
  source: PlanningDataSource;
  originalPlan: number[];
  actualByMonth: number[];
}

export interface PlanningGoal {
  id: string;
  name: string;
  year: number;
  priority: PlanningPriority;
  note: string;
  mode: PlanningGoalMode;
  period: PlanningPeriod;
  periodStart?: string;
  periodEnd?: string;
  achievementRule: 'sum' | 'all';
  autoAdjust: boolean;
  metrics: PlanningMetric[];
  evidence: PlanningEvidence[];
  needsReview?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PlanningCondition {
  id: string;
  name: string;
  type: 'manual' | 'quantity' | 'funding';
  target: number;
  current: number;
  unit: string;
  done: boolean;
  source: PlanningDataSource;
}

export interface PlanningVision {
  id: string;
  name: string;
  kind: 'vision' | 'reward';
  year: number | null;
  priority: PlanningPriority;
  note: string;
  conditions: PlanningCondition[];
  evidence: PlanningEvidence[];
  realizedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PlanningNamespace {
  version: 2;
  migratedAt: number;
  goals: PlanningGoal[];
  visions: PlanningVision[];
}

export interface CmdNamespace {
  quotes: CmdQuote[];
  focusPins: CmdFocusPin[];
  reading: any[];
  courses: any[];
  goals: any[];
  habits: CmdHabit[];
  habitDaily: Record<string, Record<string, number>>;
  /** @deprecated v1 used habit names and had no date. normalize() removes it. */
  habitDoneToday?: Record<string, number>;
  tokenDaily: Record<string, TokenDayAgg>;
  tokenManual: TokenManualEntry[];
  inspirations: CmdInspiration[];
  planning?: PlanningNamespace;
}

/** 云端平台数据种子（官网控制台口径，手动定期更新） */
export const SEED_TOKEN_MANUAL: TokenManualEntry[] = [
  { platform: '智谱 ZCode', asOf: '2026-09-06', tokens: 2510000000, peak: 310000000, note: '官网使用统计 · 连续 15 天' },
  { platform: 'DeepSeek', asOf: '2026-08-02', tokens: 3753397241, cost: 254.82, requests: 18166, note: '两期账单合计（06/03-08/02）' },
  { platform: '小米 MiMo', asOf: '2026-09-06', tokens: 400641837, note: 'Token 历史消耗 · 含音频转写 42,206s' },
]

export interface CCSettings {
  skin: string;          // palette-1; legacy values are normalized on load
  theme: 'light' | 'dark';
  themeMode?: 'system' | 'light' | 'dark';
  heroBg: string;        // grad | dusk | snow | forest
  heroDim: number;       // 0.2 - 0.9
  city: string;
  weatherLocation?: { query: string; name: string; latitude: number; longitude: number };
  defaultTab: string;
  mirrorPath: string;
  archiveAfterDays: number;
}

export interface CommandCenterData {
  schemaVersion: number;
  migratedAt: number;    // 历史迁移时间，仅作数据记录
  finance: any;          // 原 finance-ledger 根（schemaVersion 5 结构原样）
  kanban: any;           // 原 project-kanban 根（version 3 结构原样）
  life: any;             // 原 life-list 根（schemaVersion 4 结构原样）
  cmd: CmdNamespace;
  settings: CCSettings;
}

export interface RootApi { data: CommandCenterData; save(): Promise<void> }
export interface StoreHost { root: RootApi }

export function defaultCmd(): CmdNamespace {
  return { quotes: [], focusPins: [], reading: [], courses: [], goals: [], habits: [], habitDaily: {}, tokenDaily: {}, tokenManual: SEED_TOKEN_MANUAL, inspirations: [] };
}

export function defaultSettings(): CCSettings {
  return {
    skin: 'palette-1', theme: 'light', themeMode: 'system', heroBg: 'dusk', heroDim: 0.45,
    city: '杭州', defaultTab: 'overview',
    mirrorPath: '02-长期领域/03任务看板', archiveAfterDays: 30,
  };
}

export function defaultData(): CommandCenterData {
  return {
    schemaVersion: CC_SCHEMA_VERSION,
    migratedAt: 0,
    finance: null, kanban: null, life: null,
    cmd: defaultCmd(), settings: defaultSettings(),
  };
}

/* ---------- 迁移对账（结构校验 + 实体计数） ---------- */

export interface AuditItem { ok: boolean; label: string; detail: string }

export function auditFinance(f: any): AuditItem {
  const p = f?.ledgers?.personal;
  if (!f?.ledgers || !p?.transactions) return { ok: false, label: 'finance', detail: '结构缺失：ledgers.personal.transactions 不存在' };
  const detail = `分类${p.categories?.length ?? 0}｜交易${p.transactions.length}｜负债${p.debts?.length ?? 0}｜储蓄${p.savings?.length ?? 0}｜资金计划${p.fundingPlans?.length ?? 0}｜schema${f.schemaVersion}`;
  return { ok: true, label: 'finance', detail };
}

export function auditKanban(k: any): AuditItem {
  if (!Array.isArray(k?.projects) || !Array.isArray(k?.tasks)) return { ok: false, label: 'kanban', detail: '结构缺失：projects/tasks 非数组' };
  return { ok: true, label: 'kanban', detail: `项目${k.projects.length}｜任务${k.tasks.length}｜愿景${k.visions?.length ?? 0}｜version${k.version}` };
}

export function auditLife(l: any): AuditItem {
  if (!Array.isArray(l?.inputs) || !Array.isArray(l?.inventory)) return { ok: false, label: 'life', detail: '结构缺失：inputs/inventory 非数组' };
  const by: Record<string, number> = {};
  l.inputs.forEach((x: any) => { by[x.type] = (by[x.type] || 0) + 1; });
  const detail = `输入${l.inputs.length}（${Object.entries(by).map(([t, n]) => t + n).join('/')}）｜物资${l.inventory.length}｜schema${l.schemaVersion}`;
  return { ok: true, label: 'life', detail };
}

export function auditAll(d: CommandCenterData): { ok: boolean; items: AuditItem[] } {
  const items = [auditFinance(d.finance), auditKanban(d.kanban), auditLife(d.life)];
  return { ok: items.every(i => i.ok), items };
}
