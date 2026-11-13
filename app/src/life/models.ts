export type InputType = '读书' | '观影' | '学习';
export type TabKey = 'inputs' | 'inventory' | 'options' | 'dashboard';

export interface InputRecord {
  id: string;
  type: InputType;
  name: string;
  creator: string;
  rating: string;
  category: string;
  completedMonth: string;
  keywords: string[];
  description: string;
  translator?: string;
  releaseYear?: string;
  note?: string;
  influence?: string;
  listTags?: string[];
  sourceSheet?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  level: string;
  inDate: string;
  category: string;
  status: '使用' | '转卖' | '废弃' | '改造';
  statusChangedAt?: string;
  notes: string;
}

export interface LifeListSettings {
  defaultView: TabKey;
  autoCopyFinanceInventory: boolean;
  financeInventoryCopied: boolean;
  inputCategories: Record<InputType, string[]>;
  inputLists: Record<InputType, string[]>;
  inventoryCategories: string[];
}

export interface LifeListData {
  schemaVersion: number;
  inputs: InputRecord[];
  inventory: InventoryItem[];
  wishes: WishItem[];
  settings: LifeListSettings;
}

export const INPUT_TYPES: InputType[] = ['读书', '观影', '学习'];
export const RATING_OPTIONS = ['S', 'A', 'B', 'C'] as const;
export const LEVEL_OPTIONS = ['A', 'B', 'C', 'S'] as const;
export const STATUS_OPTIONS = ['使用', '转卖', '废弃', '改造'] as const;
export const LEVEL_ORDER: Record<string, number> = { C: 1, B: 2, A: 3, S: 4 };
export const RATING_ORDER: Record<string, number> = { C: 1, B: 2, A: 3, S: 4 };

export function createDefaultData(): LifeListData {
  return {
    schemaVersion: 4,
    inputs: [],
    inventory: [],
    wishes: [],
    settings: {
      defaultView: 'inputs',
      autoCopyFinanceInventory: true,
      financeInventoryCopied: false,
      inputCategories: { '读书': [], '观影': [], '学习': [] },
      inputLists: { '读书': [], '观影': [], '学习': [] },
      inventoryCategories: [],
    },
  };
}

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

export function isDiscardStatus(s: string | undefined): boolean {
  return s === '废弃' || s === '转卖' || s === '转手';
}

export function splitKeywords(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw ?? '')
    .split(/[\/,，、\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function inputSignature(r: Pick<InputRecord, 'type' | 'name' | 'completedMonth' | 'creator'>): string {
  return [r.type, r.name.trim(), r.completedMonth.trim(), r.creator.trim()]
    .map((x) => x.toLowerCase())
    .join('|');
}

export function parseMonthValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})[-/年.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`;
  const q = s.match(/^(\d{4})年?Q([1-4])$/i);
  if (q) return `${q[1]}-Q${q[2]}`;
  return s.slice(0, 7);
}

export function normalizeRating(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value).trim().toUpperCase();
  if (['S', 'A', 'B', 'C'].includes(s)) return s;
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n >= 5) return 'S';
  if (n >= 4) return 'A';
  if (n >= 3) return 'B';
  return 'C';
}

export interface WishItem {
  id: string;
  type: '电影' | '书' | '城市' | '其他';
  title: string;
  starred: boolean;
  done: boolean;
  createdAt: number;
  doneAt: number | null;
}

export function normalizeWish(raw: any): WishItem {
  const type = ['电影', '书', '城市', '其他'].includes(raw?.type) ? raw.type : '其他';
  return {
    id: raw?.id ?? uid(),
    type,
    title: typeof raw?.title === 'string' ? raw.title : '',
    starred: raw?.starred === true,
    done: raw?.done === true,
    createdAt: Number(raw?.createdAt) || Date.now(),
    doneAt: raw?.doneAt ?? null,
  };
}
