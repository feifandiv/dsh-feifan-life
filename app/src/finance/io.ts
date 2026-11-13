// 财务记账插件 · 导入导出（JSON 全量 / CSV 物资）
import { Notice } from 'obsidian';
import { FinanceStore } from './store';
import { FinanceData, InventoryItem, uid } from './models';

// ── JSON 导出 ──
export function exportJson(store: FinanceStore): void {
  const data = store.get();
  downloadFile(`非凡人生_财务_${ymd()}.json`, JSON.stringify(data, null, 2), 'application/json');
  new Notice('已导出全部财务数据');
}

// ── JSON 导入（合并不覆盖，按 id 合并）──
export function openImportModal(store: FinanceStore, cb: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = JSON.parse(text);
      await store.mutate((d) => mergeData(d, incoming));
      new Notice('导入成功（合并不覆盖）');
      cb();
    } catch (e) {
      new Notice('导入失败：' + (e as Error).message);
    }
  });
  input.click();
}

function mergeData(d: FinanceData, incoming: any): void {
  if (!incoming || typeof incoming !== 'object') return;
  if (incoming.currentLedger === 'personal' || incoming.currentLedger === 'business') {
    d.currentLedger = incoming.currentLedger;
  }
  for (const lid of ['personal', 'business'] as const) {
    const src = incoming.ledgers?.[lid];
    if (!src) continue;
    const tgt = d.ledgers[lid];
    if (typeof src.name === 'string') tgt.name = src.name;
    if (typeof src.monthlyBudget === 'number') tgt.monthlyBudget = src.monthlyBudget;
    if (src.balanceOverride != null) tgt.balanceOverride = Number(src.balanceOverride);
    tgt.categories = unionById(tgt.categories, src.categories ?? []);
    tgt.transactions = unionById(tgt.transactions, src.transactions ?? []);
    tgt.debts = unionById(tgt.debts, src.debts ?? []);
    tgt.receivables = unionById(tgt.receivables, src.receivables ?? []);
    tgt.assets = unionById(tgt.assets, src.assets ?? []);
    tgt.fundingPlans = unionById(tgt.fundingPlans, src.fundingPlans ?? []);
  }
  if (Array.isArray(incoming.inventory)) {
    d.inventory = unionById(d.inventory, incoming.inventory);
  }
}

function unionById(arr: any[], inc: any[]): any[] {
  const map = new Map<string, any>();
  for (const it of arr) if (it && it.id) map.set(it.id, it);
  for (const it of inc) if (it && it.id && !map.has(it.id)) map.set(it.id, it);
  return [...map.values()];
}

// ── CSV 导出（列对齐当前字段）──
const CSV_HEADERS = [
  '名称', '价格', '数量', '单位', '等级', '入库时间', '类别', '状态', '身份证', '备注',
];

export function exportCsv(items: InventoryItem[]): void {
  const rows = [CSV_HEADERS.join(',')];
  for (const it of items) {
    rows.push(
      [
        it.name,
        it.price,
        it.quantity,
        it.unit,
        it.level,
        it.inDate,
        it.category,
        it.status,
        it.idCard ?? '',
        it.notes ?? '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  downloadFile(`物资清单_${ymd()}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
  new Notice('已导出物资 CSV');
}

// ── CSV 导入（替换式）──
export function openCsvImportModal(store: FinanceStore, cb: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const items = parseCsv(text);
      if (items.length === 0) {
        new Notice('CSV 无有效行');
        return;
      }
      await store.mutate((d) => {
        d.inventory = items;
      });
      new Notice(`已导入 ${items.length} 条物资`);
      cb();
    } catch (e) {
      new Notice('CSV 导入失败：' + (e as Error).message);
    }
  });
  input.click();
}

function parseCsv(text: string): InventoryItem[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => (idx[h.trim()] = i));
  const get = (cells: string[], key: string) => cells[idx[key] ?? -1] ?? '';
  const out: InventoryItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < headers.length) continue;
    const st = get(cells, '状态');
    const status: InventoryItem['status'] =
      st === '废弃' || st === '转手' || st === '转卖' || st === '改造' ? (st === '转手' ? '转卖' : st) : '使用';
    out.push({
      id: uid(),
      name: get(cells, '名称'),
      price: Number(get(cells, '价格')) || 0,
      quantity: Number(get(cells, '数量')) || 0,
      unit: get(cells, '单位'),
      level: get(cells, '等级') || 'A',
      inDate: get(cells, '入库时间'),
      category: get(cells, '类别'),
      status,
      notes: get(cells, '备注'),
      idCard: get(cells, '身份证') || undefined,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ── 工具 ──
function csvCell(v: any): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function ymd(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
