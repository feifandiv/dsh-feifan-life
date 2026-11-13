import type {
  CommandCenterData,
  PlanningCondition,
  PlanningDataSource,
  PlanningEvidence,
  PlanningGoal,
  PlanningMetric,
  PlanningNamespace,
  PlanningPriority,
  PlanningSourceKind,
  PlanningVision,
} from '../models/root';

export const PLANNING_VERSION = 2 as const;
export const PLANNING_PRIORITIES: PlanningPriority[] = ['P0', 'P1', 'P2', 'P3'];

export const PLANNING_SOURCE_OPTIONS: Array<{ value: PlanningSourceKind; label: string }> = [
  { value: 'manual', label: '手动记录' },
  { value: 'tasks-completed', label: '已完成任务数' },
  { value: 'life-inputs', label: '清单输入数' },
  { value: 'inventory-count', label: '在库物资数' },
  { value: 'habits-completed', label: '习惯完成数' },
  { value: 'finance-income', label: '财务收入' },
  { value: 'finance-expense', label: '财务支出' },
];

export function planningId(prefix: string): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function emptyMonths(value = 0): number[] {
  return Array.from({ length: 12 }, () => value);
}

export function evenPlan(target: number): number[] {
  const value = Number.isFinite(target) && target > 0 ? target / 12 : 0;
  return emptyMonths(value);
}

export function manualSource(label = '手动记录'): PlanningDataSource {
  return { kind: 'manual', label };
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asPriority(value: unknown): PlanningPriority {
  return PLANNING_PRIORITIES.includes(value as PlanningPriority) ? value as PlanningPriority : 'P2';
}

function legacyEvidence(item: any): PlanningEvidence {
  return {
    id: String(item.id || planningId('evidence')),
    name: String(item.name || item.t || '').trim(),
    done: item.done === true,
    createdAt: asNumber(item.createdAt) || Date.now(),
  };
}

function legacyMetric(item: any): PlanningMetric {
  const target = Math.max(0, asNumber(item.target));
  return {
    id: String(item.id || planningId('metric')),
    name: String(item.name || item.t || '未命名指标').trim() || '未命名指标',
    target,
    current: Math.max(0, asNumber(item.current)),
    unit: String(item.unit || ''),
    source: manualSource('旧规划迁移 · 手动记录'),
    originalPlan: evenPlan(target),
    actualByMonth: emptyMonths(),
  };
}

function quantityTitle(name: string): { target: number; unit: string } | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*([^\d\s]{1,4})?\s*$/);
  if (!match) return null;
  return { target: Number(match[1]), unit: (match[2] || '项').replace(/[的之]$/, '') || '项' };
}

function migrateLegacyGoal(goal: any): PlanningGoal {
  const metrics = (Array.isArray(goal.subs) ? goal.subs : []).map(legacyMetric);
  const needsReview: string[] = [];
  if (/27年/.test(String(goal.name || '')) && Number(goal.year) !== 2027) needsReview.push('名称中的年份与所属年份不一致，请确认');
  return {
    id: String(goal.id || planningId('goal')),
    name: String(goal.name || '未命名目标'),
    year: Number.isFinite(Number(goal.year)) ? Number(goal.year) : new Date().getFullYear(),
    priority: asPriority(goal.priority),
    note: String(goal.note || ''),
    mode: 'cumulative',
    period: 'annual',
    achievementRule: 'all',
    autoAdjust: false,
    metrics,
    evidence: [],
    ...(needsReview.length ? { needsReview } : {}),
    createdAt: asNumber(goal.createdAt) || Date.now(),
    updatedAt: asNumber(goal.updatedAt) || Date.now(),
  };
}

function candidateGoal(vision: any): PlanningGoal | null {
  const subtasks = Array.isArray(vision.subtasks) ? vision.subtasks : [];
  const candidates = subtasks.filter((item: any) => String(item.name || '').trim() && asNumber(item.target) <= 0);
  const parsed = quantityTitle(String(vision.name || ''));
  if (!parsed || candidates.length < 10 || candidates.length !== subtasks.length) return null;
  const current = candidates.filter((item: any) => item.done === true).length;
  return {
    id: String(vision.id || planningId('goal')),
    name: String(vision.name || '未命名目标'),
    year: Number.isFinite(Number(vision.year)) ? Number(vision.year) : new Date().getFullYear(),
    priority: asPriority(vision.priority),
    note: String(vision.note || ''),
    mode: 'cumulative',
    period: 'annual',
    achievementRule: 'sum',
    autoAdjust: false,
    metrics: [{
      id: planningId('metric'), name: String(vision.name || '累计完成'), target: parsed.target,
      current, unit: parsed.unit, source: manualSource('候选条目完成数'),
      originalPlan: evenPlan(parsed.target), actualByMonth: emptyMonths(),
    }],
    evidence: candidates.map(legacyEvidence),
    createdAt: asNumber(vision.createdAt) || Date.now(),
    updatedAt: asNumber(vision.updatedAt) || Date.now(),
  };
}

function legacyCondition(item: any): PlanningCondition | null {
  const name = String(item.name || '').trim();
  if (!name) return null;
  const target = Math.max(0, asNumber(item.target));
  return {
    id: String(item.id || planningId('condition')),
    name,
    type: target > 0 ? 'quantity' : 'manual',
    target,
    current: Math.max(0, asNumber(item.current)),
    unit: String(item.unit || ''),
    done: item.done === true,
    source: manualSource('旧愿景迁移 · 手动记录'),
  };
}

function migrateLegacyVision(vision: any): PlanningVision {
  const conditions = (Array.isArray(vision.subtasks) ? vision.subtasks : [])
    .map(legacyCondition)
    .filter((item: PlanningCondition | null): item is PlanningCondition => item != null);
  const savings = vision.savings;
  if (asNumber(savings?.target) > 0) {
    conditions.push({
      id: planningId('funding'), name: '准备资金', type: 'funding',
      target: Math.max(0, asNumber(savings.target)), current: Math.max(0, asNumber(savings.current)),
      unit: String(savings.unit || '元'), done: asNumber(savings.current) >= asNumber(savings.target),
      source: manualSource('旧愿景储蓄迁移'),
    });
  }
  return {
    id: String(vision.id || planningId('vision')),
    name: String(vision.name || '未命名愿景'),
    kind: 'vision',
    year: Number.isFinite(Number(vision.year)) ? Number(vision.year) : null,
    priority: asPriority(vision.priority),
    note: String(vision.note || ''),
    conditions,
    evidence: [],
    realizedAt: Number.isFinite(Number(vision.realizedAt)) && Number(vision.realizedAt) > 0 ? Number(vision.realizedAt) : null,
    createdAt: asNumber(vision.createdAt) || Date.now(),
    updatedAt: asNumber(vision.updatedAt) || Date.now(),
  };
}

export interface PlanningMigrationReport {
  changed: boolean;
  sourceGoals: number;
  sourceVisions: number;
  goals: number;
  visions: number;
  discardedBlankConditions: number;
  sourceIds: string[];
  migratedIds: string[];
}

export function migratePlanning(data: CommandCenterData, now = Date.now()): PlanningMigrationReport {
  const legacyGoals = Array.isArray(data.cmd?.goals) ? data.cmd.goals : [];
  const legacyVisions = Array.isArray(data.kanban?.visions) ? data.kanban.visions : [];
  const sourceIds = [...legacyGoals, ...legacyVisions].map((item: any) => String(item.id || '')).filter(Boolean);
  if (data.cmd.planning?.version === PLANNING_VERSION) {
    const migratedIds = [...data.cmd.planning.goals, ...data.cmd.planning.visions].map((item) => item.id);
    return { changed: false, sourceGoals: legacyGoals.length, sourceVisions: legacyVisions.length, goals: data.cmd.planning.goals.length, visions: data.cmd.planning.visions.length, discardedBlankConditions: 0, sourceIds, migratedIds };
  }

  const goals = legacyGoals.map(migrateLegacyGoal);
  const visions: PlanningVision[] = [];
  let discardedBlankConditions = 0;
  for (const legacy of legacyVisions) {
    const subtasks = Array.isArray(legacy.subtasks) ? legacy.subtasks : [];
    discardedBlankConditions += subtasks.filter((item: any) => !String(item.name || '').trim()).length;
    const convertedGoal = candidateGoal(legacy);
    if (convertedGoal) goals.push(convertedGoal);
    else visions.push(migrateLegacyVision(legacy));
  }

  const planning: PlanningNamespace = { version: PLANNING_VERSION, migratedAt: now, goals, visions };
  const migratedIds = [...goals, ...visions].map((item) => item.id);
  const missing = sourceIds.filter((id) => !migratedIds.includes(id));
  if (missing.length) throw new Error('规划迁移未保留全部顶层记录：' + missing.join(', '));
  data.cmd.planning = planning;
  data.cmd.goals = [];
  if (data.kanban && Array.isArray(data.kanban.visions)) data.kanban.visions = [];
  return { changed: true, sourceGoals: legacyGoals.length, sourceVisions: legacyVisions.length, goals: goals.length, visions: visions.length, discardedBlankConditions, sourceIds, migratedIds };
}

export function normalizePlanning(data: CommandCenterData): boolean {
  const planning = data.cmd.planning;
  if (!planning || planning.version !== PLANNING_VERSION) return migratePlanning(data).changed;
  let changed = false;
  for (const goal of planning.goals) {
    if (!Array.isArray(goal.metrics)) { goal.metrics = []; changed = true; }
    if (!Array.isArray(goal.evidence)) { goal.evidence = []; changed = true; }
    for (const metric of goal.metrics) {
      if (!Array.isArray(metric.originalPlan) || metric.originalPlan.length !== 12) { metric.originalPlan = evenPlan(metric.target); changed = true; }
      if (!Array.isArray(metric.actualByMonth) || metric.actualByMonth.length !== 12) { metric.actualByMonth = emptyMonths(); changed = true; }
      if (!metric.source) { metric.source = manualSource(); changed = true; }
    }
  }
  for (const vision of planning.visions) {
    if (!Array.isArray(vision.conditions)) { vision.conditions = []; changed = true; }
    if (!Array.isArray(vision.evidence)) { vision.evidence = []; changed = true; }
    for (const condition of vision.conditions) if (!condition.source) { condition.source = manualSource(); changed = true; }
  }
  return changed;
}

export function planningProgress(goal: PlanningGoal): number {
  if (!goal.metrics.length) return 0;
  const values = goal.metrics.map((metric) => metric.target > 0 ? Math.min(1, Math.max(0, metric.current) / metric.target) : 0);
  if (goal.achievementRule === 'sum' && new Set(goal.metrics.map((metric) => metric.unit)).size === 1) {
    const target = goal.metrics.reduce((sum, metric) => sum + Math.max(0, metric.target), 0);
    const current = goal.metrics.reduce((sum, metric) => sum + Math.max(0, metric.current), 0);
    return target > 0 ? Math.min(100, current / target * 100) : 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length * 100;
}

export function conditionComplete(condition: PlanningCondition): boolean {
  return condition.type === 'manual' ? condition.done : condition.done || (condition.target > 0 && condition.current >= condition.target);
}

export function visionReady(vision: PlanningVision): boolean {
  return vision.conditions.length > 0 && vision.conditions.every(conditionComplete);
}

export function adjustedPlan(metric: PlanningMetric, goal: PlanningGoal, year: number, now = new Date()): number[] {
  const original = metric.originalPlan.length === 12 ? [...metric.originalPlan] : evenPlan(metric.target);
  if (goal.mode !== 'adaptive' || !goal.autoAdjust) return original;
  const firstFuture = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
  if (firstFuture >= 12) return original;
  const actualToDate = metric.actualByMonth.slice(0, firstFuture).reduce((sum, value) => sum + Math.max(0, asNumber(value)), 0);
  const remaining = Math.max(0, metric.target - actualToDate);
  const futureValue = remaining / (12 - firstFuture);
  return original.map((value, index) => index < firstFuture ? value : futureValue);
}

export function sourceValue(data: CommandCenterData, source: PlanningDataSource, year: number): number | null {
  if (!source || source.kind === 'manual') return null;
  const prefix = String(year) + '-';
  if (source.kind === 'tasks-completed') return (data.kanban?.tasks ?? []).filter((item: any) => item.done === true && new Date(Number(item.completedAt || 0)).getFullYear() === year).length;
  if (source.kind === 'life-inputs') return (data.life?.inputs ?? []).filter((item: any) => String(item.completedMonth || item.createdAt || '').startsWith(String(year))).length;
  if (source.kind === 'inventory-count') return (data.life?.inventory ?? []).filter((item: any) => !['废弃', '转卖'].includes(String(item.status || ''))).reduce((sum: number, item: any) => sum + Math.max(0, asNumber(item.quantity) || 1), 0);
  if (source.kind === 'habits-completed') return Object.entries(data.cmd.habitDaily ?? {}).filter(([date]) => date.startsWith(prefix)).reduce((sum, [, values]) => sum + Object.values(values).reduce((a, b) => a + Math.max(0, asNumber(b)), 0), 0);
  if (source.kind === 'finance-income' || source.kind === 'finance-expense') {
    const expected = source.kind === 'finance-income' ? '收入' : '支出';
    return (Object.values(data.finance?.ledgers ?? {}) as any[]).reduce((sum: number, ledger: any) => sum + (ledger.transactions ?? []).filter((item: any) => String(item.date || '').startsWith(prefix) && String(item.type || item.kind || '') === expected).reduce((subtotal: number, item: any) => subtotal + Math.abs(asNumber(item.amount)), 0), 0);
  }
  return null;
}

export function syncPlanningSources(data: CommandCenterData): boolean {
  const planning = data.cmd.planning;
  if (!planning) return false;
  let changed = false;
  for (const goal of planning.goals) {
    for (const metric of goal.metrics) {
      const value = sourceValue(data, metric.source, goal.year);
      if (value != null && metric.current !== value) { metric.current = value; changed = true; }
    }
  }
  for (const vision of planning.visions) {
    const year = vision.year ?? new Date().getFullYear();
    for (const condition of vision.conditions) {
      const value = sourceValue(data, condition.source, year);
      if (value != null && condition.current !== value) { condition.current = value; changed = true; }
    }
  }
  return changed;
}
