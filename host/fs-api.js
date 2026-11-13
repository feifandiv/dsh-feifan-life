/**
 * Vault + data filesystem access for the Feifan Life client.
 *
 * The browser half of the port runs the original Obsidian plugin UI, so it
 * needs the small slice of the `app.vault` API that plugin uses: read, write,
 * list, exists, mkdir, remove, stat and a flat tree for the synchronous
 * `getAbstractFileByPath` cache. This module owns those operations and the
 * path mapping that keeps plugin data inside the user's chosen directory while
 * letting review notes and task mirrors land in the vault.
 *
 * Everything is confined to the configured roots: a path that escapes them is
 * rejected instead of clamped, so a bug in the client cannot write anywhere
 * else on disk.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const CONFIG_DIR = '.obsidian';
const PLUGIN_ID = 'feifan-life';
const PLUGIN_DATA_PREFIX = `${CONFIG_DIR}/plugins/${PLUGIN_ID}`;

/** Normalize a client-supplied vault-relative path, rejecting traversal. */
export function normalizeVaultPath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path is required');
  const raw = input.replace(/\\/g, '/').trim();
  if (raw.startsWith('/') || raw.includes('\u0000') || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('path must be vault-relative');
  }
  const parts = raw.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) throw new Error('path may not leave the vault');
  return parts.join('/');
}

export function createFileSystem({ dataDir, vaultDir }) {
  const roots = {
    data: path.resolve(dataDir),
    vault: path.resolve(vaultDir),
  };

  /** Map a vault-relative path onto its real root. */
  function resolveVaultPath(input) {
    const relative = normalizeVaultPath(input);
    if (relative === PLUGIN_DATA_PREFIX || relative.startsWith(PLUGIN_DATA_PREFIX + '/')) {
      const rest = relative.slice(PLUGIN_DATA_PREFIX.length).replace(/^\//, '');
      const absolute = path.resolve(roots.data, rest);
      if (absolute !== roots.data && !absolute.startsWith(roots.data + path.sep)) {
        throw new Error('path may not leave the data directory');
      }
      return absolute;
    }
    const absolute = path.resolve(roots.vault, relative);
    if (absolute !== roots.vault && !absolute.startsWith(roots.vault + path.sep)) {
      throw new Error('path may not leave the vault');
    }
    return absolute;
  }

  async function statOrNull(absolute) {
    try {
      return await fs.stat(absolute);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  return {
    roots,
    resolveVaultPath,

    async exists(input) {
      const stats = await statOrNull(resolveVaultPath(input));
      return { exists: stats !== null, type: stats === null ? null : stats.isDirectory() ? 'folder' : 'file' };
    },

    async read(input) {
      const absolute = resolveVaultPath(input);
      const stats = await statOrNull(absolute);
      if (!stats || stats.isDirectory()) return { exists: false };
      return { exists: true, text: await fs.readFile(absolute, 'utf8'), mtime: stats.mtimeMs };
    },

    async write(input, text) {
      if (typeof text !== 'string') throw new Error('text is required');
      const absolute = resolveVaultPath(input);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      const temporary = absolute + '.tmp-' + randomUUID();
      await fs.writeFile(temporary, text, 'utf8');
      await fs.rename(temporary, absolute);
      return { ok: true, bytes: Buffer.byteLength(text) };
    },

    async mkdir(input) {
      await fs.mkdir(resolveVaultPath(input), { recursive: true });
      return { ok: true };
    },

    async list(input) {
      const absolute = resolveVaultPath(input);
      let entries;
      try {
        entries = await fs.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        if (error && error.code === 'ENOENT') return { files: [], folders: [] };
        throw error;
      }
      const files = [];
      const folders = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const child = await statOrNull(path.join(absolute, entry.name));
        if (!child) continue;
        const relative = normalizeVaultPath(input);
        const childPath = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory()) folders.push(childPath);
        else files.push(childPath);
      }
      return { files, folders };
    },

    async remove(input) {
      await fs.rm(resolveVaultPath(input), { force: true });
      return { ok: true };
    },

    async stat(input) {
      const stats = await statOrNull(resolveVaultPath(input));
      if (!stats) return { exists: false };
      return { exists: true, mtime: stats.mtimeMs, size: stats.size, type: stats.isDirectory() ? 'folder' : 'file' };
    },

    /**
     * Flat listing used once at startup to answer synchronous
     * `getAbstractFileByPath` calls. With `frontmatter` set it also parses the
     * YAML header of every markdown file it meets, which is what the task
     * mirror needs before it can match notes by `kanbanId`.
     */
    async tree(input = '', options = {}) {
      // The vault root is the empty path; every other path must be explicit.
      const base = input === '' || input === '.' || input === './' ? '' : normalizeVaultPath(input);
      const absolute = resolveVaultPath(base === '' ? '.' : base);
      const withFrontmatter = options.frontmatter === true;
      const out = [];
      const skip = new Set(['.git', 'node_modules', '.trash']);
      async function walk(directory, prefix) {
        let entries;
        try {
          entries = await fs.readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
          const relative = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            out.push({ path: relative, type: 'folder' });
            await walk(path.join(directory, entry.name), relative);
          } else if (entry.isFile()) {
            const item = { path: relative, type: 'file' };
            if (withFrontmatter && entry.name.toLowerCase().endsWith('.md')) {
              try {
                const head = await fs.readFile(path.join(directory, entry.name), 'utf8');
                item.frontmatter = parseFrontmatterBlock(head);
              } catch {
                item.frontmatter = null;
              }
            }
            out.push(item);
          }
          if (out.length > 60000) return;
        }
      }
      await walk(absolute, base && base !== '' ? base : '');
      return { entries: out };
    },

    async openDirectory(input) {
      const absolute = resolveVaultPath(input);
      const stats = await statOrNull(absolute);
      if (!stats?.isDirectory()) throw new Error('Directory not found');
      if (process.platform !== 'darwin') throw new Error('Open directory requires macOS');
      await execFileAsync('/usr/bin/open', [absolute]);
      return { ok: true };
    },

    /** Serve one vault file (images, backgrounds) as bytes. */
    async readBinary(input) {
      const absolute = resolveVaultPath(input);
      const stats = await statOrNull(absolute);
      if (!stats || stats.isDirectory()) return null;
      if (stats.size > 25 * 1024 * 1024) throw new Error('file too large');
      return { bytes: await fs.readFile(absolute), mtime: stats.mtimeMs };
    },
  };
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Minimal YAML frontmatter reader: scalars, booleans, numbers and inline lists. */
function parseFrontmatterBlock(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return null;
  const frontmatter = {};
  for (const line of content.slice(3, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      frontmatter[match[1]] = raw.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
    } else if (raw === 'true' || raw === 'false') {
      frontmatter[match[1]] = raw === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      frontmatter[match[1]] = Number(raw);
    } else if (raw.startsWith('"') && raw.endsWith('"')) {
      try { frontmatter[match[1]] = JSON.parse(raw); } catch { frontmatter[match[1]] = raw.slice(1, -1); }
    } else {
      frontmatter[match[1]] = raw;
    }
  }
  return frontmatter;
}

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
