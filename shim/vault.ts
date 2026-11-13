/**
 * `app.vault` for the port: a file index plus async adapter operations.
 *
 * Obsidian's vault API mixes sync and async access. The plugin relies on the
 * split: `getAbstractFileByPath` and `getMarkdownFiles` return synchronously
 * (guarding review writes and the task mirror), while reads and writes are
 * awaited. The index is therefore fetched once at boot, then patched by every
 * mutation this client performs, which keeps the sync answers correct without
 * blocking.
 */
import { fsOp, assetUrl } from './api';

export class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null = null;
  vault: Vault;

  constructor(vault: Vault, path: string) {
    this.vault = vault;
    this.path = path;
    const index = path.lastIndexOf('/');
    this.name = index < 0 ? path : path.slice(index + 1);
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat = { ctime: 0, mtime: 0, size: 0 };

  constructor(vault: Vault, path: string) {
    super(vault, path);
    const dot = this.name.lastIndexOf('.');
    this.basename = dot <= 0 ? this.name : this.name.slice(0, dot);
    this.extension = dot <= 0 ? '' : this.name.slice(dot + 1);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export interface FileCache {
  frontmatter?: Record<string, unknown>;
  tags?: string[];
}

type ListResult = { files: string[]; folders: string[] };

export class VaultAdapter {
  constructor(private vault: Vault) {}

  async exists(path: string): Promise<boolean> {
    const result = await fsOp('exists', { path });
    return result.exists === true;
  }

  async read(path: string): Promise<string> {
    const result = await fsOp('read', { path });
    if (!result.exists) throw new Error('ENOENT: ' + path);
    return String(result.text ?? '');
  }

  async write(path: string, text: string): Promise<void> {
    await fsOp('write', { path, text });
  }

  async mkdir(path: string): Promise<void> {
    await fsOp('mkdir', { path });
  }

  async list(path: string): Promise<ListResult> {
    const result = await fsOp('list', { path });
    return { files: (result.files as string[]) ?? [], folders: (result.folders as string[]) ?? [] };
  }

  async remove(path: string): Promise<void> {
    await fsOp('remove', { path });
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    const result = await fsOp('stat', { path });
    if (!result.exists) return null;
    return { mtime: Number(result.mtime ?? 0), size: Number(result.size ?? 0) };
  }

  getResourcePath(file: TFile | string): string {
    return assetUrl(typeof file === 'string' ? file : file.path);
  }
}

export class Vault {
  readonly adapter: VaultAdapter;
  readonly configDir = '.obsidian';
  private index = new Map<string, TAbstractFile>();
  private contentCache = new Map<string, string>();
  private cacheCache = new Map<string, FileCache>();
  private indexed = false;
  private indexing: Promise<void> | null = null;

  constructor() {
    this.adapter = new VaultAdapter(this);
  }

  /** Fetch the whole file tree once so sync lookups answer correctly. */
  ensureIndex(onProgress?: (phase: string) => void, refresh = false): Promise<void> {
    if (refresh) { this.indexed = false; this.indexing = null; }
    if (this.indexed) return Promise.resolve();
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      onProgress?.('正在索引知识库文件…');
      const result = await fsOp('tree', { path: '' });
      const entries = (result.entries as Array<{ path: string; type: string }>) ?? [];
      this.index.clear();
      const folders = new Map<string, TFolder>();
      const ensureFolder = (path: string): TFolder => {
        const existing = folders.get(path);
        if (existing) return existing;
        const folder = new TFolder(this, path);
        folders.set(path, folder);
        this.index.set(path, folder);
        const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (parentPath) {
          const parent = ensureFolder(parentPath);
          parent.children.push(folder);
          folder.parent = parent;
        }
        return folder;
      };
      for (const entry of entries) {
        if (entry.type === 'folder') {
          ensureFolder(entry.path);
        } else {
          const file = new TFile(this, entry.path);
          this.index.set(entry.path, file);
          const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
          if (parentPath) {
            const parent = ensureFolder(parentPath);
            parent.children.push(file);
            file.parent = parent;
          }
        }
      }
      this.indexed = true;
    })();
    return this.indexing;
  }

  /**
   * Read and parse frontmatter for the notes in one directory. The task mirror
   * needs `metadataCache.getFileCache(...).frontmatter.kanbanId` synchronously,
   * so those caches are primed before a sync can run.
   */
  async warmMarkdown(directory: string): Promise<void> {
    if (!directory) return;
    try {
      const result = await fsOp('tree', { path: directory, frontmatter: true });
      const entries = (result.entries as Array<{ path: string; type: string; frontmatter?: Record<string, unknown> | null; content?: string }>) ?? [];
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        if (entry.frontmatter !== undefined) this.cacheCache.set(entry.path, { frontmatter: entry.frontmatter ?? undefined });
        if (typeof entry.content === 'string') this.contentCache.set(entry.path, entry.content);
        if (!this.index.has(entry.path)) {
          const file = new TFile(this, entry.path);
          this.index.set(entry.path, file);
          const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
          const parent = parentPath ? this.index.get(parentPath) : null;
          if (parent instanceof TFolder) {
            parent.children.push(file);
            file.parent = parent;
          }
        }
      }
    } catch (error) {
      console.warn('[feifan-life] 预热笔记缓存失败', error);
    }
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    if (!path) return null;
    return this.index.get(path) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    const out: TFile[] = [];
    for (const entry of this.index.values()) {
      if (entry instanceof TFile && entry.extension === 'md') out.push(entry);
    }
    return out;
  }

  getFiles(): TFile[] {
    const out: TFile[] = [];
    for (const entry of this.index.values()) if (entry instanceof TFile) out.push(entry);
    return out;
  }

  getRoot(): TFolder {
    return (this.index.get('') as TFolder) ?? new TFolder(this, '');
  }

  getResourcePath(file: TFile): string {
    return assetUrl(file.path);
  }

  async read(file: TFile): Promise<string> {
    const text = await this.adapter.read(file.path);
    this.contentCache.set(file.path, text);
    return text;
  }

  async cachedRead(file: TFile): Promise<string> {
    const cached = this.contentCache.get(file.path);
    if (cached !== undefined) return cached;
    return this.read(file);
  }

  async create(path: string, content: string): Promise<TFile> {
    if (this.index.has(path)) throw new Error('File already exists: ' + path);
    await this.adapter.write(path, content);
    const file = this.linkFile(path);
    this.contentCache.set(path, content);
    return file;
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.index.has(path)) throw new Error('Folder already exists: ' + path);
    await this.adapter.mkdir(path);
    return this.linkFolder(path);
  }

  async modify(file: TFile, content: string): Promise<void> {
    await this.adapter.write(file.path, content);
    this.contentCache.set(file.path, content);
    this.cacheCache.delete(file.path);
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    if (file instanceof TFile) {
      const text = await this.cachedRead(file);
      await this.adapter.write(newPath, text);
      await this.adapter.remove(file.path);
      this.unlink(file.path);
      this.linkFile(newPath);
      this.contentCache.set(newPath, text);
    } else if (file instanceof TFolder) {
      await this.adapter.mkdir(newPath);
      for (const child of [...file.children]) {
        const target = newPath + child.path.slice(file.path.length);
        await this.rename(child, target);
      }
      await this.adapter.remove(file.path);
      this.unlink(file.path);
      this.linkFolder(newPath);
    }
    file.path = newPath;
    const index = newPath.lastIndexOf('/');
    file.name = index < 0 ? newPath : newPath.slice(index + 1);
    if (file instanceof TFile) {
      const dot = file.name.lastIndexOf('.');
      file.basename = dot <= 0 ? file.name : file.name.slice(0, dot);
      file.extension = dot <= 0 ? '' : file.name.slice(dot + 1);
    }
  }

  async delete(file: TAbstractFile): Promise<void> {
    await this.adapter.remove(file.path);
    this.unlink(file.path);
  }

  getFileCache(file: TFile): FileCache {
    const cached = this.cacheCache.get(file.path);
    if (cached) return cached;
    const content = this.contentCache.get(file.path);
    if (content !== undefined) {
      const parsed = parseFrontmatter(content);
      this.cacheCache.set(file.path, parsed);
      return parsed;
    }
    // Not primed: read in the background so a later call is exact.
    void this.read(file).then((text) => {
      this.cacheCache.set(file.path, parseFrontmatter(text));
    }).catch(() => undefined);
    return {};
  }

  on(): void {}
  off(): void {}
  onLayoutReady(callback: () => void): void { window.setTimeout(callback, 0); }

  private linkFile(path: string): TFile {
    const existing = this.index.get(path);
    if (existing) return existing as TFile;
    const file = new TFile(this, path);
    this.index.set(path, file);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parentPath) {
      const parent = this.linkFolder(parentPath);
      parent.children.push(file);
      file.parent = parent;
    }
    return file;
  }

  private linkFolder(path: string): TFolder {
    const existing = this.index.get(path);
    if (existing) return existing as TFolder;
    const folder = new TFolder(this, path);
    this.index.set(path, folder);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parentPath) {
      const parent = this.linkFolder(parentPath);
      parent.children.push(folder);
      folder.parent = parent;
    }
    return folder;
  }

  private unlink(path: string): void {
    const node = this.index.get(path);
    if (!node) return;
    this.index.delete(path);
    if (node.parent) {
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    }
    this.contentCache.delete(path);
    this.cacheCache.delete(path);
  }
}

export function parseFrontmatter(content: string): FileCache {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end < 0) return {};
  const block = content.slice(3, end);
  const frontmatter: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s+-\s/.test(line) && currentKey) {
      const list = (frontmatter[currentKey] as unknown[]) ?? [];
      list.push(line.replace(/^\s+-\s*/, '').trim());
      frontmatter[currentKey] = list;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    currentKey = match[1];
    const raw = match[2].trim();
    if (!raw) {
      frontmatter[currentKey] = [];
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      frontmatter[currentKey] = raw.slice(1, -1).split(',').map((item) => stripQuotes(item.trim())).filter(Boolean);
      continue;
    }
    if (raw === 'true' || raw === 'false') frontmatter[currentKey] = raw === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(raw)) frontmatter[currentKey] = Number(raw);
    else frontmatter[currentKey] = stripQuotes(raw);
    currentKey = Array.isArray(frontmatter[currentKey]) ? currentKey : null;
  }
  return { frontmatter };
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export class MetadataCache {
  constructor(private vault: Vault) {}
  getFileCache(file: TFile): FileCache {
    return this.vault.getFileCache(file);
  }
  getFirstLinkpathDest(): null { return null; }
  on(): void {}
}
