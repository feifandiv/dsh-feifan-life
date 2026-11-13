import type { App } from 'obsidian';
// 数据模型与进度计算（迭代 002）
// 类型定义严格对齐 00-设计文档.md 第三节。

export type TaskStatus = '待办' | '进行中' | '已完成';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
// 分类轴（生活领域 / 归属）：比状态轴稳定，作为看板列（迭代 007）。
// 决策：用「个人 / 事业 / 工作」，兑吧降级为 tags 子标签（换工作不失真）。
export type ProjectCategory = '个人' | '事业' | '工作';

export interface Project {
  id: string;
  name: string;
  category: ProjectCategory; // 分类泳道（迭代 007）；默认「个人」
  priority: Priority;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  description: string;
  tags: string[]; // 交叉主题补充（迭代 007）
  createdAt: number;
  updatedAt: number;
}

// 子项 + 量化目标（迭代 008 / 优化 005）：每个子项有目标值、当前进度、单位，可标记完成。
export interface Subtask {
  id: string;
  name: string;
  target: number; // 量化目标（如 100、30、25）
  current: number; // 当前进度（默认 0）
  done: boolean; // 是否标记完成
  unit?: string; // 单位（如 次、篇、元、分钟），仅用于展示，不影响进度计算（优化 005）
}

export interface Task {
  id: string;
  projectId: string | null; // null = 游离零散任务
  name: string;
  priority: Priority;
  dueDate: string | null;
  note: string; // 任务级备注/思考
  tags: string[]; // 交叉主题补充（迭代 007）
  subtasks: Subtask[]; // 子项 + 量化目标（迭代 008）
  done: boolean; // 完成标记（优化：取消显式状态，进度 0=未开始/100=完成，由 done + 子项推导）
  completedAt: number | null; // 完成时间戳（优化-009）：未完成为 null；标记完成时写 Date.now()，取消完成清零
  archived: boolean; // 自动归档标记（优化-009）：完成超过阈值后=true，仅隐藏不删数据
  // 进度变更追踪（增强）：区别于 updatedAt——只在 taskProgress 的 pct 真正变化时写，
  // 用于复盘精确抓"纯粹进度变化"并显示"相比昨日推进多少"。
  progressUpdatedAt: number | null; // 进度最后变更时间戳 ms；进度未变过为 null
  progressBaselineDate: string; // 当日进度基线日期 YYYY-MM-DD（plugin 加载/跨日刷新）
  progressBaselinePct: number; // 当日进度基线 pct（刷新时为当时的 taskProgress）
  // 每日进度历史（增强 v2）：进度 pct 每次真正变化时 upsert 当日条目。
  // 区别于 progressUpdatedAt（只记最后一次）——本数组保留逐日历史，使复盘脚本能查询
  // 任意过去日期「当天推进了多少」，且 Obsidian 重载不会丢失历史。
  progressLog: { date: string; pct: number }[];
  createdAt: number;
  updatedAt: number;
}

// ===== 愿景里程碑（迭代 009）：统一一种实体，储蓄条件 A 可选，达成条件 B 为量化子项 =====
// 储蓄条件（可选；不填 savings = 纯愿景；填了 = 奖励）
export interface VisionSavings {
  target: number; // 储蓄目标额
  current: number; // 当前已储蓄（手动每次记录累加）
  unit?: string; // 默认 '元'
}

// 直接复用现有 Subtask（name/target/current/unit/done）作为「达成」子项
export interface Vision {
  id: string;
  name: string;
  emoji?: string; // 可选图标，增强观感（不强制）
  priority: Priority; // 愿景的推进优先级，不等同于任务紧急度
  year: number | null; // 所属年份；null 表示长期保留
  note?: string;
  savings?: VisionSavings; // 可选：不填 = 愿景；填了 = 奖励
  subtasks: Subtask[]; // 达成条件（复用现有 Subtask 量化范式）
  realizedAt: number | null; // 实现时间戳；未实现 null
  createdAt: number;
  updatedAt: number;
}

export interface KanbanData {
  version: number;
  projects: Project[];
  tasks: Task[];
  visions: Vision[]; // 迭代 009：愿景里程碑
  settings?: PluginSettings;
}

// ===== 插件设置（迭代 005） =====
export interface PluginSettings {
  vaultPath: string; // 落库镜像目录（相对库根），默认 02-长期领域/03任务看板
  defaultView: 'project' | 'task' | 'vision'; // 打开时默认页签
  archiveAfterDays: number; // 完成超过该天数自动归档（优化-009），默认 30
  showArchived: boolean; // 是否显示已归档任务（优化-009），默认 false
}

export interface KanbanFocusBridge {
  isPinned(taskId: string, subtaskId?: string): boolean;
  toggle(taskId: string, subtaskId?: string): boolean;
}

export interface KanbanCtx { store: any; app: App; focus?: KanbanFocusBridge }

export const DEFAULT_SETTINGS: PluginSettings = {
  vaultPath: '02-长期领域/03任务看板',
  defaultView: 'task',
  archiveAfterDays: 30,
  showArchived: false,
};

// ===== 枚举与常量 =====
export const TASK_STATUSES: TaskStatus[] = ['待办', '进行中', '已完成'];
export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];
// 分类泳道（迭代 007）：稳定的生活领域轴，作为项目看板的三列。
export const PROJECT_CATEGORIES: ProjectCategory[] = ['个人', '事业', '工作'];

// 优先级展示元信息（兜底，主色仍由 CSS 变量驱动）
export const PRIORITY_LABEL: Record<Priority, string> = {
  P0: '紧急',
  P1: '高',
  P2: '中',
  P3: '低',
};

// ===== 工具函数 =====
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 将时间戳格式化为本地 YYYY-MM-DD（优化-009：用本地时区，避免 UTC 跨日偏差）
export function dateStrOf(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 是否于今日完成（优化-009）：驱动顶部「今日完成 N」条
export function isCompletedToday(t: Task): boolean {
  return t.completedAt != null && dateStrOf(t.completedAt) === todayStr();
}

export function tasksOfProject(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.projectId === projectId);
}

// 解析标签：逗号/空格/顿号分隔，去空去重（迭代 007）。
export function parseTags(s: string | undefined): string[] {
  if (!s) return [];
  return Array.from(
    new Set(
      s
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

export interface Progress {
  done: number;
  total: number;
  pct: number; // 0..100；total=0 时 pct=0（用 total 判断「无任务」）
}

export function projectProgress(tasks: Task[], projectId: string): Progress {
  const list = tasksOfProject(tasks, projectId);
  const total = list.length;
  const done = list.filter(taskIsDone).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

// ===== 子项与任务完成判定（迭代 008） =====
export function taskSubtasks(t: Task): Subtask[] {
  return t.subtasks ?? [];
}

// 子项有效完成：量化子项=done 或当前值达标；非量化子项=done 勾选。
export function subtaskComplete(s: Subtask): boolean {
  if (s.target > 0) return s.done || (s.current || 0) >= s.target;
  return s.done;
}

// 子项完成度（0..1）：量化按 current/target；非量化按 done 二值；done 勾选恒为 1。
export function subtaskFraction(s: Subtask): number {
  if (s.target > 0) return s.done ? 1 : Math.min(1, (s.current || 0) / s.target);
  return s.done ? 1 : 0;
}

// 任务完成：有子项时=全部子项有效完成；无子项时=done 标记。
export function taskIsDone(t: Task): boolean {
  const subs = taskSubtasks(t);
  if (subs.length > 0) return subs.every(subtaskComplete);
  return t.done;
}

// 任务进度：每个子项等权贡献其完成度（量化=current/target，非量化=done 二值），取平均；
// 无子项按 done 二值（0 / 100）。这样量化与非量化子项都计入进度，混合任务须全部子项完成
// 进度才达 100%（修复：旧逻辑只按 current/target 求和，非量化子项 target=0 被完全忽略，
// 导致量化子项满即任务 100%）。
export function taskProgress(t: Task): Progress {
  const subs = taskSubtasks(t);
  if (subs.length > 0) {
    const total = subs.length;
    const done = subs.filter(subtaskComplete).length;
    const sum = subs.reduce((a, s) => a + subtaskFraction(s), 0);
    const pct = total === 0 ? 0 : Math.min(100, Math.round((sum / total) * 100));
    return { done, total, pct };
  }
  const done = t.done ? 1 : 0;
  const pct = t.done ? 100 : 0;
  return { done, total: 1, pct };
}

// 子项排序：未完成项按完成度降序，已完成项统一沉底；同完成度保留录入顺序。
export function subtaskSort(a: Subtask, b: Subtask): number {
  const completeA = subtaskComplete(a) ? 1 : 0;
  const completeB = subtaskComplete(b) ? 1 : 0;
  if (completeA !== completeB) return completeA - completeB;
  const progressDifference = subtaskFraction(b) - subtaskFraction(a);
  return Math.abs(progressDifference) > 1e-9 ? progressDifference : 0;
}

export function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return due < todayStr();
}

// 项目不再维护状态轴：按优先级、截止日排序。
export function projectSort(a: Project, b: Project): number {
  const pa = PRIORITIES.indexOf(a.priority);
  const pb = PRIORITIES.indexOf(b.priority);
  if (pa !== pb) return pa - pb;
  return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
}

// 任务排序（优化-009 调整）：
//   0) 归档任务沉到最底（archived）；
//   1) 已完成的沉到本列底部（done）；
//   2) 活跃任务：优先级高者在上（P0 > P1 > P2 > P3）；
//   3) 优先级相同 → 完成度越高越靠上；
//   4) 完成度相同 → 先建立的在上（createdAt 升序）。
function taskRank(t: Task): number {
  if (t.archived) return 2;
  if (taskIsDone(t)) return 1;
  return 0;
}

export function taskSort(a: Task, b: Task): number {
  const ra = taskRank(a);
  const rb = taskRank(b);
  if (ra !== rb) return ra - rb; // 活跃 > 已完成 > 归档，逐级沉底
  const pa = PRIORITIES.indexOf(a.priority);
  const pb = PRIORITIES.indexOf(b.priority);
  if (pa !== pb) return pa - pb;
  const pctA = taskProgress(a).pct;
  const pctB = taskProgress(b).pct;
  if (pctA !== pctB) return pctB - pctA; // 完成度越高越靠上
  return a.createdAt - b.createdAt; // 同完成度：先建立的在上
}

// 任务派生状态（优化：取消显式 status，由进度推导）
export function taskStatusLabel(t: Task): string {
  const p = taskProgress(t).pct;
  if (p >= 100) return '已完成';
  if (p <= 0) return '未开始';
  return '进行中';
}

// ===== 愿景里程碑判定（迭代 009） =====
function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// 储蓄完成度（无储蓄 = 100，视为已满足）
export function visionSavingsPct(v: Vision): number {
  if (!v.savings) return 100;
  const { target, current } = v.savings;
  if (target <= 0) return 0;
  return clampPct(Math.round((current / target) * 100));
}

// 达成子项完成度：每个子项等权贡献其完成度（量化=current/target，非量化=done 二值），取平均；
// 无子项 = 0。与任务进度 taskProgress 同算法，避免非量化子项(target=0)被忽略导致错算为 100%。
export function visionSubtasksPct(v: Vision): number {
  const subs = v.subtasks ?? [];
  if (subs.length === 0) return 0;
  const sum = subs.reduce((a, s) => a + subtaskFraction(s), 0);
  return clampPct(Math.round((sum / subs.length) * 100));
}

// 整体完成度：A、B 两块均值（仅含存在的块）
export function visionOverallPct(v: Vision): number {
  const parts: number[] = [];
  if (v.savings) parts.push(visionSavingsPct(v));
  if (v.subtasks && v.subtasks.length > 0) parts.push(visionSubtasksPct(v));
  if (parts.length === 0) return 0;
  return clampPct(Math.round(parts.reduce((a, b) => a + b, 0) / parts.length));
}

// 愿景排序：储蓄进度优先（无储蓄按 50%），再按已完成达成条件数量，最后按创建顺序。
export function visionSort(a: Vision, b: Vision): number {
  const savingsA = a.savings ? visionSavingsPct(a) : 50;
  const savingsB = b.savings ? visionSavingsPct(b) : 50;
  if (savingsA !== savingsB) return savingsB - savingsA;
  const completedA = (a.subtasks ?? []).filter(subtaskComplete).length;
  const completedB = (b.subtasks ?? []).filter(subtaskComplete).length;
  if (completedA !== completedB) return completedB - completedA;
  return a.createdAt - b.createdAt;
}

// 是否实现：储蓄(若有)达标 且 达成子项(必含，且全部有效完成)
export function visionRealized(v: Vision): boolean {
  const savingsOk = !v.savings || v.savings.current >= v.savings.target;
  const subs = v.subtasks ?? [];
  const subsOk = subs.length > 0 && subs.every(subtaskComplete);
  return savingsOk && subsOk;
}

// 是否于今日实现（驱动「今日实现 N」条）
export function isRealizedToday(v: Vision): boolean {
  return v.realizedAt != null && dateStrOf(v.realizedAt) === todayStr();
}

// 派生徽章：有储蓄 = 奖励；否则 = 愿景（无需存字段）
export function visionBadge(v: Vision): string {
  return v.savings ? '奖励' : '愿景';
}
