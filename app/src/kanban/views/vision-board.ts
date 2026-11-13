// 长期愿景看板：愿景不等于任务；储蓄与实现条件只用于描述可能的实现路径。
// 复用现有 Apple 原生视觉（.pk-card / .pk-progress / .pk-donebar / .pk-today），
// 新增最少类名（.pk-vision*）。交互：卡片内双区块（储蓄内联 + 达成子项复用子项编辑器），
// 实现时沉底 + 「已实现 N 项」折叠条；顶部「今日实现 N 项」汇总。
import {  } from "obsidian";
import { FfModal as Modal } from "../../design-system/modal";
import type { KanbanCtx as ProjectKanbanPlugin } from '../models';
import {
  Vision,
  Subtask,
  visionRealized,
  visionOverallPct,
  visionSavingsPct,
  visionSort,
  visionBadge,
  isRealizedToday,
  PRIORITIES,
  Priority,
} from '../models';
import {
  ConfirmModal,
  mountSubtaskEditor,
  progressBar,
  renderEmptyState,
  renderField,
  SubtaskEditorHandle,
  FieldControl,
} from '../components';

// 折叠状态在视图生命周期内保持
let showRealized = false;
let showToday = false;
let visionHost: HTMLElement | null = null;
const openVisionSections = new Set<string>();

function sectionKey(visionId: string, section: 'savings' | 'achieve'): string {
  return `${visionId}:${section}`;
}

function isSectionOpen(visionId: string, section: 'savings' | 'achieve'): boolean {
  return openVisionSections.has(sectionKey(visionId, section));
}

function toggleSection(visionId: string, section: 'savings' | 'achieve'): boolean {
  const key = sectionKey(visionId, section);
  if (openVisionSections.has(key)) {
    openVisionSections.delete(key);
    return false;
  }
  openVisionSections.add(key);
  return true;
}

/** 时间戳格式化为本地 HH:MM（迭代 009：今日实现条展示实现时刻）。 */
function timeOf(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function renderVisionBoard(host: HTMLElement, plugin: ProjectKanbanPlugin): void {
  visionHost = host;
  host.empty();
  const store = plugin.store;
  const board = host.createDiv({ cls: 'pk-board' });

  const visions = store.getVisions();

  // 今日实现汇总条
  const todayList = visions.filter(isRealizedToday);
  if (todayList.length > 0) {
    const bar = board.createDiv({ cls: 'pk-today' });
    const barTop = bar.createDiv({ cls: 'pk-today__bar' });
    barTop.createSpan({ cls: 'pk-today__icon', text: '🏆' });
    barTop.createSpan({ cls: 'pk-today__label', text: `今日实现 ${todayList.length} 项` });
    const caretT = barTop.createSpan({ cls: 'pk-today__caret', text: showToday ? '▾' : '▸' });
    const listEl = bar.createDiv({ cls: 'pk-today__list' });
    listEl.style.display = showToday ? 'flex' : 'none';
    todayList.forEach((v) => {
      const item = listEl.createDiv({ cls: 'pk-today__item' });
      item.createSpan({ cls: 'pk-today__time', text: v.realizedAt ? timeOf(v.realizedAt) : '' });
      item.createSpan({ cls: 'pk-today__name', text: v.name });
      item.createSpan({ cls: 'pk-today__proj', text: visionBadge(v) });
      item.addEventListener('click', () => openEdit(v, host, plugin));
    });
    barTop.addEventListener('click', () => {
      showToday = !showToday;
      listEl.style.display = showToday ? 'flex' : 'none';
      caretT.setText(showToday ? '▾' : '▸');
    });
  }

  if (visions.length === 0) {
    renderEmptyState(board, {
      icon: '🏁',
      title: '还没有长期愿景',
      desc: '记录未来想成为、拥有或体验的状态。它不需要截止日期，也不要求一定完成。',
      ctaText: '＋ 新建愿景',
      onCta: () => openVisionForm(plugin, () => renderVisionBoard(host, plugin)),
    });
    return;
  }

  const active = visions
    .filter((v) => !visionRealized(v))
    .sort(visionSort);
  const realized = visions.filter(visionRealized).sort(visionSort);

  const grid = board.createDiv({ cls: 'pk-vision__grid' });
  active.forEach((v) => grid.appendChild(renderVisionCard(v, plugin, host)));

  // 已实现折叠条（沉底）
  if (realized.length > 0) {
    const bar = board.createDiv({ cls: 'pk-donebar' });
    bar.createSpan({ cls: 'pk-donebar__label', text: `已实现 ${realized.length} 项` });
    const caretR = bar.createSpan({ cls: 'pk-donebar__caret', text: showRealized ? '▾' : '▸' });
    const group = board.createDiv({ cls: 'pk-donegroup' });
    group.style.display = showRealized ? 'flex' : 'none';
    group.style.flexDirection = 'column';
    group.style.gap = '8px';
    realized.forEach((v) => group.appendChild(renderVisionCard(v, plugin, host)));
    bar.addEventListener('click', () => {
      showRealized = !showRealized;
      group.style.display = showRealized ? 'flex' : 'none';
      caretR.setText(showRealized ? '▾' : '▸');
    });
  }
}

export function openVisionForm(plugin: ProjectKanbanPlugin, onSaved: () => void): void {
  new VisionFormModal(plugin.app, plugin, undefined, onSaved).open();
}

function openEdit(v: Vision, host: HTMLElement, plugin: ProjectKanbanPlugin): void {
  new VisionFormModal(plugin.app, plugin, v, () => renderVisionBoard(host, plugin)).open();
}

/** 渲染单张愿景卡片（双区块：储蓄内联 + 达成子项），内联编辑走 silent 不整板重渲染，
 *  仅直接更新本卡进度/状态；实现态翻转时 store 会广播触发整板重渲染。 */
function renderVisionCard(v: Vision, plugin: ProjectKanbanPlugin, host: HTMLElement): HTMLElement {
  const store = plugin.store;
  const card = document.createElement('div');
  card.className = 'pk-card pk-vision' + (visionRealized(v) ? ' is-realized' : '');
  const left = card.createDiv({ cls: 'pk-vision__left' });
  const right = card.createDiv({ cls: 'pk-vision__right' });

  // 主体身份区：愿景/奖励是一级信息，储蓄只是其下的实现条件。
  const identity = left.createDiv({ cls: 'pk-vision__identity' });
  identity.createDiv({ cls: 'pk-vision__eyebrow', text: v.savings ? '愿景奖励' : '愿景' });
  const top = identity.createDiv({ cls: 'pk-card__top' });
  const title = top.createEl('button', { cls: 'pk-card__title pk-vision__title-btn', text: v.name });
  title.addEventListener('click', (e) => {
    e.stopPropagation();
    openEdit(v, host, plugin);
  });
  const meta = identity.createDiv({ cls: 'pk-vision__meta' });
  meta.createSpan({ cls: 'pk-pill is-' + (v.priority ?? 'P2').toLowerCase(), text: v.priority ?? 'P2' });
  meta.createSpan({ cls: 'pk-vision__year', text: v.year == null ? '长期' : String(v.year) });
  const edit = top.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '编辑' });
  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    openEdit(v, host, plugin);
  });
  const del = top.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '✕' });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    new ConfirmModal(plugin.app, {
      title: '删除愿景',
      message: `确定删除「${v.name}」？此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
      onConfirm: () => void store.deleteVision(v.id),
    }).open();
  });
  if (v.note) identity.createDiv({ cls: 'pk-vision__note', text: v.note });

  // 整体进度
  const overall = left.createDiv({ cls: 'pk-vision__overall' });
  const overallBar = progressBar(visionOverallPct(v), 'var(--pk-accent)');
  const overallFill = overallBar.querySelector('.pk-progress__fill') as HTMLElement;
  overall.appendChild(overallBar);
  const overallPct = overall.createSpan({ cls: 'pk-vision__pct', text: `${visionOverallPct(v)}%` });

  // 状态行
  const statusEl = left.createDiv({ cls: 'pk-vision__status' });

  // 刷新本卡动态部分（不重建 DOM，保焦点）
  const refreshStatus = (): void => {
    const nv = store.getVision(v.id);
    if (!nv) return;
    const r = visionRealized(nv);
    card.classList.toggle('is-realized', r);
    const op = visionOverallPct(nv);
    overallFill.style.width = `${op}%`;
    overallPct.setText(`${op}%`);
    if (r) {
      statusEl.setText('✓ 已实现');
      statusEl.className = 'pk-vision__status is-realized';
    } else {
      const gaps: string[] = [];
      if (nv.savings && nv.savings.current < nv.savings.target) {
        gaps.push(`储蓄还差 ${nv.savings.target - nv.savings.current}${nv.savings.unit ?? '元'}`);
      }
      const remain = (nv.subtasks ?? []).filter(
        (s) => !(s.done || (s.target > 0 && s.current >= s.target)),
      ).length;
      if (remain > 0) gaps.push(`达成还差 ${remain} 项`);
      statusEl.setText(gaps.join(' · ') || '进行中');
      statusEl.className = 'pk-vision__status';
    }
  };

  // 区块 A · 储蓄（可选）
  if (v.savings) {
    const block = left.createDiv({ cls: 'pk-vision__block pk-vision__block--savings is-open' });
    block.createDiv({ cls: 'pk-vision__block-title', text: '储蓄条件' });
    const body = block.createDiv({ cls: 'pk-vision__block-body' });
    const row = body.createDiv({ cls: 'pk-vision__cond pk-vision__cond--savings' });
    row.createDiv({ cls: 'pk-vision__name', text: '当前储蓄' });
    const amount = row.createDiv({ cls: 'pk-vision__amount' });
    const curI = amount.createEl('input', { cls: 'pk-input pk-input--num pk-vision__cur' });
    curI.type = 'number';
    curI.value = String(v.savings.current || 0);
    curI.placeholder = '当前储蓄';
    amount.createSpan({ cls: 'pk-vision__slash', text: '/' });
    amount.createSpan({ cls: 'pk-vision__tgt', text: `${v.savings.target}${v.savings.unit ?? '元'}` });
    const progressWrap = row.createDiv({ cls: 'pk-vision__metric' });
    const barWrap = progressWrap.createDiv({ cls: 'pk-vision__bar' });
    const sBar = progressBar(visionSavingsPct(v), 'var(--pk-accent)');
    const sFill = sBar.querySelector('.pk-progress__fill') as HTMLElement;
    barWrap.appendChild(sBar);
    const sPct = progressWrap.createSpan({ cls: 'pk-vision__pct', text: `${visionSavingsPct(v)}%` });
    curI.addEventListener('input', () => {
      const val = Number(curI.value) || 0;
      void store.setSavingsCurrent(v.id, val, true).then(() => {
        const nv = store.getVision(v.id);
        if (nv && nv.savings) {
          const p = visionSavingsPct(nv);
          sFill.style.width = `${p}%`;
          sPct.setText(`${p}%`);
          refreshStatus();
        }
      });
    });
  }

  // 区块 B · 实现条件（量化子项，复用子项编辑器范式）
  const blockB = right.createDiv({ cls: 'pk-vision__block pk-vision__block--achieve is-open' });
  const achieveTitle = blockB.createDiv({ cls: 'pk-vision__block-title' });
  achieveTitle.createSpan({ text: '实现条件' });
  const completeCount = (v.subtasks ?? []).filter(
    (s) => s.done || (s.target > 0 && s.current >= s.target),
  ).length;
  achieveTitle.createSpan({
    cls: 'pk-vision__count',
    text: `${completeCount} / ${(v.subtasks ?? []).length}`,
  });
  const achieveBody = blockB.createDiv({ cls: 'pk-vision__block-body' });
  (v.subtasks ?? []).forEach((s) => {
    const row = achieveBody.createDiv({ cls: 'pk-vision__cond' });
    const chk = row.createEl('input', { cls: 'pk-vision__check' });
    chk.type = 'checkbox';
    chk.checked = s.done;
    chk.addEventListener('change', () => {
      // 完成勾选可能触发实现态翻转 → 不 silent，交由整板重渲染
      void store.updateVisionSubtask(v.id, s.id, { done: chk.checked });
    });
    row.createEl('span', { cls: 'pk-vision__name', text: s.name || '未命名子项' });
    const curI = row.createEl('input', { cls: 'pk-input pk-input--num pk-vision__cur' });
    curI.type = 'number';
    curI.value = String(s.current || 0);
    curI.placeholder = '当前';
    curI.addEventListener('input', () => {
      const val = Number(curI.value) || 0;
      void store.updateSubtask(v.id, s.id, { current: val }, true).then(() => {
        const nv = store.getVision(v.id);
        const ns = nv?.subtasks?.find((x) => x.id === s.id);
        if (ns) {
          const p = ns.target > 0 ? Math.min(100, Math.round((ns.current / ns.target) * 100)) : ns.done ? 100 : 0;
          row.querySelector('.pk-progress__fill') &&
            ((row.querySelector('.pk-progress__fill') as HTMLElement).style.width = `${p}%`);
          const pl = row.querySelector('.pk-vision__pct') as HTMLElement | null;
          if (pl) pl.setText(`${p}%`);
          refreshStatus();
        }
      });
    });
    row.createSpan({ cls: 'pk-vision__slash', text: '/' });
    row.createSpan({ cls: 'pk-vision__tgt', text: `${s.target}${s.unit ?? ''}` });
    const barWrap = row.createDiv({ cls: 'pk-vision__bar' });
    const p0 = s.target > 0 ? Math.min(100, Math.round((s.current / s.target) * 100)) : s.done ? 100 : 0;
    barWrap.appendChild(progressBar(p0, 'var(--pk-accent)'));
    row.createSpan({ cls: 'pk-vision__pct', text: `${p0}%` });
  });
  const addBtn = achieveBody.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '＋ 添加子项' });
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void store.addSubtask(v.id);
  });

  refreshStatus();

  return card;
}

/** 愿景新建 / 编辑弹窗（自定义，复用子项编辑器）。 */
class VisionFormModal extends Modal {
  private plugin: ProjectKanbanPlugin;
  private vision?: Vision;
  private onSaved: () => void;
  private inputs: Record<string, FieldControl> = {};
  private saveChk!: HTMLInputElement;
  private saveTargetI!: HTMLInputElement;
  private saveRow!: HTMLElement;
  private subEditor!: SubtaskEditorHandle;

  constructor(app: any, plugin: ProjectKanbanPlugin, vision: Vision | undefined, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.vision = vision;
    this.onSaved = onSaved;
    this.modalEl.addClass('pk-modal-el');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');

    contentEl.createEl('div', {
      cls: 'pk-modal__title',
      text: this.vision ? `编辑愿景 · ${this.vision.name}` : '新建长期愿景',
    });

    const form = contentEl.createDiv({ cls: 'pk-modal__grid' });
    this.inputs['name'] = renderField(form, {
      key: 'name',
      label: '名称',
      type: 'text',
      value: this.vision?.name ?? '',
      span: 'full',
      placeholder: '如：出版第一本书',
    });
    this.inputs['priority'] = renderField(form, {
      key: 'priority',
      label: '优先级',
      type: 'select',
      options: PRIORITIES,
      value: this.vision?.priority ?? 'P2',
      span: 'half',
    });
    const year = new Date().getFullYear();
    const yearValues = ['长期', ...Array.from({ length: 5 }, (_, i) => String(year + i))];
    this.inputs['year'] = renderField(form, {
      key: 'year',
      label: '所属年份',
      type: 'select',
      options: yearValues,
      value: this.vision?.year == null ? '长期' : String(this.vision.year),
      span: 'half',
    });
    this.inputs['note'] = renderField(form, {
      key: 'note',
      label: '备注',
      type: 'textarea',
      value: this.vision?.note ?? '',
      span: 'full',
    });

    // 储蓄条件开关（奖励才有）
    const saveField = form.createDiv({ cls: 'pk-field pk-field--full' });
    const saveLabel = saveField.createEl('label', { cls: 'pk-field__label' });
    saveLabel.textContent = '储蓄条件（设为奖励）';
    const saveToggle = saveField.createDiv({ cls: 'pk-done-toggle' });
    this.saveChk = saveToggle.createEl('input');
    this.saveChk.type = 'checkbox';
    this.saveChk.checked = !!this.vision?.savings;
    const saveHint = saveToggle.createSpan();
    saveHint.textContent = '勾选后需攒够一笔储蓄才实现';
    this.saveRow = saveField.createDiv({ cls: 'pk-vision__save-row' });
    const tgtI = this.saveRow.createEl('input', { cls: 'pk-input pk-input--num' });
    tgtI.type = 'number';
    tgtI.placeholder = '储蓄目标额';
    tgtI.value = String(this.vision?.savings?.target ?? '');
    tgtI.style.flex = '0 0 80px';
    tgtI.style.width = '80px';
    this.saveTargetI = tgtI;
    const unitI = this.saveRow.createEl('input', { cls: 'pk-input' });
    unitI.placeholder = '单位';
    unitI.value = this.vision?.savings?.unit ?? '元';
    unitI.style.flex = '0 0 72px';
    unitI.style.width = '72px';
    this.saveUnitI = unitI;
    this.saveRow.style.display = this.saveChk.checked ? 'flex' : 'none';
    this.saveChk.addEventListener('change', () => {
      this.saveRow.style.display = this.saveChk.checked ? 'flex' : 'none';
    });

    // 达成子项编辑器
    const subField = contentEl.createDiv({ cls: 'pk-field pk-field--full' });
    const editor = subField.createDiv({ cls: 'pk-vision__sub-editor' });
    this.subEditor = mountSubtaskEditor(editor, this.vision?.subtasks ?? [], {
      showCurrent: true,
      showDone: true,
    });
    const addSub = subField.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '＋ 添加子项' });
    addSub.addEventListener('click', () => this.subEditor.add());

    // 自动聚焦名称
    const nameInput = this.inputs['name'];
    if (nameInput) nameInput.focus();

    const actions = contentEl.createDiv({ cls: 'pk-modal__actions' });
    const cancel = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const ok = actions.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '确定' });
    ok.addEventListener('click', () => void this.submit());
  }

  private saveUnitI!: HTMLInputElement;

  private async submit(): Promise<void> {
    const name = (this.inputs['name'].value || '').trim() || '未命名愿景';
    const yearValue = this.inputs['year'].value;
    const year = yearValue === '长期' ? null : Number(yearValue) || new Date().getFullYear();
    const priority = (this.inputs['priority'].value as Priority) || 'P2';
    const note = this.inputs['note'].value || '';
    const subtasks: Subtask[] = this.subEditor.getSubtasks();
    const savings = this.saveChk.checked
      ? {
          target: Number(this.saveTargetI.value) || 0,
          current: this.vision?.savings?.current ?? 0,
          unit: (this.saveUnitI.value || '').trim() || '元',
        }
      : undefined;
    if (this.vision) {
      await this.plugin.store.updateVision(this.vision.id, { name, priority, year, note, subtasks, savings });
    } else {
      await this.plugin.store.addVision({ name, priority, year, note, subtasks, savings });
    }
    this.onSaved();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
