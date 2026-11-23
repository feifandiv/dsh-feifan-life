/** Native read-only macOS panel owned and disposed by this plugin's Host. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
const nativeDir = fileURLToPath(new URL('../native/', import.meta.url));
let building;

export async function buildFocusHelper() {
  if (process.platform !== 'darwin') throw new Error('系统置顶小窗目前支持 macOS。');
  if (building) return building;
  building = (async () => {
    const source = path.join(nativeDir, 'FocusPanel.swift');
    const hash = createHash('sha256').update(await fs.readFile(source)).update(process.arch).digest('hex').slice(0, 16);
    const cache = path.join(os.homedir(), 'Library', 'Caches', 'dsh-feifan-life', 'focus-' + hash);
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const app = path.join(cache, 'FeifanFocus.app', 'Contents');
    const binary = path.join(app, 'MacOS', 'FocusPanel');
    await fs.mkdir(path.dirname(binary), { recursive: true });
    await fs.writeFile(path.join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.feifan.dsh.focuspanel</string><key>CFBundleName</key><string>非凡聚焦</string><key>CFBundleExecutable</key><string>FocusPanel</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`);
    try { await fs.access(binary, 1); return binary; } catch { /* compile only once per source revision */ }
    const temporary = path.join(cache, `FocusPanel-${process.pid}-${Date.now()}`);
    try {
      await run('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', temporary, '-framework', 'AppKit', '-framework', 'WebKit'], { timeout: 120000, maxBuffer: 1024 * 1024 });
      await fs.chmod(temporary, 0o700);
      await fs.rename(temporary, binary);
      return binary;
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw new Error('无法构建 macOS 悬浮窗。请确认已安装 Xcode Command Line Tools。' + (error.stderr ? '\n' + String(error.stderr).slice(-600) : ''));
    }
  })();
  // Only coalesce compilation in flight. A later open must re-hash the source;
  // otherwise a long-running DSH keeps launching an outdated cached binary.
  try { return await building; } finally { building = null; }
}

export function validateSnapshot(input) {
  if (!input || !Array.isArray(input.groups) || input.groups.length > 2000) throw new Error('invalid focus snapshot');
  const str = (s, max = 2000) => { if (typeof s !== 'string' || s.length > max) throw new Error('invalid focus text'); return s; };
  const palette = {};
  for (const key of ['bg', 'surface', 'text', 'secondary', 'border', 'accent', 'danger', 'warning']) {
    const color = input.palette?.[key];
    // Only resolved colors can cross the bridge; never arbitrary CSS or URLs.
    if (typeof color === 'string' && color.length <= 100 && /^(#[\da-f]{3,8}|rgba?\([\d.,% /]+\)|color\(srgb[\d.,% /]+\))$/i.test(color)) palette[key] = color;
  }
  return {
    title: str(input.title), count: str(input.count), summary: str(input.summary), empty: str(input.empty),
    mode: input.mode === 'dark' ? 'dark' : 'light', palette,
    groups: input.groups.map(group => ({
      taskId: str(group.taskId, 200), name: str(group.name),
      priority: ['P0', 'P1', 'P2', 'P3'].includes(group.priority) ? group.priority : '', parentPinned: group.parentPinned === true,
      children: (() => {
        if (!Array.isArray(group.children) || group.children.length > 2000) throw new Error('invalid focus children');
        return group.children.map(child => ({ id: str(child.id, 200), name: str(child.name), progress: str(child.progress) }));
      })(),
    })),
  };
}

export function createFocusWindow({ launch = spawn, compile = buildFocusHelper, platform = process.platform, activate = () => {
  // Bring the owning desktop app forward only when the user chooses a task/return.
  const child = spawn('/usr/bin/open', ['-b', 'com.deepseek.dsh'], { stdio: 'ignore' });
  child.on('error', () => {});
} } = {}) {
  let child = null, opening = null, disposed = false, revision = 0, error = '';
  let snapshot = null;
  const events = [];
  function send(type, value = {}) {
    if (child && !child.killed && child.stdin.writable) child.stdin.write(JSON.stringify({ type, ...value }) + '\n');
  }
  function event(value) { events.push({ ...value, revision: ++revision }); if (events.length > 100) events.shift(); }
  function status(after = revision) {
    return { ok: true, supported: platform === 'darwin', open: !!child, revision, error,
      events: events.filter(e => e.revision > after) };
  }
  function receive(message) {
    if (message.type === 'error') error = String(message.message).slice(0, 1000);
    if (message.type === 'return') activate();
    if (message.type === 'task' && typeof message.taskId === 'string') {
      const group = snapshot?.groups.find(g => g.taskId === message.taskId);
      if (!group || (message.subtaskId && !group.children.some(c => c.id === message.subtaskId))) return;
      event({ type: 'task', taskId: message.taskId, ...(message.subtaskId ? { subtaskId: message.subtaskId } : {}) });
      activate();
    }
  }
  async function open(data) {
    snapshot = validateSnapshot(data);
    error = '';
    if (child && !opening) { send('snapshot', { snapshot }); send('show'); return status(); }
    if (!opening) {
      opening = (async () => {
        if (platform !== 'darwin') throw new Error('系统悬浮窗目前支持 macOS。');
        const executable = await compile();
        if (disposed) throw new Error('plugin disposed');
        await new Promise((resolve, reject) => {
          const proc = launch(executable, [path.join(nativeDir, 'focus.html')], { stdio: ['pipe', 'pipe', 'pipe'] });
          child = proc;
          let buffer = '', stderr = '', ready = false;
          const timeout = setTimeout(() => { proc.kill(); reject(new Error('系统悬浮窗启动超时。')); }, 15000);
          proc.stdin.on('error', e => { error = e.message; });
          proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
          proc.stdout.on('data', chunk => {
            buffer += chunk.toString();
            if (buffer.length > 1024 * 1024) { proc.kill(); return; }
            let i;
            while ((i = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
              try {
                const message = JSON.parse(line);
                if (message.type === 'ready') { ready = true; clearTimeout(timeout); send('snapshot', { snapshot }); resolve(); }
                else receive(message);
              } catch { /* native diagnostics are not commands */ }
            }
          });
          proc.on('error', e => { clearTimeout(timeout); if (child === proc) child = null; reject(e); });
          proc.on('exit', (code, signal) => {
            clearTimeout(timeout);
            if (child === proc) child = null;
            if (!ready) reject(new Error('系统悬浮窗启动失败：' + (stderr || signal || code)));
            else if (code && !disposed) error = '系统悬浮窗意外退出，请重新打开。';
          });
        });
      })();
    }
    try { await opening; } finally { opening = null; }
    return status();
  }
  return {
    async handle(request) {
      if (disposed) throw new Error('plugin disposed');
      switch (request?.op) {
        case 'status': return status(Number.isFinite(request.after) ? request.after : revision);
        case 'open': return await open(request.snapshot);
        case 'update': snapshot = validateSnapshot(request.snapshot); send('snapshot', { snapshot }); return status();
        case 'close': send('close'); child?.kill(); child = null; return status();
        default: throw new Error('unknown focus window operation');
      }
    },
    dispose() { disposed = true; send('close'); child?.kill(); child = null; },
  };
}
