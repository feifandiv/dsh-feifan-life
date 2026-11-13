// 数据存储层（迭代 002）
// 唯一真相源：由 RootStore 读写 vault 内独立主数据。
// 内存持有快照，store 变更通过订阅通知所有视图重渲染。

import type { StoreHost } from '../models/root';
import { Notice } from 'obsidian';
import {
  KanbanData,
  Project,
  Task,
  Subtask,
  Vision,
  Priority,
  ProjectCategory,
  PluginSettings,
  DEFAULT_SETTINGS,
  uid,
  todayStr,
  taskIsDone,
  taskProgress,
  visionRealized,
} from './models';

type Listener = () => void;

export interface ProjectInput {
  name: string;
  category?: ProjectCategory;
  priority?: Priority;
  startDate?: string;
  dueDate?: string;
  description?: string;
  tags?: string[];
}

export interface TaskInput {
  projectId: string | null;
  name: string;
  priority?: Priority;
  dueDate?: string | null;
  note?: string;
  tags?: string[];
  subtasks?: Subtask[];
  done?: boolean;
}

export class KanbanStore {
  private host: StoreHost;
  private data: KanbanData = { version: 1, projects: [], tasks: [], visions: [], settings: { ...DEFAULT_SETTINGS } };
  private listeners: Set<Listener> = new Set();

  constructor(host: StoreHost) {
    this.host = host;
  }

  async load(): Promise<void> {
    const saved = this.host.root.data.kanban as KanbanData | null;
    if (saved != null && !Array.isArray(saved.projects)) {
      new Notice('项目数据结构异常，已停止加载以避免覆盖原文件');
      throw new Error('Invalid project-kanban data structure');
    }
    if (saved && Array.isArray(saved.projects)) {
      this.data = {
        version: saved.version ?? 1,
        projects: saved.projects,
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        visions: Array.isArray(saved.visions) ? saved.visions : [],
        settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
      };
    }
    // 存量迁移：旧 data.json 无 category/tags/subtasks 字段时补默认值（迭代 007/008）
    await this.normalize();
  }

  /** 字段迁移：保证 category/tags/subtasks 存在，避免旧数据读崩（迭代 007/008）。 */
  private async normalize(): Promise<void> {
    let changed = false;
    for (const p of this.data.projects as any[]) {
      if (!p.category) {
        p.category = '个人';
        changed = true;
      }
      if (!Array.isArray(p.tags)) {
        p.tags = [];
        changed = true;
      }
      // 项目状态与思考/备注已从产品中移除，清理存量字段。
      if ('status' in p) {
        delete p.status;
        changed = true;
      }
      if ('thought' in p) {
        delete p.thought;
        changed = true;
      }
    }
    for (const t of this.data.tasks as any[]) {
      if (!Array.isArray(t.subtasks)) {
        t.subtasks = [];
        changed = true;
      }
      if (!Array.isArray(t.tags)) {
        t.tags = [];
        changed = true;
      }
      // 存量迁移（优化）：旧数据用 status 字段，统一转为 done 布尔并剔除 status
      if (typeof t.done !== 'boolean') {
        t.done = t.status === '已完成';
        changed = true;
      }
      if ('status' in t) {
        delete t.status;
        changed = true;
      }
      // 优化-009 迁移：补 archived / completedAt 字段
      if (typeof t.archived !== 'boolean') {
        t.archived = false;
        changed = true;
      }
      if (!('completedAt' in t)) {
        // 存量已完成的任务用 updatedAt 兜底完成时间；未完成的置 null（JSON 保留键，避免反复迁移）
        t.completedAt = taskIsDone(t) ? (typeof t.updatedAt === 'number' ? t.updatedAt : Date.now()) : null;
        changed = true;
      }
      // 增强迁移：补 progressUpdatedAt / progressBaselineDate / progressBaselinePct
      if (!('progressUpdatedAt' in t)) {
        (t as any).progressUpdatedAt = null;
        changed = true;
      }
      if (typeof (t as any).progressBaselineDate !== 'string') {
        (t as any).progressBaselineDate = '';
        changed = true;
      }
      if (typeof (t as any).progressBaselinePct !== 'number') {
        (t as any).progressBaselinePct = 0;
        changed = true;
      }
      // 增强 v2 迁移：补 progressLog 数组（不破坏已有历史；旧任务首次加载时为空，后续随进度变更填充）
      if (!Array.isArray((t as any).progressLog)) {
        (t as any).progressLog = [];
        changed = true;
      }
      // 当日进度基线刷新：基线日期非今天时，把基线置为当前进度（供复盘算"相比昨日推进多少"）
      const bp = taskProgress(t as any).pct;
      if ((t as any).progressBaselineDate !== todayStr()) {
        (t as any).progressBaselineDate = todayStr();
        (t as any).progressBaselinePct = bp;
        changed = true;
      }
    }
    // 迭代 009 迁移：补 visions 数组与每条字段/子项/储蓄默认值
    for (const v of this.data.visions as any[]) {
      if (!v.priority || !['P0', 'P1', 'P2', 'P3'].includes(v.priority)) {
        v.priority = 'P2';
        changed = true;
      }
      if (typeof v.year !== 'number' && v.year !== null) {
        v.year = new Date().getFullYear();
        changed = true;
      }
      if (!Array.isArray(v.subtasks)) {
        v.subtasks = [];
        changed = true;
      }
      if (typeof v.realizedAt === 'undefined') {
        v.realizedAt = null;
        changed = true;
      }
      if (typeof v.createdAt !== 'number') {
        v.createdAt = Date.now();
        changed = true;
      }
      if (typeof v.updatedAt !== 'number') {
        v.updatedAt = typeof v.createdAt === 'number' ? v.createdAt : Date.now();
        changed = true;
      }
      for (const s of v.subtasks as any[]) {
        if (typeof s.id !== 'string') { s.id = uid(); changed = true; }
        if (typeof s.name !== 'string') { s.name = ''; changed = true; }
        if (typeof s.current !== 'number') { s.current = 0; changed = true; }
        if (typeof s.target !== 'number') { s.target = 0; changed = true; }
        if (typeof s.done !== 'boolean') { s.done = false; changed = true; }
      }
      if (v.savings && typeof v.savings === 'object') {
        if (typeof v.savings.current !== 'number') { v.savings.current = 0; changed = true; }
        if (typeof v.savings.target !== 'number') { v.savings.target = 0; changed = true; }
      }
    }
    // v3：默认打开任务看板，同时迁移旧用户的项目看板默认值。
    if (this.data.version < 3) {
      if (this.data.settings?.defaultView === 'project') {
        this.data.settings.defaultView = 'task';
      }
      changed = true;
    }
    this.data.version = Math.max(this.data.version, 3);
    if (changed) await this.save();
  }

  async save(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as KanbanData;
    this.host.root.data.kanban = snapshot;
    await this.host.root.save();
  }


  // ===== 设置（迭代 005） =====
  getSettings(): PluginSettings {
    return this.data.settings ?? { ...DEFAULT_SETTINGS };
  }

  async setSettings(patch: Partial<PluginSettings>): Promise<void> {
    await this.mutate((d) => {
      d.settings = { ...DEFAULT_SETTINGS, ...(d.settings ?? {}), ...patch };
    });
  }

  /** 订阅变更，返回取消订阅函数 */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  /** 统一变更入口：改内存 → 排队保存 → 立即通知 → 等待持久化。
   *  silent=true 时只持久化不广播（用于高频内联编辑，避免整板重渲染丢焦点/频闪）。 */
  async mutate(fn: (d: KanbanData) => void, silent = false): Promise<void> {
    fn(this.data);
    const saved = this.save();
    if (!silent) this.emit();
    await saved;
  }

  // ===== 读取 =====
  getProjects(): Project[] {
    return this.data.projects;
  }
  getTasks(): Task[] {
    return this.data.tasks;
  }
  getProject(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }
  getTask(id: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }
  getTasksOfProject(projectId: string): Task[] {
    return this.data.tasks.filter((t) => t.projectId === projectId);
  }

  // ===== 项目 CRUD =====
  async addProject(input: ProjectInput): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: uid(),
      name: input.name,
      category: input.category ?? '个人', // 新建默认个人（迭代 007）
      priority: input.priority ?? 'P2',
      startDate: input.startDate ?? todayStr(),
      dueDate: input.dueDate ?? '',
      description: input.description ?? '',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await this.mutate((d) => d.projects.push(project));
    return project;
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<void> {
    await this.mutate((d) => {
      const p = d.projects.find((x) => x.id === id);
      if (p) {
        Object.assign(p, patch, { updatedAt: Date.now() });
      }
    });
  }

  async deleteProject(id: string): Promise<void> {
    // 同时解除其任务的归属（变为游离任务），不级联删除任务
    await this.mutate((d) => {
      d.projects = d.projects.filter((p) => p.id !== id);
      d.tasks.forEach((t) => {
        if (t.projectId === id) t.projectId = null;
      });
    });
  }

  // ===== 任务 CRUD =====
  async addTask(input: TaskInput): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      id: uid(),
      projectId: input.projectId,
      name: input.name,
      priority: input.priority ?? 'P2',
      dueDate: input.dueDate ?? null,
      note: input.note ?? '',
      tags: input.tags ?? [],
      subtasks: input.subtasks ?? [],
      done: input.done ?? false,
      completedAt: input.done ? now : null, // 新建即标记完成时写完成时间（优化-009）
      archived: false, // 优化-009
      progressUpdatedAt: null, // 增强：进度尚未变更
      progressBaselineDate: todayStr(), // 增强：当日基线
      progressBaselinePct: 0, // 增强：下方按实际进度刷新
      progressLog: [], // 增强 v2：每日进度历史，随进度变更 upsert
      createdAt: now,
      updatedAt: now,
    };
    // 增强：新建任务把当日进度基线置为当前进度
    task.progressBaselinePct = taskProgress(task).pct;
    await this.mutate((d) => d.tasks.push(task));
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    await this.mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      const wasDone = taskIsDone(t);
      const wasPct = taskProgress(t).pct;
      Object.assign(t, patch, { updatedAt: Date.now() });
      // 详情弹窗改子项 done 也会经此落库，需同步 completedAt / archived（优化-009）
      this.applyCompletion(t, wasDone, taskIsDone(t));
      // 增强：进度 pct 真正变化才写 progressUpdatedAt（区别于 updatedAt）
      this.applyProgress(t, wasPct, taskProgress(t).pct);
    });
  }

  /** 更新单个子项（迭代 008）：patch 可含 name/target/current/done。
   *  silent=true 时不广播（内联「当前」输入框高频编辑用，避免整板重渲染）；
   *  但若本次改动导致任务完成态发生翻转（全部子项完成 / 取消最后一个），则强制广播，
   *  以便看板即时把任务置灰、沉底、折叠（优化-009）。 */
  async updateSubtask(
    taskId: string,
    subId: string,
    patch: Partial<Subtask>,
    silent = false,
  ): Promise<void> {
    // 预判是否会发生完成态翻转，决定最终是否广播
    const t0 = this.getTask(taskId);
    const s0 = t0?.subtasks?.find((y) => y.id === subId);
    let willTransition = false;
    if (t0 && s0) {
      const wasDone = taskIsDone(t0);
      const trial: Task = {
        ...t0,
        subtasks: t0.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
      };
      willTransition = wasDone !== taskIsDone(trial);
    }
    const effectiveSilent = silent && !willTransition;
    await this.mutate((d) => {
      const t = d.tasks.find((x) => x.id === taskId);
      const s = t?.subtasks?.find((y) => y.id === subId);
      if (!t || !s) return;
      const wasDone = taskIsDone(t);
      const wasPct = taskProgress(t).pct;
      Object.assign(s, patch);
      this.applyCompletion(t, wasDone, taskIsDone(t));
      // 增强：子项 current/target/done 变动都会改进度，此处精确记录
      this.applyProgress(t, wasPct, taskProgress(t).pct);
    }, effectiveSilent);
  }

  /** 标记任务完成（优化）：有子项则置全部子项 done；否则置 done。
   *  完成态翻转时同步 completedAt / archived（优化-009）。 */
  async setTaskDone(id: string, done: boolean): Promise<void> {
    await this.mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      const wasDone = taskIsDone(t);
      const wasPct = taskProgress(t).pct;
      const subs = t.subtasks ?? [];
      if (subs.length > 0) subs.forEach((s) => (s.done = done));
      else t.done = done;
      this.applyCompletion(t, wasDone, taskIsDone(t));
      // 增强：完成态翻转必伴随进度变化（0↔100），此处精确记录
      this.applyProgress(t, wasPct, taskProgress(t).pct);
    });
  }

  /** 完成态翻转处理（优化-009）：
   *  未完成→完成：写 completedAt=now，重置 archived=false（重新进入归档计时）；
   *  完成→未完成：清 completedAt=null，archived=false（回到活跃）。 */
  private applyCompletion(t: Task, wasDone: boolean, nowDone: boolean): void {
    if (!wasDone && nowDone) {
      t.completedAt = Date.now();
      t.archived = false;
    } else if (wasDone && !nowDone) {
      t.completedAt = null;
      t.archived = false;
    }
  }

  /** 进度变更处理（增强 v2）：taskProgress 的 pct 真正变化时：
   *  1) 写 progressUpdatedAt=now（保留：最近一次变更时刻）；
   *  2) upsert 当日条目进 progressLog（逐日历史，供复盘查询任意过去日期的推进量）。
   *  与 updatedAt 不同——改名/改备注/改优先级等不影响进度的编辑不会触发，
   *  从而使复盘脚本能精确抓到"纯粹进度变化"，且 Obsidian 重载不丢历史。 */
  private applyProgress(t: Task, wasPct: number, nowPct: number): void {
    if (wasPct === nowPct) return;
    t.progressUpdatedAt = Date.now();
    const d = todayStr();
    const log = (t.progressLog ??= []);
    const idx = log.findIndex((e) => e.date === d);
    if (idx >= 0) log[idx].pct = nowPct;
    else log.push({ date: d, pct: nowPct });
  }

  /** 自动归档（优化-009）：完成且 completedAt 距今 ≥ days 的任务标 archived=true。
   *  仅隐藏、不删数据。无符合条件者时为空操作，不触发持久化。 */
  async archiveDueTasks(days = 30): Promise<void> {
    const settings = this.getSettings();
    const span = (typeof settings.archiveAfterDays === 'number' && settings.archiveAfterDays > 0)
      ? settings.archiveAfterDays
      : days;
    const threshold = Date.now() - span * 24 * 60 * 60 * 1000;
    const hasTarget = this.data.tasks.some(
      (t) => !t.archived && taskIsDone(t) && typeof t.completedAt === 'number' && t.completedAt <= threshold,
    );
    if (!hasTarget) return;
    await this.mutate((d) => {
      for (const t of d.tasks) {
        if (t.archived) continue;
        if (taskIsDone(t) && typeof t.completedAt === 'number' && t.completedAt <= threshold) {
          t.archived = true;
        }
      }
    });
  }

  async deleteTask(id: string): Promise<void> {
    await this.mutate((d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id);
    });
  }

  // ===== 愿景里程碑 CRUD（迭代 009） =====
  getVisions(): Vision[] {
    return this.data.visions;
  }
  getVision(id: string): Vision | undefined {
    return this.data.visions.find((v) => v.id === id);
  }

  async addVision(input: Partial<Vision>): Promise<Vision> {
    const now = Date.now();
    const vision: Vision = {
      id: uid(),
      name: input.name ?? '未命名愿景',
      emoji: input.emoji,
      priority: input.priority ?? 'P2',
      year: typeof input.year === 'number' ? input.year : input.year === null ? null : new Date().getFullYear(),
      note: input.note ?? '',
      savings: input.savings,
      subtasks: input.subtasks ?? [],
      realizedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.mutate((d) => d.visions.push(vision));
    return vision;
  }

  async updateVision(id: string, patch: Partial<Vision>): Promise<void> {
    await this.mutate((d) => {
      const v = d.visions.find((x) => x.id === id);
      if (!v) return;
      const wasRealized = visionRealized(v);
      Object.assign(v, patch, { updatedAt: Date.now() });
      this.applyRealization(v, wasRealized, visionRealized(v));
    });
  }

  async deleteVision(id: string): Promise<void> {
    await this.mutate((d) => {
      d.visions = d.visions.filter((v) => v.id !== id);
    });
  }

  async addSubtask(visionId: string, sub?: Partial<Subtask>): Promise<void> {
    await this.mutate((d) => {
      const v = d.visions.find((x) => x.id === visionId);
      if (!v) return;
      const wasRealized = visionRealized(v);
      v.subtasks = v.subtasks ?? [];
      v.subtasks.push({
        id: uid(),
        name: sub?.name ?? '',
        target: sub?.target ?? 0,
        current: sub?.current ?? 0,
        done: sub?.done ?? false,
        unit: sub?.unit,
      });
      v.updatedAt = Date.now();
      this.applyRealization(v, wasRealized, visionRealized(v));
    });
  }

  /** 更新单个达成子项（仿任务子项）：silent=true 时不广播（内联「当前」高频编辑用）。
   *  但若本次改动导致实现态翻转（全部完成 / 取消最后一个），则强制广播，以便看板即时置灰沉底。 */
  async updateVisionSubtask(visionId: string, subId: string, patch: Partial<Subtask>, silent = false): Promise<void> {
    const v0 = this.getVision(visionId);
    const s0 = v0?.subtasks?.find((y) => y.id === subId);
    let willTransition = false;
    if (v0 && s0) {
      const wasRealized = visionRealized(v0);
      const trial: Vision = {
        ...v0,
        subtasks: v0.subtasks.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
      };
      willTransition = wasRealized !== visionRealized(trial);
    }
    const effectiveSilent = silent && !willTransition;
    await this.mutate((d) => {
      const v = d.visions.find((x) => x.id === visionId);
      const s = v?.subtasks?.find((y) => y.id === subId);
      if (!v || !s) return;
      const wasRealized = visionRealized(v);
      Object.assign(s, patch);
      v.updatedAt = Date.now();
      this.applyRealization(v, wasRealized, visionRealized(v));
    }, effectiveSilent);
  }

  async removeSubtask(visionId: string, subId: string): Promise<void> {
    await this.mutate((d) => {
      const v = d.visions.find((x) => x.id === visionId);
      if (!v) return;
      const wasRealized = visionRealized(v);
      v.subtasks = (v.subtasks ?? []).filter((s) => s.id !== subId);
      v.updatedAt = Date.now();
      this.applyRealization(v, wasRealized, visionRealized(v));
    });
  }

  /** 记录储蓄当前值（内联编辑走 silent；达成 100% 翻转实现态时强制广播）。 */
  async setSavingsCurrent(visionId: string, current: number, silent = false): Promise<void> {
    const v0 = this.getVision(visionId);
    let willTransition = false;
    if (v0 && v0.savings) {
      const wasRealized = visionRealized(v0);
      const trial: Vision = { ...v0, savings: { ...v0.savings, current } };
      willTransition = wasRealized !== visionRealized(trial);
    }
    const effectiveSilent = silent && !willTransition;
    await this.mutate((d) => {
      const v = d.visions.find((x) => x.id === visionId);
      if (!v || !v.savings) return;
      const wasRealized = visionRealized(v);
      v.savings = { ...v.savings, current };
      v.updatedAt = Date.now();
      this.applyRealization(v, wasRealized, visionRealized(v));
    }, effectiveSilent);
  }

  /** 愿景实现态翻转处理（迭代 009）：
   *  未实现→实现：写 realizedAt=now；实现→未实现：清 realizedAt=null。 */
  private applyRealization(v: Vision, wasRealized: boolean, nowRealized: boolean): void {
    if (!wasRealized && nowRealized) {
      v.realizedAt = Date.now();
    } else if (wasRealized && !nowRealized) {
      v.realizedAt = null;
    }
  }

  // ===== 危险操作 =====
  async clear(): Promise<void> {
    await this.mutate((d) => {
      d.projects = [];
      d.tasks = [];
    });
  }
}
