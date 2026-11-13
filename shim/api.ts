/**
 * Transport for the Host-side filesystem API.
 *
 * The port runs the original plugin's `vault.adapter` calls, so every one of
 * them becomes a POST here. Operations stay fully async, which matches the
 * adapter contract; the synchronous `vault.getAbstractFileByPath` answers come
 * from the in-memory index built by `Vault.ensureIndex`.
 */
const API_ROOT = '/dsh-feifan-life/api';

export interface FsResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function fsOp(op: string, payload: Record<string, unknown> = {}): Promise<FsResult> {
  const response = await fetch(API_ROOT + '/fs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  });
  const text = await response.text();
  let data: FsResult;
  try {
    data = text ? (JSON.parse(text) as FsResult) : { ok: false, error: 'empty response' };
  } catch {
    throw new Error('filesystem API returned non-JSON (' + response.status + ')');
  }
  if (!response.ok || !data.ok) throw new Error(data.error || 'filesystem API failed (' + response.status + ')');
  return data;
}

export function assetUrl(vaultPath: string): string {
  return API_ROOT + '/asset?path=' + encodeURIComponent(vaultPath);
}

export async function health(): Promise<{ dataDir?: string; vaultDir?: string } | null> {
  try {
    const response = await fetch(API_ROOT + '/health');
    if (!response.ok) return null;
    return (await response.json()) as { dataDir?: string; vaultDir?: string };
  } catch {
    return null;
  }
}
