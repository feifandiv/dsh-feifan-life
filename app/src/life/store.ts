import { Notice } from 'obsidian';
import type { StoreHost } from '../models/root';
import {
  InputRecord,
  InventoryItem,
  LifeListData,
  LifeListSettings,
  STATUS_OPTIONS,
  createDefaultData,
  inputSignature,
  isDiscardStatus,
  normalizeRating,
  nowIso,
  splitKeywords,
  uid, WishItem, normalizeWish } from './models';

type Listener = () => void;

export class LifeListStore {
  private data: LifeListData;
  private listeners = new Set<Listener>();

  constructor(private host: StoreHost) {
    this.data = createDefaultData();
  }

  async load(): Promise<void> {
    const saved: any = this.host.root.data.life ?? null;
    if (saved != null && (!Array.isArray(saved.inputs) || !Array.isArray(saved.inventory))) {
      new Notice('人生清单数据结构异常，已停止加载以避免覆盖原文件');
      throw new Error('Invalid life-list data structure');
    }
    this.data = normalizeData(saved);
    this.host.root.data.life = this.data;
  }

  async save(): Promise<void> {
    this.host.root.data.life = this.data;
    await this.host.root.save();
  }


  get(): LifeListData {
    return this.data;
  }

  settings(): LifeListSettings {
    return this.data.settings;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async mutate(fn: (d: LifeListData) => void): Promise<void> {
    fn(this.data);
    const saved = this.save();
    this.notify();
    await saved;
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export function mergeInputs(existing: InputRecord[], incoming: InputRecord[]): { added: number; skipped: number } {
  const seen = new Set(existing.map(inputSignature));
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    const sig = inputSignature(item);
    if (seen.has(sig)) {
      skipped++;
      continue;
    }
    existing.push(item);
    seen.add(sig);
    added++;
  }
  return { added, skipped };
}

export function normalizeData(saved: any): LifeListData {
  const def = createDefaultData();
  if (!saved || typeof saved !== 'object') return def;
  const inputs: InputRecord[] = Array.isArray(saved.inputs) ? saved.inputs.map(normalizeInputRecord) : [];
  const inventory: InventoryItem[] = Array.isArray(saved.inventory) ? saved.inventory.map(normalizeInventoryItem) : [];
  const savedSettings = saved.settings ?? {};
  const inputCategories = normalizeInputOptionMap(
    savedSettings.inputCategories,
    inputs,
    (x) => [x.category],
    !savedSettings.inputCategories || typeof savedSettings.inputCategories !== 'object'
  );
  const inputLists = normalizeInputOptionMap(
    savedSettings.inputLists,
    inputs,
    (x) => x.listTags ?? [],
    !savedSettings.inputLists || typeof savedSettings.inputLists !== 'object'
  );
  const inventoryCategories = uniqueStrings([
    ...(Array.isArray(savedSettings.inventoryCategories) ? savedSettings.inventoryCategories : []),
    ...(!Array.isArray(savedSettings.inventoryCategories) ? inventory.map((x) => x.category) : []),
  ]);
  return {
    schemaVersion: Math.max(Number(saved.schemaVersion) || 1, 4),
    inputs,
    inventory,
    wishes: Array.isArray(saved.wishes) ? saved.wishes.map(normalizeWish) : [],
    settings: {
      ...def.settings,
      ...savedSettings,
      defaultView:
        savedSettings.defaultView === 'dashboard' || savedSettings.defaultView === 'inventory' || savedSettings.defaultView === 'options'
          ? savedSettings.defaultView
          : 'inputs',
      autoCopyFinanceInventory: savedSettings.autoCopyFinanceInventory !== false,
      financeInventoryCopied: savedSettings.financeInventoryCopied === true,
      inputCategories,
      inputLists,
      inventoryCategories,
    },
  };
}

function normalizeInputOptionMap(
  raw: any,
  inputs: InputRecord[],
  values: (item: InputRecord) => string[],
  seedFromInputs: boolean
): LifeListSettings['inputCategories'] {
  const out = { '读书': [] as string[], '观影': [] as string[], '学习': [] as string[] };
  (Object.keys(out) as Array<keyof typeof out>).forEach((type) => {
    out[type] = uniqueStrings([
      ...(Array.isArray(raw?.[type]) ? raw[type] : []),
      ...(seedFromInputs ? inputs.filter((x) => x.type === type).flatMap(values) : []),
    ]);
  });
  return out;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

export function normalizeInputRecord(raw: any): InputRecord {
  const stamp = typeof raw?.createdAt === 'string' ? raw.createdAt : nowIso();
  const type = raw?.type === '观影' || raw?.type === '学习' ? raw.type : '读书';
  return {
    id: raw?.id ?? uid(),
    type,
    name: String(raw?.name ?? '').trim(),
    creator: String(raw?.creator ?? '').trim(),
    rating: normalizeRating(raw?.rating),
    category: String(raw?.category ?? '').trim(),
    completedMonth: String(raw?.completedMonth ?? '').trim(),
    keywords: splitKeywords(raw?.keywords),
    description: String(raw?.description ?? ''),
    translator: raw?.translator ? String(raw.translator) : undefined,
    releaseYear: raw?.releaseYear ? String(raw.releaseYear) : undefined,
    note: raw?.note ? String(raw.note) : undefined,
    influence: raw?.influence ? String(raw.influence) : undefined,
    listTags: splitKeywords(raw?.listTags),
    sourceSheet: raw?.sourceSheet ? String(raw.sourceSheet) : undefined,
    createdAt: stamp,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : stamp,
  };
}

export function normalizeInventoryItem(raw: any): InventoryItem {
  const levelRaw = typeof raw?.level === 'number' ? ['A', 'B', 'C', 'S'][raw.level] : raw?.level;
  const level = typeof levelRaw === 'string' && ['A', 'B', 'C', 'S'].includes(levelRaw) ? levelRaw : 'A';
  const st = raw?.status === '转手' ? '转卖' : raw?.status;
  const status: InventoryItem['status'] = (STATUS_OPTIONS as readonly string[]).includes(st) ? st : '使用';
  const statusChangedAt = typeof raw?.statusChangedAt === 'string'
    ? raw.statusChangedAt
    : isDiscardStatus(status)
      ? nowIso()
      : undefined;
  return {
    id: raw?.id ?? uid(),
    name: String(raw?.name ?? '').trim(),
    price: Math.round((Number(raw?.price) || 0) * 100) / 100,
    quantity: Number(raw?.quantity) || 0,
    unit: String(raw?.unit ?? '').trim(),
    level,
    inDate: String(raw?.inDate ?? '').trim(),
    category: String(raw?.category ?? '').trim(),
    status,
    statusChangedAt,
    notes: String(raw?.notes ?? '').trim(),
  };
}
