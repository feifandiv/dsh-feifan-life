// 落库：data.json → Markdown 笔记镜像（迭代 005）
// 单向同步：主数据仍是 data.json；落库目录生成可被 [[双链]] 引用的 .md 副本。
// - 每个项目 → 项目-<name>.md（含其任务清单）
// - 每个游离任务 → 任务-<name>.md
// 按 frontmatter 的 kanbanId 幂等更新；名称变更时重命名文件。

import { Notice, TFile, TFolder } from 'obsidian';
import type { KanbanCtx } from './models';
type ProjectKanbanPlugin = KanbanCtx;
import { Project, Task, projectProgress, taskSubtasks, taskProgress, taskIsDone, taskStatusLabel } from './models';

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || '未命名';
}

function yamlFrontmatter(obj: Record<string, unknown>): string {
  let s = '---\n';
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) s += `${k}: [${v.join(', ')}]\n`;
    else if (typeof v === 'string') s += `${k}: ${JSON.stringify(v)}\n`;
    else s += `${k}: ${v}\n`;
  }
  s += '---\n';
  return s;
}

async function ensureFolder(plugin: ProjectKanbanPlugin, path: string): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    const f = plugin.app.vault.getAbstractFileByPath(cur);
    if (!f && !(await adapter.exists(cur))) await plugin.app.vault.createFolder(cur);
  }
}

/** 在落库目录中按 kanbanId 找到已存在笔记文件 */
async function findNoteByKanbanId(
  plugin: ProjectKanbanPlugin,
  basePath: string,
  id: string,
): Promise<TFile | null> {
  const folder = plugin.app.vault.getAbstractFileByPath(basePath);
  if (!(folder instanceof TFolder)) return null;
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === 'md') {
      const cache = plugin.app.metadataCache.getFileCache(child);
      if (cache?.frontmatter?.kanbanId === id) return child;
    }
  }
  return null;
}

async function writeNote(
  plugin: ProjectKanbanPlugin,
  basePath: string,
  kanbanId: string,
  fileNameBase: string,
  content: string,
): Promise<void> {
  const targetName = `${sanitize(fileNameBase)}.md`;
  let targetPath = `${basePath}/${targetName}`;
  const existing = await findNoteByKanbanId(plugin, basePath, kanbanId);
  // Same-name tasks are distinct records. Preserve a note owned by another ID
  // (or a manually authored note) and use a stable per-record filename.
  const collision = plugin.app.vault.getAbstractFileByPath(targetPath);
  if (collision && collision.path !== existing?.path) {
    const stem = sanitize(fileNameBase) + '-' + sanitize(kanbanId);
    targetPath = `${basePath}/${stem}.md`;
    let suffix = 2;
    while (plugin.app.vault.getAbstractFileByPath(targetPath)
      && targetPath !== existing?.path) targetPath = `${basePath}/${stem}-${suffix++}.md`;
  }
  if (existing) {
    if (existing.path !== targetPath) {
      await plugin.app.vault.rename(existing, targetPath);
    }
    const file = plugin.app.vault.getAbstractFileByPath(targetPath);
    if (file instanceof TFile) await plugin.app.vault.modify(file, content);
  } else {
    await plugin.app.vault.create(targetPath, content);
  }
}

function projectBody(p: Project, tasks: Task[]): string {
  const lines: string[] = [];
  lines.push(`# ${p.name}`, '');
  lines.push(`> 分类：${p.category} · 优先级：${p.priority}` + (p.tags.length ? ` · 标签：${p.tags.join(', ')}` : ''), '');
  if (p.description) lines.push(p.description, '');
  const prog = projectProgress(tasks, p.id);
  lines.push(`## 任务（${prog.done}/${prog.total}）`, '');
  if (tasks.length === 0) {
    lines.push('_暂无任务_', '');
  } else {
    for (const t of tasks) {
      const box = taskIsDone(t) ? 'x' : ' ';
      const archTag = t.archived ? ' · 已归档' : ''; // 优化-009：归档任务仍列出，标注已归档
      lines.push(`- [${box}] ${t.name}（${t.priority} · ${taskStatusLabel(t)}${archTag}）`);
      const subs = taskSubtasks(t);
      if (subs.length > 0) {
        const tp = taskProgress(t);
        for (const s of subs) {
          const sbox = s.done ? 'x' : ' ';
          lines.push(`  - [${sbox}] ${s.name}（${s.current || 0}/${s.target}）`);
        }
        lines.push(`  - _子项进度 ${tp.pct}%_`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function taskBody(t: Task): string {
  const parts: string[] = [];
  if (t.note) parts.push(t.note);
  else parts.push('_（无备注）_');
  const subs = taskSubtasks(t);
  if (subs.length > 0) {
    const tp = taskProgress(t);
    parts.push('', `## 子项（${tp.pct}%）`, '');
    for (const s of subs) {
      const sbox = s.done ? 'x' : ' ';
      parts.push(`- [${sbox}] ${s.name}（${s.current || 0}/${s.target}）`);
    }
  }
  return parts.join('\n') + '\n';
}

export interface SyncResult {
  projects: number;
  tasks: number;
  path: string;
}

/** 一键同步到知识库（迭代 005） */
export async function syncToVault(plugin: ProjectKanbanPlugin): Promise<SyncResult> {
  const store = plugin.store;
  const basePath = store.getSettings().vaultPath || '02-长期领域/03任务看板';
  await ensureFolder(plugin, basePath);

  // 项目笔记（含任务清单）
  for (const p of store.getProjects()) {
    const tasks = store.getTasksOfProject(p.id);
    const content =
      yamlFrontmatter({
        kanbanId: p.id,
        type: 'kanban-project',
        name: p.name,
        category: p.category,
        priority: p.priority,
        startDate: p.startDate,
        due: p.dueDate,
        created: new Date(p.createdAt).toISOString().slice(0, 10),
        tags: ['看板', '项目', ...p.tags],
      }) + '\n' + projectBody(p, tasks);
    await writeNote(plugin, basePath, p.id, `项目-${p.name}`, content);
  }

  // 游离任务笔记
  for (const t of store.getTasks()) {
    if (t.projectId) continue; // 归属项目的任务已写入项目笔记
    const content =
      yamlFrontmatter({
        kanbanId: t.id,
        type: 'kanban-task',
        name: t.name,
        done: t.done,
        archived: t.archived, // 优化-009
        completedAt: t.completedAt, // 优化-009
        progress: taskProgress(t).pct,
        priority: t.priority,
        due: t.dueDate,
        created: new Date(t.createdAt).toISOString().slice(0, 10),
        tags: ['看板', '任务', ...t.tags],
      }) + '\n' + taskBody(t);
    await writeNote(plugin, basePath, t.id, `任务-${t.name}`, content);
  }

  const result: SyncResult = {
    projects: store.getProjects().length,
    tasks: store.getTasks().filter((t) => !t.projectId).length,
    path: basePath,
  };
  new Notice(`已同步 ${result.projects} 个项目 / ${result.tasks} 个游离任务 → ${basePath}`);
  return result;
}
