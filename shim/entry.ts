/**
 * DSH entry: mount the ported Obsidian plugin in the native DSH main panel.
 *
 * Boot order matters. The vault index must exist before `plugin.onload()`
 * because the root store validates its data synchronously against the file
 * tree, then `activate()` asks the workspace for a leaf, and the leaf appends
 * the view into the stage element this module owns.
 */
import { App } from './app';
import { installDomHelpers, buildIcon } from './dom';
import { APP_CSS, BASE_CSS, SHELL_CSS, PORT_CSS } from './styles.generated';
import CommandCenterPlugin from '../app/src/main';
import { health } from './api';

export const inject = ['slots', 'locale', 'layout'];

const MANIFEST = {
  id: 'feifan-life',
  name: '非凡人生',
  version: '0.2.3',
  minAppVersion: '1.14.5',
  description: '非凡人生 · 任务 / 规划 / 财务 / 清单 / 习惯 / 灵感 / 复盘',
  author: '非凡',
  isDesktopOnly: false,
};

interface HostLayout { selectPanel(id: string | null): void; }
let layout: HostLayout;
let resolveMount: (() => void) | null = null;

interface ShellState {
  overlay: HTMLElement | null;
  stage: HTMLElement | null;
  status: HTMLElement | null;
  loading: HTMLElement | null;
  error: HTMLElement | null;
  app: App | null;
  plugin: CommandCenterPlugin | null;
  booting: Promise<void> | null;
  booted: boolean;
  open: boolean;
  locale: 'zh' | 'en';
  themeObserver: MutationObserver | null;
}

const state: ShellState = {
  overlay: null,
  stage: null,
  status: null,
  loading: null,
  error: null,
  app: null,
  plugin: null,
  booting: null,
  booted: false,
  open: false,
  locale: 'zh',
  themeObserver: null,
};

const COPY = {
  zh: {
    welcome: '正在载入非凡人生…',
    indexing: '正在索引知识库文件…',
    loading: '正在读取数据…',
    booting: '正在启动…',
    reload: '重新载入数据',
    reloading: '正在重新载入数据…',
    close: '关闭',
    launcher: '非凡人生',
    launcherHint: '打开非凡人生',
    reloaded: '已重新载入数据',
    failed: '非凡人生启动失败',
    retry: '重试',
    apiMissing: '未找到宿主文件接口（/dsh-feifan-life/api）。请确认插件已安装并重载页面。',
  },
  en: {
    welcome: 'Loading Feifan Life…',
    indexing: 'Indexing vault files…',
    loading: 'Reading data…',
    booting: 'Starting…',
    reload: 'Reload data',
    reloading: 'Reloading data…',
    close: 'Close',
    launcher: 'Feifan Life',
    launcherHint: 'Open Feifan Life',
    reloaded: 'Data reloaded',
    failed: 'Feifan Life failed to start',
    retry: 'Retry',
    apiMissing: 'Host filesystem API missing (/dsh-feifan-life/api). Reinstall the plugin and reload the page.',
  },
} as const;

function t(key: keyof (typeof COPY)['zh']): string {
  return COPY[state.locale][key];
}

function ensureStyles(): void {
  if (document.querySelector('style[data-fl-styles]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-fl-styles', '');
  style.textContent = APP_CSS + '\n' + BASE_CSS + '\n' + SHELL_CSS + '\n' + PORT_CSS;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ shell */

function ensureOverlay(host: HTMLElement): HTMLElement {
  if (state.overlay) {
    if (state.overlay.parentElement !== host) host.appendChild(state.overlay);
    return state.overlay;
  }
  const overlay = document.createElement('div');
  overlay.id = 'fl-overlay';
  overlay.setAttribute('data-fl-open', 'false');
  overlay.tabIndex = -1;

  const chrome = document.createElement('div');
  chrome.id = 'fl-chrome';
  const status = document.createElement('span');
  status.id = 'fl-status';
  chrome.appendChild(status);
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'fl-chrome-btn';
  reload.title = t('reload');
  reload.setAttribute('aria-label', t('reload'));
  reload.appendChild(buildIcon('refresh-cw', 16));
  reload.addEventListener('click', () => void reloadData());
  chrome.appendChild(reload);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fl-chrome-btn';
  close.title = t('close');
  close.setAttribute('aria-label', t('close'));
  close.appendChild(buildIcon('x', 16));
  close.addEventListener('click', () => closeApp());
  chrome.appendChild(close);
  overlay.appendChild(chrome);

  const stage = document.createElement('div');
  stage.id = 'fl-stage';
  overlay.appendChild(stage);

  const loading = document.createElement('div');
  loading.id = 'fl-loading';
  const spinner = document.createElement('div');
  spinner.className = 'fl-spinner';
  loading.appendChild(spinner);
  const loadingText = document.createElement('div');
  loadingText.className = 'fl-loading-text';
  loadingText.textContent = t('welcome');
  loading.appendChild(loadingText);
  overlay.appendChild(loading);

  const error = document.createElement('div');
  error.id = 'fl-error';
  error.hidden = true;
  overlay.appendChild(error);

  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('[data-fl-portal].modal-container')) return;
    if (document.querySelector('[data-fl-portal].menu, .ff-menu-portal, .ff-select-portal')) return;
    event.preventDefault();
    closeApp();
  });

  host.appendChild(overlay);
  state.overlay = overlay;
  state.stage = stage;
  state.status = status;
  state.loading = loading;
  state.error = error;
  state.themeObserver = new MutationObserver(syncTheme);
  state.themeObserver.observe(stage, { subtree: true, attributes: true, attributeFilter: ['data-ff-mode'] });
  syncTheme();
  return overlay;
}

function setStatus(text: string): void {
  if (state.status) state.status.textContent = text;
  const loadingText = state.loading?.querySelector('.fl-loading-text');
  if (loadingText && text) loadingText.textContent = text;
}

function showLoading(text: string): void {
  if (!state.loading) return;
  state.loading.hidden = false;
  state.loading.removeAttribute('hidden');
  const loadingText = state.loading.querySelector('.fl-loading-text');
  if (loadingText) loadingText.textContent = text;
}

function hideLoading(): void {
  if (state.loading) state.loading.hidden = true;
}

function showError(error: unknown): void {
  if (!state.error) return;
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  state.error.hidden = false;
  state.error.textContent = '';
  const title = document.createElement('div');
  title.className = 'fl-error-title';
  title.textContent = t('failed');
  const detail = document.createElement('pre');
  detail.className = 'fl-error-detail';
  detail.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'fl-error-retry';
  retry.textContent = t('retry');
  retry.addEventListener('click', () => {
    state.error!.hidden = true;
    state.booting = null;
    state.booted = false;
    void openApp();
  });
  state.error.append(title, detail, retry);
}

/** Follow the plugin's own resolved theme so shell chrome matches the surface. */
function syncTheme(): void {
  const overlay = state.overlay;
  if (!overlay) return;
  const attached = document.querySelector('#fl-stage [data-ff-mode]') as HTMLElement | null;
  let mode = attached?.getAttribute('data-ff-mode');
  if (!mode) {
    const bodyClass = document.body.className + ' ' + document.documentElement.className;
    if (/theme-dark|dark/i.test(bodyClass)) mode = 'dark';
    else if (/theme-light|light/i.test(bodyClass)) mode = 'light';
    else mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  overlay.dataset.flTheme = mode;
}

/* ------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  if (state.booted) return;
  if (state.booting) return state.booting;
  state.booting = (async () => {
    showLoading(t('indexing'));
    const app = new App();
    app.mountTarget = state.stage;
    app.workspace.mountTarget = state.stage;
    app.workspace.revealHandler = () => {
      showLoading(t('booting'));
      window.setTimeout(() => hideLoading(), 30);
    };
    state.app = app;
    await app.vault.ensureIndex((phase) => setStatus(phase));
    setStatus(t('loading'));
    showLoading(t('loading'));
    const plugin = new CommandCenterPlugin(app as never, MANIFEST as never);
    state.plugin = plugin;
    await plugin.onload();
    state.booted = true;
    setStatus('');
    const settings = (plugin as unknown as { stores: { root: { data: { settings: Record<string, string> } } } }).stores.root.data.settings;
    await app.vault.warmMarkdown(settings.mirrorPath || '02-任务看板');
    syncTheme();
  })();
  try {
    await state.booting;
  } catch (error) {
    state.booting = null;
    state.booted = false;
    throw error;
  }
}

async function openApp(tab = 'overview'): Promise<void> {
  if (!state.overlay?.isConnected) {
    const mounted = new Promise<void>(resolve => { resolveMount = resolve; });
    layout.selectPanel('feifan-life');
    await mounted;
  }
  const overlay = state.overlay;
  if (!overlay) return;
  overlay.setAttribute('data-fl-open', 'true');
  state.open = true;
  overlay.focus();
  try {
    showLoading(t('welcome'));
    await boot();
    const plugin = state.plugin as unknown as { activate(tab?: string): Promise<void> };
    await plugin.activate(tab);
    hideLoading();
    syncTheme();
    const view = document.querySelector('#fl-stage .workspace-leaf-content .view-content') as HTMLElement | null;
    if (view && !view.dataset.flStyled) {
      view.dataset.flStyled = '1';
      const header = view.parentElement?.querySelector('.view-header') as HTMLElement | null;
      if (header) header.style.display = 'none';
    }
  } catch (error) {
    hideLoading();
    showError(error);
    console.error('[feifan-life] 启动失败', error);
  }
}

function closeApp(): void {
  const overlay = state.overlay;
  if (!overlay) return;
  overlay.setAttribute('data-fl-open', 'false');
  state.open = false;
  layout.selectPanel(null);
}

async function reloadData(): Promise<void> {
  const plugin = state.plugin as unknown as {
    stores: {
      root: { load(): Promise<void>; normalize(): boolean; save(): Promise<void> };
      life: { load(): Promise<void> };
      finance: { load(): Promise<void> };
      kanban: { load(): Promise<void> };
    };
    activeView: { refreshSoft(): void } | null;
  } | null;
  if (!plugin) {
    await openApp();
    return;
  }
  setStatus(t('reloading'));
  try {
    await (plugin.stores.root as unknown as { flush(): Promise<void> }).flush();
    await plugin.stores.root.load();
    plugin.stores.root.normalize();
    await plugin.stores.life.load();
    await plugin.stores.finance.load();
    await plugin.stores.kanban.load();
    await plugin.stores.root.save();
    plugin.activeView?.refreshSoft();
  } catch (error) {
    showError(error);
  } finally {
    setStatus('');
  }
}

/* ------------------------------------------------------------ slot wiring */

/** The native keyed main slot owns geometry; keep the loaded view on navigation. */
function makeSlotComponent(React: { createElement: (...args: unknown[]) => unknown }): unknown {
  // A stable ref avoids reopening/resetting the tab when the host rerenders.
  const ref = (host: HTMLElement | null): void => {
    if (!host) { state.open = false; return; }
    ensureOverlay(host);
    if (resolveMount) { const resolve = resolveMount; resolveMount = null; resolve(); }
    else void openApp();
  };
  return function FeifanLifeSlot() {
    return React.createElement('div', {
      className: 'fl-slot',
      'data-fl-slot': 'feifan-life',
      ref,
    });
  };
}

/** DSH supplies the native row, selection state, label and click handling. */
function makePanelIcon(React: { createElement: (...args: unknown[]) => unknown }, props: { size?: number }): unknown {
  const size = props.size ?? 16;
  return React.createElement('span', {
    style: { display: 'inline-flex', width: size, height: size },
    'aria-hidden': true,
    dangerouslySetInnerHTML: { __html: buildIcon('compass', size).outerHTML },
  });
}

export function apply(ctx: {
  layout: HostLayout;
  slots: {
    inject: (slot: string, factory: () => unknown) => void;
    register: (options: Record<string, unknown>, component: unknown) => unknown;
  };
  locale?: { getLocale?: () => { id?: string; locale?: string } | null };
  effect?: (fn: () => void | (() => void), label?: string) => void;
  get?: (name: string) => unknown;
}): () => void {
  layout = ctx.layout;
  installDomHelpers();
  ensureStyles();

  try {
    const locale = ctx.locale?.getLocale?.();
    const id = String(locale?.id ?? locale?.locale ?? '');
    if (id.toLowerCase().startsWith('en')) state.locale = 'en';
  } catch {
    /* locale probing is best-effort */
  }

  // The bundle wrapper seeds this from the module table's `react` before
  // `apply` runs, so no separate external import is needed inside the factory.
  const React = (globalThis as unknown as { __FL_REACT__?: unknown }).__FL_REACT__ as
    | { createElement: (...args: unknown[]) => unknown }
    | undefined;

  void health().then((info) => {
    if (!info) console.warn('[feifan-life] host filesystem API is not responding');
  });

  if (React?.createElement) {
    const slot = makeSlotComponent(React);
    const icon = (props: { size?: number }) => makePanelIcon(React, props);
    try {
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'feifan-life', id: 'feifan-life.main' }, slot),
      );
    } catch (error) {
      console.warn('[feifan-life] main panel registration failed', error);
    }
    try {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: 'feifan-life', order: 20, label: () => t('launcher') }, icon),
      );
    } catch (error) {
      console.warn('[feifan-life] launcher registration failed', error);
    }
  } else {
    console.error('[feifan-life] React is not reachable from the client module table');
  }

  const handle = {
    version: '0.2.3',
    open: (tab?: string) => openApp(tab),
    close: closeApp,
    reload: () => reloadData(),
    state: () => ({ booted: state.booted, open: state.open, theme: state.overlay?.dataset.flTheme }),
    plugin: () => state.plugin,
    app: () => state.app,
    /** Attach the shell to a host element directly; used by the smoke test. */
    attach: (host: HTMLElement) => ensureOverlay(host),
    ensureStyles,
  };
  (window as unknown as { __dshFeifanLife?: unknown }).__dshFeifanLife = handle;

  const dispose = () => {
    const overlay = state.overlay;
    if (overlay) overlay.remove();
    state.themeObserver?.disconnect();
    state.themeObserver = null;
    state.overlay = null;
    state.stage = null;
    state.status = null;
    state.loading = null;
    state.error = null;
    try {
      void (state.plugin as unknown as { onunload?: () => Promise<void> } | null)?.onunload?.();
    } catch (error) {
      console.warn('[feifan-life] onunload failed', error);
    }
    state.plugin?.disposeRegistrations();
    void state.app?.workspace.leaves.forEach(leaf => void leaf.detach());
    state.plugin = null;
    state.booted = false;
    state.booting = null;
    document.querySelector('style[data-fl-styles]')?.remove();
    delete (window as unknown as { __dshFeifanLife?: unknown }).__dshFeifanLife;
  };
  ctx.effect?.(() => dispose, 'feifan-life: lifecycle');
  return dispose;
}
