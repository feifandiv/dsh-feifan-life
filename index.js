/**
 * Host half of the Feifan Life bundle.
 *
 * The whole 非凡人生 UI is browser-side (`./client.js` runs the ported plugin),
 * so this entry exposes exactly one capability: a small filesystem API the
 * client uses for the plugin data file, its rolling backups, review notes and
 * task mirrors. All filesystem work is confined to the configured roots.
 */
import { createFileSystem, contentTypeFor } from './host/fs-api.js';

export const inject = ['webServer', 'connection'];

const ROUTE = '/dsh-feifan-life/api';
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const DEFAULTS = {
  dataDir: '/Users/feifan/FEIFAN/08-系统/09非凡人生数据',
  vaultDir: '/Users/feifan/FEIFAN/08-系统/09非凡人生数据',
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config ?? {}) };
  const files = createFileSystem(settings);

  async function handleFs(request) {
    const { op } = request;
    switch (op) {
      case 'open-directory': return await files.openDirectory(request.path);
      case 'read': return { ok: true, ...(await files.read(request.path)) };
      case 'write': return { ok: true, ...(await files.write(request.path, request.text)) };
      case 'exists': return { ok: true, ...(await files.exists(request.path)) };
      case 'mkdir': return { ok: true, ...(await files.mkdir(request.path)) };
      case 'list': return { ok: true, ...(await files.list(request.path)) };
      case 'remove': return { ok: true, ...(await files.remove(request.path)) };
      case 'stat': return { ok: true, ...(await files.stat(request.path)) };
      case 'tree': return { ok: true, ...(await files.tree(request.path ?? '', { frontmatter: request.frontmatter === true })) };
      default: throw new Error('unknown fs op: ' + String(op));
    }
  }

  // DSH WebResource routes only accept GET/HEAD. Mutation uses a real HTTP handler.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE + '/fs',
    handler: async (req, res) => {
      if (!ctx.connection.authorizeIndex(req, res)) return;
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST required' }); return; }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        sendJson(res, 415, { ok: false, error: 'application/json required' }); return;
      }
      try { sendJson(res, 200, await handleFs(await readBody(req))); }
      catch (error) { sendJson(res, 400, { ok: false, error: String(error?.message || error) }); }
    },
  }));

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    resource: async (request, peer) => {
      if (!peer) {
        let status = 401, headers = {}, body = '';
        if (!ctx.connection.authorizeIndex(request, {
          writeHead(code, values) { status = code; headers = values || {}; },
          end(value) { body = value || ''; },
        })) return new Response(body, { status, headers });
      }
      const url = new URL(request.url);
      const suffix = url.pathname.slice(ROUTE.length) || '/';
      if (suffix === '/health') return Response.json({
        ok: true, plugin: 'dsh-feifan-life', dataDir: files.roots.data, vaultDir: files.roots.vault,
      });
      if (suffix === '/asset') {
        const target = url.searchParams.get('path');
        try {
          const file = await files.readBinary(target);
          if (!file) return new Response('Not found', { status: 404 });
          return new Response(file.bytes, { headers: {
            'content-type': contentTypeFor(target), 'cache-control': 'no-cache',
          } });
        } catch (error) { return new Response(String(error?.message), { status: 400 }); }
      }
      return new Response('Not found', { status: 404 });
    },
  }));
}
