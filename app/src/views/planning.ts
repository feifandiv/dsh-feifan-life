import { Notice, setIcon } from "obsidian";
import { FfModal as Modal } from "../design-system/modal";
import type CommandCenterPlugin from '../main';
import { priorityPill } from '../kanban/components';
import type {
  PlanningCondition,
  PlanningEvidence,
  PlanningGoal,
  PlanningMetric,
  PlanningPeriod,
  PlanningPriority,
  PlanningSourceKind,
  PlanningVision,
} from '../models/root';
import {
  adjustedPlan,
  conditionComplete,
  emptyMonths,
  evenPlan,
  manualSource,
  planningId,
  planningProgress,
  PLANNING_PRIORITIES,
  PLANNING_SOURCE_OPTIONS,
  sourceValue,
  syncPlanningSources,
  visionReady,
} from '../planning/model';

export type PlanningView = 'goals' | 'visions';

let activeView: PlanningView = 'goals';
let selectedYear = new Date().getFullYear();
const openGoals = new Set<string>();
const openVisions = new Set<string>();
const planDisplay = new Map<string, 'original' | 'current'>();
const selectedMetrics = new Map<string, string>();

export function selectPlanningView(view: PlanningView | 'annual' | 'vision', year?: number | null): void {
  activeView = view === 'annual' ? 'goals' : view === 'vision' ? 'visions' : view;
  if (Number.isFinite(Number(year))) selectedYear = Number(year);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function fmt(value: number, digits = 1): string {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function iconButton(parent: HTMLElement, icon: string, title: string, cls = 'cc-plan-icon-button'): HTMLButtonElement {
  const button = parent.createEl('button', { cls, attr: { type: 'button', title, 'aria-label': title } });
  setIcon(button, icon);
  return button;
}

function primaryButton(parent: HTMLElement, label: string, icon?: string): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'cc-plan-primary', attr: { type: 'button' } });
  if (icon) setIcon(button.createSpan(), icon);
  button.createSpan({ text: label });
  return button;
}

function progressTrack(parent: HTMLElement, value: number): HTMLElement {
  const track = parent.createSpan({ cls: 'cc-plan-track' });
  track.createSpan({ attr: { style: `width:${pct(value)}%` } });
  return track;
}

function renderPriority(parent: HTMLElement, priority: PlanningPriority): void {
  const pill = priorityPill(priority);
  pill.addClass('cc-plan-record-priority');
  parent.appendChild(pill);
}

function renderActualTarget(parent: HTMLElement, current: number, target: number, unit: string, name: string, onChange?: (value: number) => void): void {
  const values = parent.createDiv({ cls: 'cc-plan-actual-target' });
  if (onChange) {
    const input = values.createEl('input', { cls: 'cc-plan-number-input', attr: { type: 'number', min: '0', step: 'any', 'aria-label': name + '实际完成' } });
    input.value = String(current);
    input.addEventListener('change', () => {
      const value = Math.max(0, number(input.value));
      input.value = String(value);
      onChange(value);
    });
  } else values.createSpan({ cls: 'cc-plan-actual-readonly', text: fmt(current) });
  values.createSpan({ cls: 'cc-plan-value-divider', text: '/' });
  values.createSpan({ cls: 'cc-plan-target-value', text: `${fmt(target)} ${unit}`.trim() });
}

function renderRowProgress(parent: HTMLElement, value: number): void {
  const progress = parent.createDiv({ cls: 'cc-plan-row-progress' });
  progressTrack(progress, value);
  progress.createSpan({ cls: 'cc-plan-row-percent', text: `${Math.round(pct(value))}%` });
}

function priorityRank(value: PlanningPriority): number {
  const rank = PLANNING_PRIORITIES.indexOf(value);
  return rank < 0 ? 99 : rank;
}

function goalCurrent(goal: PlanningGoal, metric: PlanningMetric, plugin: CommandCenterPlugin): number {
  return sourceValue(plugin.stores.root.data, metric.source, goal.year) ?? number(metric.current);
}

function metricProgress(goal: PlanningGoal, metric: PlanningMetric, plugin: CommandCenterPlugin): number {
  return metric.target > 0 ? goalCurrent(goal, metric, plugin) / metric.target * 100 : 0;
}

function goalProgressWithSources(goal: PlanningGoal, plugin: CommandCenterPlugin): number {
  const clone: PlanningGoal = { ...goal, metrics: goal.metrics.map((metric) => ({ ...metric, current: goalCurrent(goal, metric, plugin) })) };
  return planningProgress(clone);
}

function renderToolbar(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const toolbar = host.createDiv({ cls: 'cc-plan-toolbar' });
  const brand = toolbar.createDiv({ cls: 'cc-plan-brand' });
  const brandIcon = brand.createSpan({ cls: 'cc-plan-brand-icon' });
  setIcon(brandIcon, 'compass');
  brand.createSpan({ text: '规划' });

  const tabs = toolbar.createDiv({ cls: 'cc-plan-tabs', attr: { 'aria-label': '规划类型' } });
  for (const [view, label] of [['goals', '年度目标'], ['visions', '愿景与奖励']] as Array<[PlanningView, string]>) {
    const button = tabs.createEl('button', { cls: 'cc-plan-tab' + (activeView === view ? ' is-active' : ''), text: label, attr: { type: 'button' } });
    button.addEventListener('click', () => { activeView = view; renderPlanningPanel(host.parentElement ?? host, plugin); });
  }

  const actions = toolbar.createDiv({ cls: 'cc-plan-toolbar-actions' });
  iconButton(actions, 'chevron-left', '上一年').addEventListener('click', () => { selectedYear -= 1; renderPlanningPanel(host.parentElement ?? host, plugin); });
  actions.createEl('strong', { cls: 'cc-plan-year', text: String(selectedYear) });
  iconButton(actions, 'chevron-right', '下一年').addEventListener('click', () => { selectedYear += 1; renderPlanningPanel(host.parentElement ?? host, plugin); });
  const add = primaryButton(actions, activeView === 'goals' ? '新建目标' : '新建愿景', 'plus');
  add.addEventListener('click', () => {
    if (activeView === 'goals') new GoalModal(plugin, selectedYear).open();
    else new VisionModal(plugin, selectedYear).open();
  });
}

function renderOverview(host: HTMLElement, label: string, count: number, secondaryLabel: string, secondary: string, progress: number): void {
  const overview = host.createDiv({ cls: 'cc-plan-overview' });
  const first = overview.createDiv();
  first.createSpan({ cls: 'cc-plan-overview-label', text: label });
  first.createEl('strong', { text: count + ' 项' });
  const second = overview.createDiv();
  second.createSpan({ cls: 'cc-plan-overview-label', text: secondaryLabel });
  second.createEl('strong', { text: secondary });
  const progressBox = overview.createDiv({ cls: 'cc-plan-overview-progress' });
  const copy = progressBox.createSpan();
  copy.createSpan({ cls: 'cc-plan-overview-label', text: activeView === 'goals' ? '综合进度' : '条件完成' });
  copy.createEl('strong', { text: Math.round(progress) + '%' });
  progressTrack(progressBox, progress);
}

export function renderPlanningPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const panel = (host.querySelector('[data-panel="planning"]') as HTMLElement | null) ?? host;
  panel.empty();
  panel.addClass('cc-plan');
  if (syncPlanningSources(plugin.stores.root.data)) void plugin.stores.root.save();
  renderToolbar(panel, plugin);
  const main = panel.createDiv({ cls: 'cc-plan-main' });
  if (activeView === 'goals') renderGoals(main, plugin);
  else renderVisions(main, plugin);
}

function renderEmpty(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const empty = host.createDiv({ cls: 'cc-plan-empty-year' });
  setIcon(empty.createSpan(), 'calendar-range');
  empty.createEl('strong', { text: `${selectedYear} 年还没有${activeView === 'goals' ? '年度目标' : '愿景或奖励'}` });
  const add = primaryButton(empty, '新建第一项', 'plus');
  add.addEventListener('click', () => activeView === 'goals' ? new GoalModal(plugin, selectedYear).open() : new VisionModal(plugin, selectedYear).open());
}

function renderGoals(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const planning = plugin.stores.root.data.cmd.planning!;
  const goals = planning.goals
    .filter((goal) => goal.year === selectedYear)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || goalProgressWithSources(b, plugin) - goalProgressWithSources(a, plugin) || a.createdAt - b.createdAt);
  const overall = goals.length ? goals.reduce((sum, goal) => sum + goalProgressWithSources(goal, plugin), 0) / goals.length : 0;
  const onTrack = goals.filter((goal) => goalProgressWithSources(goal, plugin) >= expectedProgress(goal.year)).length;
  renderOverview(host, '年度目标', goals.length, '按计划推进', onTrack + ' 项', overall);
  if (!goals.length) { renderEmpty(host, plugin); return; }
  const list = host.createDiv({ cls: 'cc-plan-record-list cc-plan-goal-list' });
  renderPlanListHead(list, ['', '目标', '优先级', '完成情况', '编辑'], 'cc-plan-goal-list-head');
  for (const goal of goals) renderGoal(list, goal, plugin);
}

function expectedProgress(year: number): number {
  const now = new Date();
  if (year < now.getFullYear()) return 100;
  if (year > now.getFullYear()) return 0;
  return ((now.getMonth() + 1) / 12) * 100;
}

function toggleExpandable(target: HTMLElement, id: string, set: Set<string>, rerender: () => void): void {
  target.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button,input,select,textarea')) return;
    set.has(id) ? set.delete(id) : set.add(id);
    rerender();
  });
  target.addEventListener('keydown', (event) => {
    if ((event.target as HTMLElement).closest('button,input,select,textarea')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    set.has(id) ? set.delete(id) : set.add(id);
    rerender();
  });
}

function renderPlanListHead(parent: HTMLElement, labels: string[], cls = ''): void {
  const head = parent.createDiv({ cls: `cc-plan-list-head ${cls}`.trim() });
  labels.forEach((label) => head.createSpan({ text: label }));
}

function renderGoal(parent: HTMLElement, goal: PlanningGoal, plugin: CommandCenterPlugin): void {
  const isOpen = openGoals.has(goal.id);
  const progress = goalProgressWithSources(goal, plugin);
  const card = parent.createEl('article', { cls: 'cc-plan-record cc-plan-goal' + (isOpen ? ' is-open' : '') });
  const head = card.createDiv({ cls: 'cc-plan-record-head cc-plan-goal-head', attr: { role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) } });
  toggleExpandable(head, goal.id, openGoals, () => renderPlanningPanel(card.closest('[data-panel="planning"]') as HTMLElement ?? card.parentElement!, plugin));
  const chevron = iconButton(head, 'chevron-right', isOpen ? '收起' : '展开', 'cc-plan-icon-button cc-plan-record-expand cc-plan-chevron');
  chevron.addEventListener('click', (event) => {
    event.stopPropagation();
    isOpen ? openGoals.delete(goal.id) : openGoals.add(goal.id);
    renderPlanningPanel(card.closest('[data-panel="planning"]') as HTMLElement ?? card.parentElement!, plugin);
  });
  const copy = head.createDiv({ cls: 'cc-plan-record-copy' });
  const title = copy.createDiv({ cls: 'cc-plan-title-line' });
  title.createEl('h3', { text: goal.name });
  title.createSpan({ cls: 'cc-plan-mode' + (goal.mode === 'cumulative' ? ' is-free' : ''), text: goal.mode === 'adaptive' ? '自适应计划' : '自由累计' });
  const meta = copy.createDiv({ cls: 'cc-plan-title-meta' });
  meta.createSpan({ text: goal.period === 'annual' ? '年度' : goal.period === 'monthly' ? '月度' : '自定义周期' });
  meta.createSpan({ text: goal.achievementRule === 'sum' ? '总量达成' : '全部指标达成' });
  if (goal.needsReview?.length) meta.createSpan({ cls: 'cc-plan-review-flag', text: '待确认年份' });
  renderPriority(head, goal.priority);
  const progressBox = head.createDiv({ cls: 'cc-plan-goal-progress' });
  progressTrack(progressBox, progress);
  const totalTarget = goal.metrics.reduce((sum, metric) => sum + metric.target, 0);
  const totalCurrent = goal.metrics.reduce((sum, metric) => sum + goalCurrent(goal, metric, plugin), 0);
  const sameUnit = new Set(goal.metrics.map((metric) => metric.unit)).size <= 1;
  progressBox.createSpan({ cls: 'cc-plan-progress-copy', text: sameUnit && goal.metrics.length ? `${fmt(totalCurrent)} / ${fmt(totalTarget)} ${goal.metrics[0].unit}` : `${Math.round(progress)}%` });
  const actions = head.createDiv({ cls: 'cc-plan-record-actions' });
  const edit = iconButton(actions, 'pencil', '编辑目标', 'cc-plan-icon-button cc-plan-row-action');
  edit.addEventListener('click', (event) => { event.stopPropagation(); new GoalModal(plugin, selectedYear, goal).open(); });
  const remove = iconButton(actions, 'trash-2', '删除目标', 'cc-plan-icon-button cc-plan-row-action cc-plan-danger-action');
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!window.confirm(`确定删除年度目标「${goal.name}」？`)) return;
    void plugin.stores.root.mutate((data) => { if (data.cmd.planning) data.cmd.planning.goals = data.cmd.planning.goals.filter((item) => item.id !== goal.id); });
  });
  if (!isOpen) return;

  const body = card.createDiv({ cls: 'cc-plan-goal-body' });
  const controls = body.createDiv({ cls: 'cc-plan-goal-controls' });
  if (goal.mode === 'adaptive') {
    const toggleLabel = controls.createEl('label', { cls: 'cc-plan-toggle-label' });
    const toggle = toggleLabel.createEl('button', { cls: 'cc-plan-toggle', attr: { type: 'button', 'aria-pressed': String(goal.autoAdjust), title: '自动重分配未来月份' } });
    toggleLabel.createSpan({ text: '自动调整' });
    toggle.addEventListener('click', () => void plugin.stores.root.mutate((data) => {
      const target = data.cmd.planning?.goals.find((item) => item.id === goal.id);
      if (target) target.autoAdjust = !target.autoAdjust;
    }));
    const switcher = controls.createDiv({ cls: 'cc-plan-switch' });
    const display = planDisplay.get(goal.id) ?? 'current';
    for (const [mode, label] of [['original', '原始计划'], ['current', '当前计划']] as const) {
      const button = switcher.createEl('button', { cls: display === mode ? 'is-active' : '', text: label, attr: { type: 'button' } });
      button.addEventListener('click', () => { planDisplay.set(goal.id, mode); renderPlanningPanel(card.closest('[data-panel="planning"]') as HTMLElement ?? card.parentElement!, plugin); });
    }
  } else controls.createSpan({ cls: 'cc-plan-control-note', text: '不强制拆分到月，按实际节奏持续累计' });
  renderMetricTable(body, goal, plugin);
  if (goal.mode === 'adaptive' && goal.metrics.length) renderMonthlyPlan(body, goal, plugin);
  renderEvidence(body, goal, plugin);
  if (goal.note || goal.needsReview?.length) {
    const note = body.createDiv({ cls: 'cc-plan-note' });
    if (goal.note) note.createDiv({ text: goal.note });
    for (const warning of goal.needsReview ?? []) note.createDiv({ cls: 'cc-plan-warning', text: warning });
  }
}

function renderMetricTable(host: HTMLElement, goal: PlanningGoal, plugin: CommandCenterPlugin): void {
  if (!goal.metrics.length) { host.createDiv({ cls: 'cc-plan-inline-empty', text: '还没有指标，请编辑目标后添加。' }); return; }
  const table = host.createEl('table', { cls: 'cc-plan-metrics' });
  const columns = table.createEl('colgroup');
  for (const cls of ['cc-plan-metric-name-column', 'cc-plan-metric-value-column', 'cc-plan-metric-progress-column']) columns.createEl('col', { cls });
  const header = table.createEl('thead').createEl('tr');
  for (const label of ['指标', '实际 / 目标', '进度']) header.createEl('th', { text: label });
  const tbody = table.createEl('tbody');
  for (const metric of goal.metrics) {
    const row = tbody.createEl('tr');
    const copy = row.createEl('td', { cls: 'cc-plan-metric-copy' });
    copy.createSpan({ cls: 'cc-plan-detail-name', text: metric.name });
    copy.createSpan({ cls: 'cc-plan-source-state', text: metric.source.kind === 'manual' && goal.mode === 'adaptive' ? '按月录入' : metric.source.label || '手动记录' });
    const valueCell = row.createEl('td');
    const editable = metric.source.kind === 'manual' && goal.mode !== 'adaptive';
    renderActualTarget(valueCell, goalCurrent(goal, metric, plugin), metric.target, metric.unit, metric.name, editable ? (value) => {
      void plugin.stores.root.mutate((data) => {
        const target = data.cmd.planning?.goals.find((item) => item.id === goal.id)?.metrics.find((item) => item.id === metric.id);
        if (target) target.current = value;
      });
    } : undefined);
    renderRowProgress(row.createEl('td'), metricProgress(goal, metric, plugin));
  }
}

function renderMonthlyPlan(host: HTMLElement, goal: PlanningGoal, plugin: CommandCenterPlugin): void {
  const currentId = selectedMetrics.get(goal.id);
  const metric = goal.metrics.find((item) => item.id === currentId) ?? goal.metrics[0];
  selectedMetrics.set(goal.id, metric.id);
  const section = host.createDiv({ cls: 'cc-plan-month-section' });
  const heading = section.createDiv({ cls: 'cc-plan-section-head' });
  heading.createEl('strong', { text: '月度推进' });
  const picker = heading.createEl('select', { cls: 'cc-plan-metric-select', attr: { 'aria-label': '选择月度指标' } });
  for (const item of goal.metrics) picker.createEl('option', { text: item.name, value: item.id });
  picker.value = metric.id;
  picker.addEventListener('change', () => { selectedMetrics.set(goal.id, picker.value); renderPlanningPanel(section.closest('[data-panel="planning"]') as HTMLElement ?? section.parentElement!, plugin); });
  const display = planDisplay.get(goal.id) ?? 'current';
  const plan = display === 'original' ? metric.originalPlan : adjustedPlan(metric, goal, goal.year);
  const scroll = section.createDiv({ cls: 'cc-plan-month-scroll' });
  const months = scroll.createDiv({ cls: 'cc-plan-months' });
  for (let index = 0; index < 12; index += 1) {
    const month = months.createDiv({ cls: 'cc-plan-month' + (goal.year === new Date().getFullYear() && index === new Date().getMonth() ? ' is-current' : '') });
    month.createSpan({ cls: 'cc-plan-month-name', text: index + 1 + '月' });
    const input = month.createEl('input', { cls: 'cc-plan-month-input', attr: { type: 'number', min: '0', step: 'any', 'aria-label': `${index + 1}月实际完成` } });
    input.value = metric.actualByMonth[index] ? String(metric.actualByMonth[index]) : '';
    input.placeholder = '0';
    input.disabled = metric.source.kind !== 'manual';
    input.addEventListener('change', () => void plugin.stores.root.mutate((data) => {
      const target = data.cmd.planning?.goals.find((item) => item.id === goal.id)?.metrics.find((item) => item.id === metric.id);
      if (!target) return;
      target.actualByMonth[index] = Math.max(0, number(input.value));
      target.current = target.actualByMonth.reduce((sum, value) => sum + Math.max(0, number(value)), 0);
    }));
    month.createSpan({ cls: 'cc-plan-month-plan', text: `计划 ${fmt(plan[index])}` });
  }
  const quarters = section.createDiv({ cls: 'cc-plan-quarter-row' });
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const actual = metric.actualByMonth.slice(quarter * 3, quarter * 3 + 3).reduce((sum, value) => sum + number(value), 0);
    const target = plan.slice(quarter * 3, quarter * 3 + 3).reduce((sum, value) => sum + number(value), 0);
    const item = quarters.createSpan({ cls: 'cc-plan-quarter', text: 'Q' + (quarter + 1) + ' ' });
    item.createEl('strong', { text: `${fmt(actual)} / ${fmt(target)} ${metric.unit}` });
  }
}

function renderEvidence(host: HTMLElement, goal: PlanningGoal, plugin: CommandCenterPlugin): void {
  if (!goal.evidence.length) return;
  const section = host.createDiv({ cls: 'cc-plan-evidence' });
  const heading = section.createDiv({ cls: 'cc-plan-section-head' });
  heading.createEl('strong', { text: `记录条目 ${goal.evidence.filter((item) => item.done).length}/${goal.evidence.length}` });
  const add = iconButton(heading, 'plus', '添加记录条目');
  add.addEventListener('click', () => {
    const name = window.prompt('记录条目名称')?.trim();
    if (!name) return;
    void plugin.stores.root.mutate((data) => {
      data.cmd.planning?.goals.find((item) => item.id === goal.id)?.evidence.push({ id: planningId('evidence'), name, done: true, createdAt: Date.now() });
    });
  });
  if (!goal.evidence.length) { section.createDiv({ cls: 'cc-plan-inline-empty', text: '暂无记录条目' }); return; }
  const items = section.createDiv({ cls: 'cc-plan-evidence-list' });
  for (const evidence of goal.evidence) {
    const button = items.createEl('button', { cls: 'cc-plan-evidence-item' + (evidence.done ? ' is-done' : ''), text: evidence.name, attr: { type: 'button', title: evidence.done ? '点击标记为未完成' : '点击标记为完成' } });
    button.addEventListener('click', () => void plugin.stores.root.mutate((data) => {
      const target = data.cmd.planning?.goals.find((item) => item.id === goal.id);
      const item = target?.evidence.find((entry) => entry.id === evidence.id);
      if (!target || !item) return;
      item.done = !item.done;
      const candidateMetric = target.metrics.find((entry) => entry.source.label === '候选条目完成数');
      if (candidateMetric) candidateMetric.current = target.evidence.filter((entry) => entry.done).length;
    }));
  }
}

function renderVisions(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const all = plugin.stores.root.data.cmd.planning!.visions;
  const visions = all
    .filter((vision) => vision.year == null || vision.year === selectedYear)
    .sort((a, b) => Number(Boolean(a.realizedAt)) - Number(Boolean(b.realizedAt)) || priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt - b.createdAt);
  const conditions = visions.flatMap((vision) => vision.conditions);
  const done = conditions.filter(conditionComplete).length;
  const progress = conditions.length ? done / conditions.length * 100 : 0;
  renderOverview(host, '愿景与奖励', visions.length, '已经解锁', visions.filter(visionReady).length + ' 项', progress);
  if (!visions.length) { renderEmpty(host, plugin); return; }
  const list = host.createDiv({ cls: 'cc-plan-record-list cc-plan-vision-list' });
  renderPlanListHead(list, ['', '愿景或奖励', '优先级', '状态', '编辑'], 'cc-plan-vision-list-head');
  for (const vision of visions) renderVision(list, vision, plugin);
}

function conditionCurrent(condition: PlanningCondition, vision: PlanningVision, plugin: CommandCenterPlugin): number {
  return sourceValue(plugin.stores.root.data, condition.source, vision.year ?? selectedYear) ?? number(condition.current);
}

function conditionIsComplete(condition: PlanningCondition, vision: PlanningVision, plugin: CommandCenterPlugin): boolean {
  if (condition.type === 'manual') return condition.done;
  return condition.done || (condition.target > 0 && conditionCurrent(condition, vision, plugin) >= condition.target);
}

function visionIsReady(vision: PlanningVision, plugin: CommandCenterPlugin): boolean {
  return vision.conditions.length > 0 && vision.conditions.every((condition) => conditionIsComplete(condition, vision, plugin));
}

function renderVision(parent: HTMLElement, vision: PlanningVision, plugin: CommandCenterPlugin): void {
  const isOpen = openVisions.has(vision.id);
  const ready = visionIsReady(vision, plugin);
  const done = vision.conditions.filter((condition) => conditionIsComplete(condition, vision, plugin)).length;
  const card = parent.createEl('article', { cls: 'cc-plan-record cc-plan-vision' + (isOpen ? ' is-open' : '') + (vision.realizedAt ? ' is-realized' : '') });
  const head = card.createDiv({ cls: 'cc-plan-record-head cc-plan-vision-head', attr: { role: 'button', tabindex: '0', 'aria-expanded': String(isOpen) } });
  toggleExpandable(head, vision.id, openVisions, () => renderPlanningPanel(card.closest('[data-panel="planning"]') as HTMLElement ?? card.parentElement!, plugin));
  const chevron = iconButton(head, 'chevron-right', isOpen ? '收起' : '展开', 'cc-plan-icon-button cc-plan-record-expand cc-plan-chevron');
  chevron.addEventListener('click', (event) => {
    event.stopPropagation();
    isOpen ? openVisions.delete(vision.id) : openVisions.add(vision.id);
    renderPlanningPanel(card.closest('[data-panel="planning"]') as HTMLElement ?? card.parentElement!, plugin);
  });
  const copy = head.createDiv({ cls: 'cc-plan-record-copy' });
  const title = copy.createDiv({ cls: 'cc-plan-title-line' });
  const icon = title.createSpan({ cls: 'cc-plan-vision-icon' });
  setIcon(icon, vision.kind === 'reward' ? 'gift' : 'sparkles');
  const titleCopy = title.createDiv();
  titleCopy.createEl('h3', { text: vision.name });
  const meta = titleCopy.createDiv({ cls: 'cc-plan-title-meta' });
  meta.createSpan({ text: vision.kind === 'reward' ? '奖励' : '愿景' });
  meta.createSpan({ text: vision.year == null ? '长期' : String(vision.year) });
  renderPriority(head, vision.priority);
  const status = head.createSpan({ cls: 'cc-plan-vision-status' + (ready ? ' is-ready' : '') });
  setIcon(status.createSpan(), vision.realizedAt ? 'badge-check' : ready ? 'circle-check' : 'lock-keyhole');
  status.createSpan({ text: vision.realizedAt ? '已实现' : ready ? (vision.kind === 'reward' ? '可以兑现' : '条件已满足') : `${done}/${vision.conditions.length} 条件` });
  const actions = head.createDiv({ cls: 'cc-plan-record-actions' });
  const edit = iconButton(actions, 'pencil', '编辑愿景', 'cc-plan-icon-button cc-plan-row-action');
  edit.addEventListener('click', (event) => { event.stopPropagation(); new VisionModal(plugin, selectedYear, vision).open(); });
  const remove = iconButton(actions, 'trash-2', '删除愿景', 'cc-plan-icon-button cc-plan-row-action cc-plan-danger-action');
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!window.confirm(`确定删除「${vision.name}」？`)) return;
    void plugin.stores.root.mutate((data) => { if (data.cmd.planning) data.cmd.planning.visions = data.cmd.planning.visions.filter((item) => item.id !== vision.id); });
  });
  if (!isOpen) return;

  const body = card.createDiv({ cls: 'cc-plan-vision-body' });
  const conditionHead = body.createDiv({ cls: 'cc-plan-condition-head' });
  for (const label of ['', '达成条件', '实际 / 目标', '进度']) conditionHead.createSpan({ text: label });
  const list = body.createDiv({ cls: 'cc-plan-condition-list' });
  if (!vision.conditions.length) list.createDiv({ cls: 'cc-plan-inline-empty', text: '还没有达成条件，请编辑后添加。' });
  for (const condition of vision.conditions) renderCondition(list, vision, condition, plugin);
  if (vision.note) body.createDiv({ cls: 'cc-plan-note', text: vision.note });
  renderVisionEvidence(body, vision, plugin);
  if (!vision.realizedAt && !ready) return;
  const foot = body.createDiv({ cls: 'cc-plan-vision-foot' });
  if (vision.realizedAt) {
    const undo = foot.createEl('button', { cls: 'cc-plan-secondary', text: '撤销实现', attr: { type: 'button' } });
    undo.addEventListener('click', () => void plugin.stores.root.mutate((data) => { const target = data.cmd.planning?.visions.find((item) => item.id === vision.id); if (target) target.realizedAt = null; }));
  } else if (ready) {
    const realize = primaryButton(foot, vision.kind === 'reward' ? '确认已经兑现' : '确认实现愿景', vision.kind === 'reward' ? 'shopping-bag' : 'sparkles');
    realize.addEventListener('click', () => void plugin.stores.root.mutate((data) => { const target = data.cmd.planning?.visions.find((item) => item.id === vision.id); if (target) target.realizedAt = Date.now(); }));
  }
}

function renderVisionEvidence(host: HTMLElement, vision: PlanningVision, plugin: CommandCenterPlugin): void {
  if (!vision.evidence.length) return;
  const section = host.createDiv({ cls: 'cc-plan-evidence' });
  const heading = section.createDiv({ cls: 'cc-plan-section-head' });
  heading.createEl('strong', { text: `实现记录 ${vision.evidence.filter((item) => item.done).length}/${vision.evidence.length}` });
  const items = section.createDiv({ cls: 'cc-plan-evidence-list' });
  for (const evidence of vision.evidence) {
    const button = items.createEl('button', { cls: 'cc-plan-evidence-item' + (evidence.done ? ' is-done' : ''), text: evidence.name, attr: { type: 'button' } });
    button.addEventListener('click', () => void plugin.stores.root.mutate((data) => {
      const item = data.cmd.planning?.visions.find((entry) => entry.id === vision.id)?.evidence.find((entry) => entry.id === evidence.id);
      if (item) item.done = !item.done;
    }));
  }
}

function renderCondition(host: HTMLElement, vision: PlanningVision, condition: PlanningCondition, plugin: CommandCenterPlugin): void {
  const complete = conditionIsComplete(condition, vision, plugin);
  const row = host.createDiv({ cls: 'cc-plan-condition' });
  const mark = row.createEl('input', { cls: 'pk-row__check cc-plan-condition-check', attr: {
    type: 'checkbox', 'aria-label': condition.name + '完成状态',
    title: condition.type === 'manual' ? '完成或撤销此条件' : '完成状态由实际进度决定',
  } });
  mark.checked = complete;
  mark.disabled = condition.type !== 'manual';
  if (condition.type === 'manual') mark.addEventListener('change', () => void toggleCondition(plugin, vision.id, condition.id));
  const copy = row.createDiv({ cls: 'cc-plan-condition-copy' });
  copy.createSpan({ cls: 'cc-plan-detail-name', text: condition.name });
  copy.createSpan({ cls: 'cc-plan-source-state', text: condition.source.label || (condition.type === 'funding' ? '资金条件' : '手动记录') });
  const current = conditionCurrent(condition, vision, plugin);
  if (condition.type === 'manual') {
    row.createSpan({ cls: 'cc-plan-condition-state', text: complete ? '已完成' : '待完成' });
  } else {
    renderActualTarget(row, current, condition.target, condition.unit, condition.name, condition.source.kind === 'manual' ? (value) => {
      void plugin.stores.root.mutate((data) => {
        const target = data.cmd.planning?.visions.find((item) => item.id === vision.id)?.conditions.find((item) => item.id === condition.id);
        if (target) target.current = value;
      });
    } : undefined);
  }
  renderRowProgress(row, condition.type === 'manual' ? (complete ? 100 : 0) : condition.target > 0 ? current / condition.target * 100 : 0);
}

async function toggleCondition(plugin: CommandCenterPlugin, visionId: string, conditionId: string): Promise<void> {
  await plugin.stores.root.mutate((data) => {
    const target = data.cmd.planning?.visions.find((item) => item.id === visionId)?.conditions.find((item) => item.id === conditionId);
    if (target?.type === 'manual') target.done = !target.done;
  });
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function field(parent: HTMLElement, label: string, control: FormControl, wide = false): FormControl {
  const wrap = parent.createEl('label', { cls: 'cc-plan-field' + (wide ? ' is-wide' : '') });
  wrap.createSpan({ text: label });
  wrap.appendChild(control);
  return control;
}

function input(type = 'text', value = '', placeholder = ''): HTMLInputElement {
  const control = document.createElement('input');
  control.type = type;
  control.value = value;
  control.placeholder = placeholder;
  return control;
}

function select(options: Array<[string, string]>, value: string): HTMLSelectElement {
  const control = document.createElement('select');
  for (const [optionValue, label] of options) control.createEl('option', { value: optionValue, text: label });
  control.value = value;
  return control;
}

function textarea(value = '', placeholder = ''): HTMLTextAreaElement {
  const control = document.createElement('textarea');
  control.value = value;
  control.placeholder = placeholder;
  return control;
}

abstract class PlanningModal extends Modal {
  protected body!: HTMLElement;
  protected list!: HTMLElement;

  protected shell(title: string): void {
    this.modalEl.addClass('cc-plan-modal-el');
    this.contentEl.empty();
    this.contentEl.addClass('cc-plan-modal');
    const head = this.contentEl.createDiv({ cls: 'cc-plan-modal-head' });
    head.createEl('strong', { text: title });
    this.body = this.contentEl.createDiv({ cls: 'cc-plan-modal-body' });
  }

  protected actions(onSave: () => void): void {
    const actions = this.contentEl.createDiv({ cls: 'cc-plan-modal-foot' });
    const cancel = actions.createEl('button', { cls: 'cc-plan-secondary', text: '取消', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    primaryButton(actions, '保存').addEventListener('click', onSave);
  }
}

interface MetricDraft {
  id: string;
  name: string;
  target: number;
  current: number;
  unit: string;
  sourceKind: PlanningSourceKind;
  sourceLabel: string;
  originalPlan: number[];
  actualByMonth: number[];
}

class GoalModal extends PlanningModal {
  private name!: HTMLInputElement;
  private year!: HTMLSelectElement;
  private priority!: HTMLSelectElement;
  private mode!: HTMLSelectElement;
  private period!: HTMLSelectElement;
  private periodStart!: HTMLInputElement;
  private periodEnd!: HTMLInputElement;
  private rule!: HTMLSelectElement;
  private note!: HTMLTextAreaElement;
  private evidence!: HTMLTextAreaElement;
  private drafts: MetricDraft[];

  constructor(private plugin: CommandCenterPlugin, year: number, private goal?: PlanningGoal) {
    super(plugin.app);
    selectedYear = year;
    this.drafts = (goal?.metrics ?? []).map((metric) => ({ ...metric, sourceKind: metric.source.kind, sourceLabel: metric.source.label, originalPlan: [...metric.originalPlan], actualByMonth: [...metric.actualByMonth] }));
    if (!this.drafts.length) this.drafts.push(this.blankMetric());
  }

  onOpen(): void {
    this.shell(this.goal ? '编辑年度目标' : '新建年度目标');
    this.name = field(this.body, '名称', input('text', this.goal?.name ?? '', '例如：建立稳定的内容生产系统'), true) as HTMLInputElement;
    this.year = field(this.body, '所属年份', select(yearOptions(selectedYear), String(this.goal?.year ?? selectedYear))) as HTMLSelectElement;
    this.priority = field(this.body, '优先级', select(PLANNING_PRIORITIES.map((value) => [value, value]), this.goal?.priority ?? 'P2')) as HTMLSelectElement;
    this.mode = field(this.body, '推进方式', select([['adaptive', '自适应计划'], ['cumulative', '自由累计']], this.goal?.mode ?? 'cumulative')) as HTMLSelectElement;
    this.period = field(this.body, '计划周期', select([['annual', '年度'], ['monthly', '月度'], ['custom', '自定义']], this.goal?.period ?? 'annual')) as HTMLSelectElement;
    this.periodStart = field(this.body, '自定义开始日期', input('date', this.goal?.periodStart ?? '')) as HTMLInputElement;
    this.periodEnd = field(this.body, '自定义结束日期', input('date', this.goal?.periodEnd ?? '')) as HTMLInputElement;
    const updatePeriodFields = (): void => {
      this.periodStart.parentElement?.toggleClass('is-hidden', this.period.value !== 'custom');
      this.periodEnd.parentElement?.toggleClass('is-hidden', this.period.value !== 'custom');
    };
    this.period.addEventListener('change', updatePeriodFields);
    updatePeriodFields();
    this.rule = field(this.body, '达成规则', select([['all', '全部指标达成'], ['sum', '总量达成']], this.goal?.achievementRule ?? 'all')) as HTMLSelectElement;
    this.note = field(this.body, '备注', textarea(this.goal?.note ?? '', '记录背景、边界和达成标准'), true) as HTMLTextAreaElement;
    this.evidence = field(this.body, '记录条目（每行一项）', textarea((this.goal?.evidence ?? []).map((item) => item.name).join('\n'), '适合书目、城市、作品、证书等清单型记录'), true) as HTMLTextAreaElement;
    const metricSection = this.body.createDiv({ cls: 'cc-plan-form-section is-wide' });
    const head = metricSection.createDiv({ cls: 'cc-plan-form-section-head' });
    head.createEl('strong', { text: '量化指标' });
    iconButton(head, 'plus', '添加指标').addEventListener('click', () => { this.drafts.push(this.blankMetric()); this.renderDrafts(); });
    this.list = metricSection.createDiv({ cls: 'cc-plan-form-list' });
    this.renderDrafts();
    this.actions(() => void this.submit());
    this.name.focus();
  }

  private blankMetric(): MetricDraft {
    return { id: planningId('metric'), name: '', target: 0, current: 0, unit: '', sourceKind: 'manual', sourceLabel: '', originalPlan: emptyMonths(), actualByMonth: emptyMonths() };
  }

  private renderDrafts(): void {
    this.list.empty();
    this.drafts.forEach((draft, index) => {
      const row = this.list.createDiv({ cls: 'cc-plan-form-row cc-plan-metric-draft' });
      const name = input('text', draft.name, '指标名称');
      const target = input('number', String(draft.target), '目标值'); target.min = '0'; target.step = 'any';
      const unit = input('text', draft.unit, '单位');
      const source = select(PLANNING_SOURCE_OPTIONS.map((item) => [item.value, item.label]), draft.sourceKind);
      const sourceLabel = input('text', draft.sourceLabel, '来源说明');
      row.append(name, target, unit, source, sourceLabel);
      iconButton(row, 'trash-2', '删除指标').addEventListener('click', () => { this.drafts.splice(index, 1); this.renderDrafts(); });
      name.addEventListener('input', () => { draft.name = name.value; });
      target.addEventListener('input', () => { draft.target = Math.max(0, number(target.value)); });
      unit.addEventListener('input', () => { draft.unit = unit.value; });
      source.addEventListener('change', () => { draft.sourceKind = source.value as PlanningSourceKind; });
      sourceLabel.addEventListener('input', () => { draft.sourceLabel = sourceLabel.value; });
    });
  }

  private async submit(): Promise<void> {
    const name = this.name.value.trim();
    const metrics = this.drafts.filter((draft) => draft.name.trim());
    if (!name) { new Notice('请填写目标名称'); this.name.focus(); return; }
    if (!metrics.length) { new Notice('请至少填写一个量化指标'); return; }
    const now = Date.now();
    const previousEvidence = new Map((this.goal?.evidence ?? []).map((item) => [item.name, item]));
    const evidence: PlanningEvidence[] = this.evidence.value.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => previousEvidence.get(item) ?? { id: planningId('evidence'), name: item, done: false, createdAt: now });
    const next: PlanningGoal = {
      id: this.goal?.id ?? planningId('goal'), name, year: number(this.year.value) || selectedYear,
      priority: this.priority.value as PlanningPriority, note: this.note.value.trim(),
      mode: this.mode.value as 'adaptive' | 'cumulative', period: this.period.value as PlanningPeriod,
      ...(this.period.value === 'custom' ? { periodStart: this.periodStart.value, periodEnd: this.periodEnd.value } : {}),
      achievementRule: this.rule.value as 'sum' | 'all', autoAdjust: this.mode.value === 'adaptive' ? (this.goal?.autoAdjust ?? true) : false,
      metrics: metrics.map((draft) => ({
        id: draft.id, name: draft.name.trim(), target: draft.target, current: draft.current,
        unit: draft.unit.trim(), source: { kind: draft.sourceKind, label: draft.sourceLabel.trim() || '手动记录' },
        originalPlan: draft.originalPlan.some((value) => value > 0) && this.goal?.metrics.find((item) => item.id === draft.id)?.target === draft.target ? draft.originalPlan : evenPlan(draft.target),
        actualByMonth: draft.actualByMonth.length === 12 ? draft.actualByMonth : emptyMonths(),
      })),
      evidence, createdAt: this.goal?.createdAt ?? now, updatedAt: now,
      ...(this.goal?.needsReview ? { needsReview: this.goal.needsReview } : {}),
    };
    await this.plugin.stores.root.mutate((data) => {
      const goals = data.cmd.planning!.goals;
      const index = goals.findIndex((item) => item.id === next.id);
      if (index >= 0) goals[index] = next;
      else goals.push(next);
    });
    selectedYear = next.year;
    openGoals.add(next.id);
    this.close();
  }
}

interface ConditionDraft extends PlanningCondition {}

class VisionModal extends PlanningModal {
  private name!: HTMLInputElement;
  private year!: HTMLSelectElement;
  private priority!: HTMLSelectElement;
  private kind!: HTMLSelectElement;
  private note!: HTMLTextAreaElement;
  private evidence!: HTMLTextAreaElement;
  private drafts: ConditionDraft[];

  constructor(private plugin: CommandCenterPlugin, year: number, private vision?: PlanningVision) {
    super(plugin.app);
    selectedYear = year;
    this.drafts = (vision?.conditions ?? []).map((condition) => ({ ...condition, source: { ...condition.source } }));
    if (!this.drafts.length) this.drafts.push(this.blankCondition());
  }

  onOpen(): void {
    this.shell(this.vision ? '编辑愿景与奖励' : '新建愿景与奖励');
    this.name = field(this.body, '名称', input('text', this.vision?.name ?? '', '例如：拥有自己的内容工作室'), true) as HTMLInputElement;
    this.year = field(this.body, '所属年份', select([['', '长期'], ...yearOptions(selectedYear)], this.vision?.year == null ? '' : String(this.vision.year))) as HTMLSelectElement;
    this.priority = field(this.body, '优先级', select(PLANNING_PRIORITIES.map((value) => [value, value]), this.vision?.priority ?? 'P2')) as HTMLSelectElement;
    this.kind = field(this.body, '类型', select([['vision', '愿景'], ['reward', '奖励']], this.vision?.kind ?? 'vision')) as HTMLSelectElement;
    this.note = field(this.body, '备注', textarea(this.vision?.note ?? '', '记录为什么想实现它，以及判断边界'), true) as HTMLTextAreaElement;
    this.evidence = field(this.body, '实现记录（每行一项）', textarea((this.vision?.evidence ?? []).map((item) => item.name).join('\n'), '适合书目、城市、作品、证书等补充记录'), true) as HTMLTextAreaElement;
    const section = this.body.createDiv({ cls: 'cc-plan-form-section is-wide' });
    const head = section.createDiv({ cls: 'cc-plan-form-section-head' });
    head.createEl('strong', { text: '达成条件' });
    iconButton(head, 'plus', '添加条件').addEventListener('click', () => { this.drafts.push(this.blankCondition()); this.renderDrafts(); });
    this.list = section.createDiv({ cls: 'cc-plan-form-list' });
    this.renderDrafts();
    this.actions(() => void this.submit());
    this.name.focus();
  }

  private blankCondition(): ConditionDraft {
    return { id: planningId('condition'), name: '', type: 'manual', target: 0, current: 0, unit: '', done: false, source: manualSource() };
  }

  private renderDrafts(): void {
    this.list.empty();
    this.drafts.forEach((draft, index) => {
      const row = this.list.createDiv({ cls: 'cc-plan-form-row cc-plan-condition-draft' });
      const type = select([['manual', '手动条件'], ['quantity', '量化条件'], ['funding', '资金条件']], draft.type);
      const name = input('text', draft.name, '条件名称');
      const target = input('number', String(draft.target), '目标值'); target.min = '0'; target.step = 'any';
      const unit = input('text', draft.unit, '单位');
      const source = select(PLANNING_SOURCE_OPTIONS.map((item) => [item.value, item.label]), draft.source.kind);
      row.append(type, name, target, unit, source);
      iconButton(row, 'trash-2', '删除条件').addEventListener('click', () => { this.drafts.splice(index, 1); this.renderDrafts(); });
      type.addEventListener('change', () => { draft.type = type.value as PlanningCondition['type']; });
      name.addEventListener('input', () => { draft.name = name.value; });
      target.addEventListener('input', () => { draft.target = Math.max(0, number(target.value)); });
      unit.addEventListener('input', () => { draft.unit = unit.value; });
      source.addEventListener('change', () => { draft.source.kind = source.value as PlanningSourceKind; draft.source.label = PLANNING_SOURCE_OPTIONS.find((item) => item.value === source.value)?.label ?? '手动记录'; });
    });
  }

  private async submit(): Promise<void> {
    const name = this.name.value.trim();
    const conditions = this.drafts.filter((draft) => draft.name.trim());
    if (!name) { new Notice('请填写愿景名称'); this.name.focus(); return; }
    if (!conditions.length) { new Notice('请至少填写一个达成条件'); return; }
    const now = Date.now();
    const previousEvidence = new Map((this.vision?.evidence ?? []).map((item) => [item.name, item]));
    const evidence: PlanningEvidence[] = this.evidence.value.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => previousEvidence.get(item) ?? { id: planningId('evidence'), name: item, done: false, createdAt: now });
    const next: PlanningVision = {
      id: this.vision?.id ?? planningId('vision'), name,
      kind: this.kind.value as 'vision' | 'reward', year: this.year.value ? number(this.year.value) : null,
      priority: this.priority.value as PlanningPriority, note: this.note.value.trim(),
      conditions: conditions.map((draft) => ({ ...draft, name: draft.name.trim(), unit: draft.unit.trim(), source: { ...draft.source } })),
      evidence, realizedAt: this.vision?.realizedAt ?? null,
      createdAt: this.vision?.createdAt ?? now, updatedAt: now,
    };
    await this.plugin.stores.root.mutate((data) => {
      const visions = data.cmd.planning!.visions;
      const index = visions.findIndex((item) => item.id === next.id);
      if (index >= 0) visions[index] = next;
      else visions.push(next);
    });
    if (next.year != null) selectedYear = next.year;
    openVisions.add(next.id);
    this.close();
  }
}

function yearOptions(center: number): Array<[string, string]> {
  const current = new Date().getFullYear();
  return Array.from(new Set([center, current - 1, current, current + 1, current + 2, current + 3])).sort((a, b) => a - b).map((year) => [String(year), String(year)]);
}
