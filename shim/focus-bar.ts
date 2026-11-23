/** Today's unfinished focus, grouped by task, in-page or in a native floating panel. */
import { buildIcon } from './dom';
import { groupEntries, pendingEntries, pinKeyOf, selectEntries } from './focus-model';
import type { FocusEntry, FocusGroup } from './focus-model';

export interface FocusBarDeps {
  ensureBooted(): Promise<unknown>;
  openTask(taskId: string, subtaskId?: string): void;
  getPlugin(): any;
  t(key: string): string;
}
type Edge = 'left' | 'right' | 'top' | 'bottom';
interface DockState { edge: Edge; offset: number }
const COLLAPSE_KEY = 'fl.focusbar.collapsed';
const DOCK_KEY = 'fl.focusball.dock';
const PICKS_PREFIX = 'fl.focusbar.picks.';
const API = '/dsh-feifan-life/api/focus-window';
const BALL_SIZE = 44;
const MARGIN = 8;
const localDateKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(n, Math.max(min, max)));

/** Pointer activation survives host click handlers; keyboard click stays native. */
function onPress(el: HTMLElement, action: (event: Event) => void): void {
  let down: { id: number; x: number; y: number } | null = null;
  let pointerClick = false;
  el.addEventListener('pointerdown', e => {
    if (e.button === 0) { down = { id: e.pointerId, x: e.clientX, y: e.clientY }; pointerClick = false; }
  });
  el.addEventListener('pointercancel', () => { down = null; pointerClick = true; });
  el.addEventListener('pointerup', e => {
    const start = down; down = null;
    if (!start || e.pointerId !== start.id || e.button !== 0) return;
    pointerClick = true;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 6) {
      e.stopPropagation(); action(e);
    }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); action(e); }
  }, true);
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (e.detail > 0 && pointerClick) { pointerClick = false; return; }
    action(e);
  }, true);
}

export function mountFocusBar(host: HTMLElement, deps: FocusBarDeps): () => void {
  const root = document.createElement('div');
  root.className = 'fl-focus-root';
  host.appendChild(root);
  let disposed = false;
  let detachTheme: (() => void) | null = null;
  const unsubs: Array<() => void> = [];
  let selecting = false;
  let collapsed = readStorage(COLLAPSE_KEY) !== '0';
  let dock: DockState = loadDock();
  let cancelDrag: (() => void) | null = null;
  let dragging = false;
  let renderAfterDrag = false;
  let positionFrame = 0;
  let nativeOpen = false;
  let nativeBusy = false;
  let nativeError = '';
  let nativeSupported = false;
  let pipWindow: Window | null = null;
  let detachPipTheme: (() => void) | null = null;
  let pollTimer = 0;
  let minuteTimer = 0;
  let nativeRevision = -1;
  let snapshotVersion = '';
  let polling = false;
  let syncing = false;
  let syncAgain = false;
  const requests = new AbortController();

  function readStorage(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
  function writeStorage(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* memory state still works */ } }
  function loadDock(): DockState {
    try {
      const raw = JSON.parse(readStorage(DOCK_KEY) ?? 'null');
      if (raw && ['left', 'right', 'top', 'bottom'].includes(raw.edge) && Number.isFinite(raw.offset)) return raw;
    } catch { /* default dock */ }
    return { edge: 'right', offset: Math.round(window.innerHeight * .38) };
  }
  function loadPicks(): string[] | null {
    try {
      const raw = readStorage(PICKS_PREFIX + localDateKey());
      if (raw === null) return null;
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter(k => typeof k === 'string') : null;
    } catch { return null; }
  }
  let pickDay = localDateKey();
  let picks = loadPicks();
  function savePicks(value: string[]): void {
    picks = value;
    writeStorage(PICKS_PREFIX + localDateKey(), JSON.stringify(value));
  }
  function setCollapsed(value: boolean): void {
    collapsed = value;
    selecting = false;
    writeStorage(COLLAPSE_KEY, value ? '1' : '0');
    render();
  }
  function todayEntries(): FocusEntry[] {
    const plugin = deps.getPlugin();
    if (!plugin) return [];
    return pendingEntries(plugin.stores.root.data.cmd.focusPins ?? [], plugin.stores.kanban.getTasks() ?? [],
      plugin.stores.kanban.getProjects() ?? [], localDateKey());
  }
  function shownEntries(all: FocusEntry[]): FocusEntry[] { return selectEntries(all, picks); }
  function countLabel(entries: FocusEntry[]): string {
    return deps.t('focusRemaining').replace('{n}', String(entries.length));
  }
  function groupLabel(entries: FocusEntry[]): string {
    return deps.t('focusGroupCount').replace('{n}', String(groupEntries(entries).length));
  }
  function ballPosition(): { left: number; top: number } {
    const w = window.innerWidth, h = window.innerHeight;
    const vertical = dock.edge === 'left' || dock.edge === 'right';
    const offset = clamp(dock.offset, MARGIN, (vertical ? h : w) - BALL_SIZE - MARGIN);
    switch (dock.edge) {
      case 'left': return { left: MARGIN, top: offset };
      case 'right': return { left: Math.max(MARGIN, w - BALL_SIZE - MARGIN), top: offset };
      case 'top': return { left: offset, top: MARGIN };
      case 'bottom': return { left: offset, top: Math.max(MARGIN, h - BALL_SIZE - MARGIN) };
    }
  }

  /** One pointer lifecycle decides click versus drag. Cancel never activates. */
  function attachDrag(ball: HTMLElement): void {
    let pointer: number | null = null;
    let startX = 0, startY = 0, left = 0, top = 0, moved = false;
    let suppressClick = false;
    function cleanup(): void {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      if (pointer !== null && ball.hasPointerCapture?.(pointer)) ball.releasePointerCapture(pointer);
      pointer = null; dragging = false;
      ball.classList.remove('is-dragging');
    }
    function move(e: PointerEvent): void {
      if (e.pointerId !== pointer) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      moved ||= Math.hypot(dx, dy) > 6;
      if (!moved) return;
      e.preventDefault();
      ball.classList.add('is-dragging');
      ball.style.left = clamp(left + dx, 0, window.innerWidth - BALL_SIZE) + 'px';
      ball.style.top = clamp(top + dy, 0, window.innerHeight - BALL_SIZE) + 'px';
    }
    function cancel(): void { suppressClick = true; cleanup(); if (renderAfterDrag) render(); }
    function up(e: PointerEvent): void {
      if (e.pointerId !== pointer) return;
      // Include the final position even if the browser coalesced pointermove.
      moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 6;
      suppressClick = true;
      e.stopPropagation();
      const rect = ball.getBoundingClientRect();
      cleanup();
      if (!moved) { setCollapsed(false); return; }
      const cx = rect.left + BALL_SIZE / 2, cy = rect.top + BALL_SIZE / 2;
      const distances = [
        { edge: 'left' as Edge, d: cx, offset: rect.top },
        { edge: 'right' as Edge, d: window.innerWidth - cx, offset: rect.top },
        { edge: 'top' as Edge, d: cy, offset: rect.left },
        { edge: 'bottom' as Edge, d: window.innerHeight - cy, offset: rect.left },
      ].sort((a, b) => a.d - b.d);
      dock = { edge: distances[0].edge, offset: Math.round(distances[0].offset) };
      writeStorage(DOCK_KEY, JSON.stringify(dock));
      render();
    }
    ball.addEventListener('pointerdown', e => {
      if (e.button !== 0 || pointer !== null) return;
      e.stopPropagation();
      pointer = e.pointerId; startX = e.clientX; startY = e.clientY;
      const rect = ball.getBoundingClientRect(); left = rect.left; top = rect.top;
      moved = false; suppressClick = false; dragging = true;
      try { ball.setPointerCapture(e.pointerId); } catch { /* document listeners still handle mouse */ }
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', cancel, true);
      window.addEventListener('blur', cancel);
    });
    ball.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setCollapsed(false); }
    }, true);
    ball.addEventListener('click', e => {
      e.stopPropagation();
      if (e.detail > 0 && suppressClick) { suppressClick = false; return; }
      setCollapsed(false);
    }, true);
    cancelDrag = cleanup;
  }

  function iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'fl-focus-card__iconbtn', attr: { type: 'button', title: label, 'aria-label': label } });
    button.appendChild(buildIcon(icon, 16));
    onPress(button, action);
    return button;
  }
  function render(): void {
    if (disposed) return;
    if (dragging) { renderAfterDrag = true; return; }
    renderAfterDrag = false;
    if (!detachTheme && deps.getPlugin()) detachTheme = deps.getPlugin().theme.attach(root);
    cancelDrag?.(); cancelDrag = null;
    cancelAnimationFrame(positionFrame);
    const scroll = root.querySelector('.fl-focus-card__list')?.scrollTop ?? 0;
    root.empty();
    if (!deps.getPlugin()) return;
    const all = todayEntries(), shown = shownEntries(all);
    // Stay discoverable after the last selected task finishes.
    if (collapsed) renderBall(shown);
    else renderCard(all, shown);
    const list = root.querySelector('.fl-focus-card__list');
    if (list) list.scrollTop = scroll;
    if (pipWindow && !pipWindow.closed) renderPip();
    void syncNative();
  }
  function renderBall(shown: FocusEntry[]): void {
    const ball = root.createEl('button', { cls: 'fl-focus-ball', attr: {
      type: 'button', title: `${deps.t('focusExpand')} · ${countLabel(shown)} · ${deps.t('focusDragHint')}`,
      'aria-label': `${deps.t('focusExpand')} · ${countLabel(shown)}`, 'aria-expanded': 'false',
    } });
    const pos = ballPosition();
    ball.style.left = pos.left + 'px'; ball.style.top = pos.top + 'px';
    ball.appendChild(buildIcon('target', 18));
    ball.createSpan({ cls: 'fl-focus-ball__num', text: String(shown.length) });
    attachDrag(ball);
  }
  function renderCard(all: FocusEntry[], shown: FocusEntry[]): void {
    const card = root.createDiv({ cls: 'fl-focus-card' + (selecting ? ' is-selecting' : ''), attr: { role: 'region', 'aria-label': deps.t('focusBar') } });
    const head = card.createDiv({ cls: 'fl-focus-card__head' });
    head.createSpan({ cls: 'fl-focus-card__mark', attr: { 'aria-hidden': 'true' } }).appendChild(buildIcon('target', 14));
    head.createSpan({ cls: 'fl-focus-card__title', text: selecting ? deps.t('focusPickTitle') : deps.t('focusBar') });
    head.createSpan({ cls: 'fl-focus-card__num', text: selecting ? `${shown.length}/${all.length}` : countLabel(shown) });
    const pick = head.createEl('button', { cls: 'fl-focus-card__btn', attr: { type: 'button' }, text: selecting ? deps.t('focusPickDone') : deps.t('focusPick') });
    onPress(pick, () => { selecting = !selecting; render(); });
    if (!selecting) {
      const pop = iconButton(head, 'external-link', deps.t('focusPopout'), () => void openPopout());
      pop.disabled = nativeBusy;
      pop.setAttribute('aria-busy', String(nativeBusy));
    }
    iconButton(head, 'minus', deps.t('focusCollapse'), () => setCollapsed(true));
    card.createDiv({ cls: 'fl-focus-card__summary', text: selecting ? deps.t('focusPickHint') : `${groupLabel(shown)} · ${deps.t('focusPreviewHint')}` });
    if (nativeError) {
      const error = card.createDiv({ cls: 'fl-focus-error', attr: { role: 'alert' } });
      error.createSpan({ text: nativeError });
      const retry = error.createEl('button', { cls: 'fl-focus-card__btn', text: deps.t('focusRetry') });
      onPress(retry, () => void openPopout());
    }
    const list = card.createDiv({ cls: 'fl-focus-card__list' });
    renderGroups(list, selecting ? all : shown, selecting);
    positionFrame = requestAnimationFrame(() => positionCard(card));
  }
  function positionCard(card: HTMLElement): void {
    if (!card.isConnected) return;
    const pos = ballPosition(), rect = card.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    // The card occupies the ball's edge anchor; it does not reserve empty ball space.
    const left = dock.edge === 'right' ? w - rect.width - MARGIN : dock.edge === 'left' ? MARGIN : pos.left + BALL_SIZE / 2 - rect.width / 2;
    const top = dock.edge === 'bottom' ? h - rect.height - MARGIN : dock.edge === 'top' ? MARGIN : pos.top + BALL_SIZE / 2 - rect.height / 2;
    card.style.left = clamp(left, MARGIN, w - rect.width - MARGIN) + 'px';
    card.style.top = clamp(top, MARGIN, h - rect.height - MARGIN) + 'px';
  }
  function renderGroups(list: HTMLElement, entries: FocusEntry[], choosing = false): void {
    if (!entries.length) {
      list.createDiv({ cls: 'fl-focus-card__empty', text: deps.t(picks !== null && todayEntries().length ? 'focusNoneSelected' : 'focusEmpty') });
      return;
    }
    for (const group of groupEntries(entries)) {
      const section = list.createEl('section', { cls: 'fl-focus-group', attr: { 'data-task-id': group.task.id, 'aria-label': group.task.name } });
      const header = section.createDiv({ cls: 'fl-focus-group__head' });
      if (group.parent) buildRow(header, group.parent, choosing, true);
      else {
        const name = header.createEl('button', { cls: 'fl-focus-row__name is-parent-context', text: group.task.name, attr: { type: 'button', title: group.task.name } });
        onPress(name, () => deps.openTask(group.task.id));
        addPriority(header, group);
      }
      if (group.children.length) {
        const children = section.createDiv({ cls: 'fl-focus-group__children' });
        for (const entry of group.children) buildRow(children, entry, choosing, false);
      }
    }
  }
  function addPriority(parent: HTMLElement, group: FocusGroup): void {
    if (group.task.priority) parent.createSpan({ cls: 'fl-focus-row__pri pri-' + group.task.priority.toLowerCase(), text: group.task.priority });
  }
  function buildRow(parent: HTMLElement, entry: FocusEntry, choosing: boolean, isParent: boolean): void {
    const row = parent.createDiv({ cls: 'fl-focus-row' + (isParent ? ' is-parent' : ' is-sub'), attr: { 'data-pin-key': pinKeyOf(entry.pin) } });
    if (choosing) {
      const on = selectEntries([entry], picks).length > 0;
      const toggle = row.createEl('button', { cls: 'fl-pick-toggle', text: on ? '✓' : '', attr: {
        type: 'button', role: 'checkbox', 'aria-checked': String(on),
        'aria-label': `${deps.t(on ? 'focusUnpick' : 'focusPickOne')} · ${entry.subtask?.name ?? entry.task.name}`,
      } });
      onPress(toggle, () => {
        const keys = new Set(shownEntries(todayEntries()).map(item => pinKeyOf(item.pin)));
        const key = pinKeyOf(entry.pin);
        if (keys.has(key)) keys.delete(key); else keys.add(key);
        savePicks([...keys]); render();
        const replacement = Array.from(root.querySelectorAll<HTMLElement>('[data-pin-key]')).find(el => el.dataset.pinKey === key);
        replacement?.querySelector<HTMLButtonElement>('.fl-pick-toggle')?.focus();
      });
    }
    const name = row.createEl('button', { cls: 'fl-focus-row__name', text: entry.subtask?.name ?? entry.task.name,
      attr: { type: 'button', title: deps.t('focusOpenTask') + ' · ' + (entry.subtask?.name ?? entry.task.name) } });
    onPress(name, () => deps.openTask(entry.task.id, entry.pin.subtaskId));
    if (isParent) addPriority(row, { task: entry.task, children: [] });
    if (entry.subtask && entry.subtask.target > 0) row.createSpan({ cls: 'fl-focus-row__prog', text: `${entry.subtask.current || 0}/${entry.subtask.target}${entry.subtask.unit ? ' ' + entry.subtask.unit : ''}` });
    // Selecting belongs to this widget; completing and removing pins belong to the task board.
  }

  /* Native panel transport: bounded snapshots only; never execute caller-supplied HTML. */
  async function nativeRequest(op: string, payload: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, ...payload }), signal: requests.signal });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
    return result;
  }
  function snapshot(): Record<string, unknown> {
    const shown = shownEntries(todayEntries());
    const mode = deps.getPlugin()?.theme.effectiveMode ?? 'light';
    // Resolve the active host theme, including Paper/Ink, before crossing processes.
    const probe = document.createElement('span');
    probe.style.display = 'none'; root.appendChild(probe);
    const palette: Record<string, string> = {};
    for (const [name, token] of Object.entries({ bg: 'surface', surface: 'surface-subtle', text: 'text', secondary: 'text-secondary',
      border: 'border', accent: 'selection', danger: 'danger', warning: 'warning' })) {
      probe.style.color = `var(--ff-${token})`; palette[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return { title: deps.t('focusBar'), count: countLabel(shown), summary: `${groupLabel(shown)} · ${deps.t('focusPreviewHint')}`,
      empty: deps.t('focusEmpty'), mode, palette, groups: groupEntries(shown).map(group => ({
        taskId: group.task.id, name: group.task.name, priority: group.task.priority, parentPinned: !!group.parent,
        children: group.children.map(entry => ({ id: entry.subtask!.id, name: entry.subtask!.name,
          progress: entry.subtask!.target > 0 ? `${entry.subtask!.current || 0}/${entry.subtask!.target}${entry.subtask!.unit ? ' ' + entry.subtask!.unit : ''}` : '' })),
      })) };
  }
  async function syncNative(): Promise<void> {
    if (!nativeOpen || disposed) return;
    if (syncing) { syncAgain = true; return; }
    const data = snapshot(), version = JSON.stringify(data);
    if (version === snapshotVersion) return;
    syncing = true;
    try { await nativeRequest('update', { snapshot: data }); snapshotVersion = version; }
    catch (error) { if (!disposed) { nativeError = String((error as Error).message); nativeOpen = false; render(); } }
    finally { syncing = false; if (syncAgain) { syncAgain = false; void syncNative(); } }
  }
  async function pollNative(): Promise<void> {
    if (disposed || polling || (!nativeOpen && !nativeBusy)) return;
    polling = true;
    try {
      const state = await nativeRequest('status', { after: nativeRevision });
      nativeOpen = state.open;
      for (const event of state.events ?? []) {
        if (event.type === 'task') deps.openTask(event.taskId, event.subtaskId);
      }
      nativeRevision = state.revision;
      if (state.error) { nativeError = state.error; render(); }
    } catch { /* report on the next explicit open/update; no repeated dialogs */ }
    finally { polling = false; }
  }
  async function openPopout(): Promise<void> {
    if (nativeBusy || disposed) return;
    nativeBusy = true; nativeError = ''; render();
    try {
      if (!nativeSupported) {
        try { nativeSupported = (await nativeRequest('status')).supported; }
        catch (error) {
          if (location.protocol === 'dsh-app:') throw new Error('插件后台尚未加载系统悬浮窗接口，请重启 DSH 后重试。');
        }
      }
      if (nativeSupported) {
        const data = snapshot();
        const result = await nativeRequest('open', { snapshot: data });
        nativeOpen = true; snapshotVersion = JSON.stringify(data); nativeRevision = result.revision;
        if (disposed) { void nativeRequest('close'); return; }
        setCollapsed(true);
      } else if ('documentPictureInPicture' in window) {
        await openPip();
      } else throw new Error(deps.t('focusPopoutUnsupported'));
    } catch (error) { nativeError = `${deps.t('focusPopoutFailed')}：${String((error as Error).message)}`; }
    finally { nativeBusy = false; if (!disposed) render(); }
  }
  async function openPip(): Promise<void> {
    if (pipWindow && !pipWindow.closed) { pipWindow.focus(); return; }
    const pip: Window = await (window as any).documentPictureInPicture.requestWindow({ width: 280, height: 240 });
    if (disposed) { pip.close(); return; }
    pipWindow = pip;
    for (const style of Array.from(document.querySelectorAll('style[data-fl-styles]'))) pip.document.head.appendChild(style.cloneNode(true));
    pip.document.title = deps.t('focusBar');
    pip.document.body.classList.add('fl-pip-body');
    detachPipTheme = deps.getPlugin().theme.attach(pip.document.body);
    pip.addEventListener('pagehide', () => { if (pipWindow === pip) { detachPipTheme?.(); detachPipTheme = null; pipWindow = null; } }, { once: true });
    renderPip();
  }
  function renderPip(): void {
    if (!pipWindow || pipWindow.closed) return;
    const body = pipWindow.document.body; body.textContent = '';
    // Build with the main document's DOM helpers; adoptNode preserves handlers.
    const content = document.createElement('div');
    const entries = shownEntries(todayEntries());
    content.createDiv({ cls: 'fl-pip-title', text: `${deps.t('focusBar')} · ${countLabel(entries)}` });
    renderGroups(content.createDiv({ cls: 'fl-pip-list' }), entries);
    body.appendChild(pipWindow.document.adoptNode(content));
  }

  const resize = (): void => { if (dragging) cancelDrag?.(); render(); };
  const escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !collapsed && root.contains(e.target as Node)) { e.stopPropagation(); setCollapsed(true); }
  };
  const storage = (e: StorageEvent): void => {
    if (e.key === COLLAPSE_KEY) collapsed = e.newValue !== '0';
    else if (e.key === DOCK_KEY) dock = loadDock();
    else if (e.key === PICKS_PREFIX + localDateKey()) picks = loadPicks();
    else return;
    render();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('storage', storage);
  root.addEventListener('keydown', escape);
  const themeObserver = new MutationObserver(() => { if (pipWindow || nativeOpen) render(); });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style', 'data-dsh-skin'] });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-dsh-skin', 'data-theme'] });
  void deps.ensureBooted().then(async () => {
    if (disposed) return;
    const plugin = deps.getPlugin(); if (!plugin) return;
    unsubs.push(plugin.stores.root.subscribe(render), plugin.stores.kanban.subscribe(render));
    render();
    try {
      const state = await nativeRequest('status');
      if (disposed) return;
      nativeSupported = state.supported; nativeOpen = state.open; nativeRevision = state.revision;
      render();
    } catch { /* browser/older host: PiP capability is checked when opening */ }
    if (disposed) return;
    pollTimer = window.setInterval(() => void pollNative(), 1000);
    minuteTimer = window.setInterval(() => {
      const day = localDateKey();
      if (day !== pickDay) { pickDay = day; picks = loadPicks(); render(); }
    }, 60000);
  }).catch(error => console.warn('[feifan-life] focus boot failed', error));

  return () => {
    disposed = true;
    cancelDrag?.(); cancelAnimationFrame(positionFrame);
    unsubs.splice(0).forEach(unsub => unsub());
    window.clearInterval(pollTimer); window.clearInterval(minuteTimer);
    window.removeEventListener('resize', resize); window.removeEventListener('storage', storage);
    themeObserver.disconnect();
    if (pipWindow && !pipWindow.closed) pipWindow.close();
    detachPipTheme?.(); detachTheme?.();
    // The Host owns the panel lifecycle; on full plugin disposal its effect closes the process.
    requests.abort(); root.remove();
  };
}
