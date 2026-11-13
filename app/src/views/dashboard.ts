// 仪表盘页面集：Hero / 总览 / 习惯 / 灵感 / 复盘 / 规划
import { Notice, TFile, setIcon } from "obsidian";
import { FfMenu } from '../design-system/menu';
import { FfModal as Modal } from "../design-system/modal";
import duskImage from '../../assets/dusk.jpg';
import snowImage from '../../assets/snow.jpg';
import forestImage from '../../assets/forest.jpg';
import { fsOp } from '../../../shim/api';
import type CommandCenterPlugin from '../main';
import type { TabKey } from './base';
import { PRIORITIES, Priority, Subtask, subtaskComplete, taskIsDone, taskSubtasks } from '../kanban/models';
import { FieldControl, mountSubtaskEditor, SubtaskEditorHandle, renderField } from '../kanban/components';
import { openVisionForm, renderVisionBoard } from '../kanban/views/vision-board';
import type { CmdHabit, CmdHabitSchedule, CmdInspiration, InspirationStatus, InspirationType } from '../models/root';
import { renderPlanningPanel as renderPlanningPanelV2, selectPlanningView as selectPlanningViewV2 } from './planning';

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

const DEFAULT_QUOTES = [
  { t: '你的问题主要在于读书不多而想得太多。', s: '杨绛' },
  { t: '人生唯一的成功，就是按照自己喜欢的方式度过一生。', s: '当下' },
  { t: '且将新火试新茶，诗酒趁年华。', s: '苏轼' },
  { t: '人所有的痛苦，本质上都是对自己无能的愤怒。', s: '王小波' },
  { t: '且视他人之疑目如盏盏鬼火，大胆地去走你的夜路。', s: '史铁生' },
  { t: '今天是你往后日子里最年轻的一天。', s: '无名' },
];
let quoteOffset = 0;

function lunarMD(d: Date): string {
  try { return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }).format(d); } catch { return ''; }
}
function ganzhi(y: number): string {
  const st = '甲乙丙丁戊己庚辛壬癸', br = '子丑寅卯辰巳午未申酉戌亥';
  const g = (y - 4) % 60; return st[g % 10] + br[g % 12];
}
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (first.getUTCDay() + 6) % 7; first.setUTCDate(first.getUTCDate() - fday + 3);
  return 1 + Math.round((t.getTime() - first.getTime()) / (7 * 864e5));
}

/* ---------- Hero ---------- */
const WMO: Record<number, [string, string]> = {0:['☀️','晴'],1:['🌤️','大致晴'],2:['⛅','多云'],3:['☁️','阴'],45:['🌫️','雾'],48:['🌫️','冻雾'],51:['🌦️','毛毛雨'],53:['🌦️','毛毛雨'],55:['🌦️','毛毛雨'],61:['🌧️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],80:['🌦️','阵雨'],81:['🌧️','阵雨'],82:['🌧️','强阵雨'],71:['🌨️','小雪'],73:['🌨️','中雪'],75:['🌨️','大雪'],95:['⛈️','雷雨'],96:['⛈️','雷雹'],99:['⛈️','雷雹']};
const wmo = (c: number) => WMO[c] || ['🌡️', '—'];
let weatherCache: { t: number; query: string; city: string; cur: any; daily: any } | null = null;
const locationCache = new Map<string, { name: string; latitude: number; longitude: number }>();

export async function fetchWeather(plugin: CommandCenterPlugin): Promise<boolean> {
  const settings = plugin.stores.root.data.settings;
  const city = settings.city || '杭州';
  if (weatherCache?.query === city && Date.now() - weatherCache.t < 25 * 60 * 1000) return true;
  try {
    const saved = settings.weatherLocation;
    let loc = saved?.query === city
      ? { name: saved.name, latitude: saved.latitude, longitude: saved.longitude }
      : locationCache.get(city);
    let locatedNow = false;
    if (!loc) {
      const response = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=zh&format=json');
      if (!response.ok) throw new Error('geocoding ' + response.status);
      const g = await response.json();
      loc = g.results && g.results[0];
      if (loc) { locationCache.set(city, loc); locatedNow = true; }
    }
    if (!loc) throw new Error('no loc');
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=5&timezone=auto';
    const response = await fetch(u);
    if (!response.ok) throw new Error('forecast ' + response.status);
    const w = await response.json();
    weatherCache = { t: Date.now(), query: city, city: loc.name || city, cur: w.current, daily: w.daily };
    if (locatedNow) {
      void plugin.stores.root.mutate((data) => {
        data.settings.weatherLocation = { query: city, name: loc!.name || city, latitude: loc!.latitude, longitude: loc!.longitude };
      }).catch((error) => console.error('[非凡人生] 保存天气坐标失败', error));
    }
    return true;
  } catch (e) {
    console.warn('[非凡人生] 天气更新失败，保留上次数据', e);
    return false;
  }
}

function heroResource(_plugin: CommandCenterPlugin, name: string): string | null {
  return ({ dusk: duskImage, snow: snowImage, forest: forestImage } as Record<string, string>)[name] ?? null;
}

export function renderHero(host: HTMLElement, plugin: CommandCenterPlugin): void {
  host.empty();
  host.addClass('hero');
  const s = plugin.stores.root.data.settings;
  if (s.heroBg && s.heroBg !== 'grad') {
    const rp = heroResource(plugin, s.heroBg);
    if (rp) {
      const d = s.heroDim;
      host.style.background = 'linear-gradient(105deg,rgba(var(--scrim-rgb),' + d + '),rgba(var(--scrim-rgb),' + d + ') 45%,rgba(var(--scrim-rgb2),' + Math.min(1, d + 0.06) + ')),url(' + rp + ') center/cover no-repeat';
    }
  } else {
    host.style.background = '';
  }
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const customQuotes = plugin.stores.root.data.cmd.quotes ?? [];
  const quotes = customQuotes.length ? customQuotes : DEFAULT_QUOTES;
  const q = quotes[(now.getDate() + quoteOffset) % quotes.length];
  const y = now.getFullYear();
  const yDays = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
  const yPct = (((now.getTime() - new Date(y, 0, 1).getTime()) / 864e5 + 1) / yDays * 100).toFixed(1);
  const mPct = (now.getDate() / new Date(y, now.getMonth() + 1, 0).getDate() * 100).toFixed(1);

  const main = host.createDiv({ cls: 'hero-main' });
  main.createDiv({ cls: 'hero-greet', text: greet + '，非凡' });
  main.createDiv({ cls: 'hero-quote' }, (qq) => {
    qq.createSpan({ text: '“' + q.t + '”' });
    qq.createSpan({ cls: 'hero-quote-src', text: '—— ' + q.s });
    qq.setAttribute('title', '换一句');
    qq.addEventListener('click', () => {
      quoteOffset = (quoteOffset + 1) % quotes.length;
      renderHero(host, plugin);
    });
  });
  const dateRow = main.createDiv({ cls: 'hero-date' });
  dateRow.createSpan({ cls: 'hero-date-big num', text: y + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日' });
  dateRow.createSpan({ cls: 'hero-date-sub', text: '周' + '日一二三四五六'[now.getDay()] + ' · 第 ' + isoWeek(now) + ' 周 · Q' + (Math.floor(now.getMonth() / 3) + 1) });
  const chips = main.createDiv({ cls: 'hero-chips' });
  chips.createSpan({ cls: 'chip' }, (c) => { c.createSpan({ text: '↗ 今年 ' }); c.createSpan({ cls: 'num', text: yPct + '%' }); });
  chips.createSpan({ cls: 'chip' }, (c) => { c.createSpan({ text: '◷ 本月 ' }); c.createSpan({ cls: 'num', text: mPct + '%' }); });
  const bg = chips.createEl('button', { cls: 'chip chip-btn', text: '◐ 背景', attr: { title: '选择 Hero 背景' } });
  bg.addEventListener('click', () => toggleHeroBackgroundPicker(host, plugin));

  const side = host.createDiv({ cls: 'hero-side' });
  side.createDiv({ cls: 'hero-clock num', text: pad(now.getHours()) + ':' + pad(now.getMinutes()) });
  side.createDiv({ cls: 'hero-lunar', text: pad(now.getSeconds()) + ' 秒 · 农历' + ganzhi(now.getFullYear()) + '年' + lunarMD(now) });
  side.createDiv({ cls: 'hero-avatar', text: '非' });
}

function toggleHeroBackgroundPicker(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const existing = host.querySelector('.hero-bg-pop');
  if (existing) { existing.remove(); return; }
  const pop = host.createDiv({ cls: 'hero-bg-pop' });
  pop.createDiv({ cls: 'pop-title', text: '背景方案' });
  const opts = pop.createDiv({ cls: 'pop-opts' });
  const choices = [['grad', '纯色渐变'], ['dusk', '雾山暮色'], ['snow', '雪山星空'], ['forest', '湖畔森林']];
  for (const [value, label] of choices) {
    const button = opts.createEl('button', { text: label, cls: plugin.stores.root.data.settings.heroBg === value ? 'active' : '' });
    button.addEventListener('click', async () => {
      await plugin.stores.root.mutate((data) => { data.settings.heroBg = value; });
      renderHero(host, plugin);
    });
  }
  const row = pop.createDiv({ cls: 'pop-slider' });
  row.createSpan({ text: '遮罩' });
  const slider = row.createEl('input', { attr: { type: 'range', min: '0.2', max: '0.9', step: '0.05', value: String(plugin.stores.root.data.settings.heroDim) } });
  const value = row.createSpan({ cls: 'num', text: Math.round(plugin.stores.root.data.settings.heroDim * 100) + '%' });
  slider.addEventListener('input', () => {
    const dim = Number(slider.value);
    value.setText(Math.round(dim * 100) + '%');
    void plugin.stores.root.mutate((data) => { data.settings.heroDim = dim; });
    const setting = plugin.stores.root.data.settings;
    const resource = setting.heroBg === 'grad' ? null : heroResource(plugin, setting.heroBg);
    if (resource) host.style.background = 'linear-gradient(105deg,rgba(var(--scrim-rgb),' + dim + '),rgba(var(--scrim-rgb),' + dim + ') 45%,rgba(var(--scrim-rgb2),' + Math.min(1, dim + 0.06) + ')),url(' + resource + ') center/cover no-repeat';
  });
}

/* ---------- 左栏卡片 ---------- */
export function renderWeatherCard(host: HTMLElement, plugin: CommandCenterPlugin): void {
  host.empty();
  host.addClass('card');
  host.createDiv({ cls: 'card-title' }, (t) => {
    t.createSpan({ text: '天气' });
    const city = t.createEl('button', { cls: 'side cc-city-btn', text: plugin.stores.root.data.settings.city + ' ›', attr: { title: '切换城市' } });
    city.addEventListener('click', (event) => {
      const choose = async (next: string): Promise<void> => {
        if (!next || next === plugin.stores.root.data.settings.city) return;
        await plugin.stores.root.mutate((data) => { data.settings.city = next; delete data.settings.weatherLocation; });
        const ok = await fetchWeather(plugin);
        new Notice(ok ? next + ' 实况已更新' : '天气更新失败，已保留上次数据');
        (plugin.activeView as any)?.refreshSoft?.();
      };
      const menu = new FfMenu(plugin.app);
      ['杭州', '汉中', '郑州', '舟山'].forEach((name) => menu.addItem((item) => item
        .setTitle(name)
        .setChecked(plugin.stores.root.data.settings.city === name)
        .onClick(() => void choose(name))));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle('其他城市…').setIcon('search').onClick(() => {
        const next = window.prompt('输入城市名称', plugin.stores.root.data.settings.city)?.trim();
        if (next) void choose(next);
      }));
      menu.showAtMouseEvent(event);
    });
  });
  if (!weatherCache) {
    host.createDiv({ cls: 'wx-now' }, (w) => {
      w.createSpan({ cls: 'wx-ico', text: '🌍' });
      w.createDiv({}, (dv) => dv.createDiv({ cls: 'small muted', text: '正在获取实况…' }));
    });
    return;
  }
  const c = weatherCache.cur; const [ico, txt] = wmo(c.weather_code);
  host.createDiv({ cls: 'wx-now' }, (w) => {
    w.createSpan({ cls: 'wx-ico', text: ico });
    w.createDiv({}, (dv) => {
      dv.createDiv({ cls: 'wx-temp num', text: c.temperature_2m + '°' });
      dv.createDiv({ cls: 'small muted', text: txt + ' · 体感 ' + Math.round(c.apparent_temperature) + '° · 湿度 ' + c.relative_humidity_2m + '%' });
    });
  });
  const days = host.createDiv({ cls: 'wx-days' });
  (weatherCache.daily.time as string[]).slice(0, 4).forEach((t, i) => {
    const [ic] = wmo(weatherCache!.daily.weather_code[i]);
    const lbl = i === 0 ? '今天' : i === 1 ? '明天' : '周' + '日一二三四五六'[new Date(t.replace(/-/g, '/')).getDay()];
    days.createDiv({}, (dv) => {
      dv.createDiv({ cls: 'd', text: lbl });
      dv.createDiv({ cls: 'i', text: ic });
      dv.createDiv({ cls: 't num', text: Math.round(weatherCache!.daily.temperature_2m_min[i]) + '/' + Math.round(weatherCache!.daily.temperature_2m_max[i]) + '°' });
      dv.createDiv({ cls: 'd num', text: '降水' + weatherCache!.daily.precipitation_probability_max[i] + '%' });
    });
  });
  host.createDiv({ cls: 'small faint', attr: { style: 'margin-top:9px' } }).setText('open-meteo 实况 · ' + new Date(weatherCache.t).toTimeString().slice(0, 5) + ' 更新 · 风 ' + Math.round(weatherCache.cur.wind_speed_10m || 0) + 'km/h');
}

export function renderMonthCalCard(host: HTMLElement, plugin: CommandCenterPlugin): void {
  host.empty();
  host.addClass('card');
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const first = new Date(y, m, 1); const startDow = first.getDay();
  const dim = new Date(y, m + 1, 0).getDate(); const dimPrev = new Date(y, m, 0).getDate();
  const byDay: Record<number, number> = {};
  const monthTasks = plugin.stores.kanban.getTasks().filter((task) => !task.archived && task.dueDate?.startsWith(y + '-' + pad(m + 1)));
  for (const t of monthTasks) {
    if (t.dueDate && t.dueDate.startsWith(y + '-' + pad(m + 1)) && !t.archived) {
      const dn = parseInt(t.dueDate.slice(8)); byDay[dn] = (byDay[dn] || 0) + 1;
    }
  }
  const head = host.createDiv({ cls: 'cal-head' });
  head.createSpan({ attr: { style: 'font-weight:500' } }).setText(y + ' 年 ' + (m + 1) + ' 月');
  const focus = todayFocusStats(plugin);
  const progress = focus.total ? Math.round(focus.remaining / focus.total * 100) : 0;
  const summary = head.createSpan({ cls: 'cal-summary' });
  summary.createSpan({ cls: 'cal-ring', attr: { style: '--cal-progress:' + progress + '%' } });
  summary.createSpan({ cls: 'small faint num', text: focus.remaining + '/' + focus.total });
  const grid = host.createDiv({ cls: 'cal-grid' });
  ['日', '一', '二', '三', '四', '五', '六'].forEach((x) => grid.createDiv({ cls: 'h', text: x }));
  for (let i = 0; i < 42; i++) {
    const dn = i - startDow + 1;
    if (dn < 1) { grid.createDiv({ cls: 'd out', text: String(dimPrev + dn) }); continue; }
    if (dn > dim) { grid.createDiv({ cls: 'd out', text: String(dn - dim) }); continue; }
    const cls = dn === now.getDate() ? 'today' : (byDay[dn] ? 'has' : '');
    const day = grid.createDiv({ cls: 'd ' + cls, text: String(dn) });
    if (byDay[dn]) day.setAttribute('title', `${byDay[dn]} 项任务在这天截止`);
  }
}

export function renderMonthOverviewCard(host: HTMLElement, plugin: CommandCenterPlugin): void {
  host.empty();
  host.addClass('card');
  const now = new Date(); const ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const led = plugin.stores.root.data.finance?.ledgers?.[plugin.stores.root.data.finance?.currentLedger || 'personal'];
  let mExp = 0;
  for (const t of led?.transactions ?? []) if (t.date.startsWith(ym) && t.type === '支出') mExp += t.amount;
  const budget = led?.monthlyBudget || 0;
  const left = budget - mExp;
  const doneM = plugin.stores.kanban.getTasks().filter((task) => {
    if (!taskIsDone(task) || typeof task.completedAt !== 'number') return false;
    const completed = new Date(task.completedAt);
    return completed.getFullYear() === now.getFullYear() && completed.getMonth() === now.getMonth();
  }).length;
  const hb = plugin.stores.root.data.cmd.habits ?? [];
  const doneMap = plugin.stores.root.data.cmd.habitDaily?.[today()] ?? {};
  const hDone = hb.filter((h) => (doneMap[h.id] || 0) >= (h.times || 1)).length;
  let habitDoneDays = 0;
  let habitExpectedDays = 0;
  for (let day = 1; day <= now.getDate(); day++) {
    const date = new Date(now.getFullYear(), now.getMonth(), day);
    const dateKey = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    for (const habit of hb) {
      if (!hApplies(habit, date)) continue;
      habitExpectedDays++;
      if ((plugin.stores.root.data.cmd.habitDaily?.[dateKey]?.[habit.id] || 0) >= (habit.times || 1)) habitDoneDays++;
    }
  }
  const habitRate = habitExpectedDays ? Math.round(habitDoneDays / habitExpectedDays * 100) : 0;
  host.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '本月概览' }); t.createSpan({ cls: 'side', text: (now.getMonth() + 1) + '月' }); });
  const kv = (k: string, v: string, sub?: string): void => {
    host.createDiv({ cls: 'kv' }, (r) => {
      r.createSpan({ cls: 'k', text: k });
      r.createSpan({ cls: 'num' + (k === '预算剩余' && left < 0 ? ' cc-negative' : '') }, (vv) => { vv.setText(v); if (sub) vv.createSpan({ cls: 'faint small', text: ' ' + sub }); });
    });
  };
  kv('预算剩余', '¥' + Math.round(left).toLocaleString(), budget ? '已用 ' + Math.round(mExp / budget * 100) + '%' : '');
  kv('本月完成任务', doneM + ' 项');
  kv('本月习惯打卡', habitRate + '%', '今日 ' + hDone + '/' + hb.length);
}

/* ---------- 各模块今日聚合 ---------- */
function todayTasks(plugin: CommandCenterPlugin): any[] {
  const t = today();
  return plugin.stores.kanban.getTasks().filter((x) => !x.archived && (x.dueDate === t || (!taskIsDone(x) && x.dueDate && x.dueDate < t)));
}
function todayFocusStats(plugin: CommandCenterPlugin): { remaining: number; total: number } {
  const tasks = plugin.stores.kanban.getTasks() ?? [];
  const taskMap = new Map(tasks.map((task: any) => [task.id, task]));
  let total = 0;
  let remaining = 0;
  for (const pin of plugin.stores.root.data.cmd.focusPins ?? []) {
    if (pin.date !== today()) continue;
    const task: any = taskMap.get(pin.taskId);
    if (!task || task.archived) continue;
    const subtask = pin.subtaskId
      ? taskSubtasks(task).find((item) => item.id === pin.subtaskId)
      : undefined;
    if (pin.subtaskId && !subtask) continue;
    total++;
    if (!(subtask ? subtaskComplete(subtask) : taskIsDone(task))) remaining++;
  }
  return { remaining, total };
}
function todayFinance(plugin: CommandCenterPlugin): { out: number; inn: number } {
  const t = today(); let out = 0, inn = 0;
  const led = plugin.stores.root.data.finance?.ledgers;
  for (const k of Object.keys(led ?? {})) {
    for (const x of led[k].transactions ?? []) {
      if (x.date === t) { if (x.type === '收入') inn += x.amount; else out += x.amount; }
    }
  }
  return { out, inn };
}
function habitStats(plugin: CommandCenterPlugin): { done: number; all: number } {
  const habits = plugin.stores.root.data.cmd.habits ?? [];
  const doneMap = plugin.stores.root.data.cmd.habitDaily?.[today()] ?? {};
  const done = habits.filter((h) => (doneMap[h.id] || 0) >= (h.times || 1)).length;
  return { done, all: habits.length };
}
/* ---------- 模块 chrome（SVG 线性图标，对齐旧模块工具栏质感） ---------- */
const ICONS: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v10"/><path d="M16 7v6"/>',
  finance: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5"/><circle cx="16.5" cy="13.5" r="1"/>',
  life: '<path d="m3 5 2 2 4-4"/><path d="m3 13 2 2 4-4"/><path d="M13 6h8"/><path d="M13 14h8"/>',
  habits: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  review: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  yearly: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  inspiration: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.2 14.7A7 7 0 1 1 15.8 14.7C14.7 15.5 14 16.6 14 18h-4c0-1.4-.7-2.5-1.8-3.3Z"/>',
};
function modHead(panel: HTMLElement, icon: string, title: string, sub: string, actions?: { label: string; primary?: boolean; onClick: () => void }[]): void {
  const head = panel.createDiv({ cls: 'cc-mod-head' });
  head.createDiv({ cls: 'micon' }).innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">' + (ICONS[icon] || '') + '</svg>';
  const copy = head.createDiv({ cls: 'copy' });
  copy.createDiv({ cls: 'mtitle', text: title });
  copy.createDiv({ cls: 'msub', text: sub });
  const acts = head.createDiv({ cls: 'macts' });
  for (const a of actions ?? []) {
    const b = acts.createEl('button', { cls: 'btn' + (a.primary ? ' primary' : ''), text: a.label });
    b.addEventListener('click', a.onClick);
  }
}

/* ---------- 总览 ---------- */
export function renderOverviewPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const panel = (host.querySelector('[data-panel="overview"]') as HTMLElement | null) ?? host;
  panel.empty();
  modHead(panel, 'overview', '总览 · 今日仪表盘', '全模块今日速览 · 数据实时计算', [
    { label: '新建任务 ＋', primary: true, onClick: () => (plugin.activeView)?.setTab('tasks') },
  ]);
  const tt = todayTasks(plugin);
  const doneN = tt.filter(taskIsDone).length;
  const fin = todayFinance(plugin);
  const hb = habitStats(plugin);

  const card = panel.createDiv({ cls: 'card' });
  card.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '今日各模块' }); t.createSpan({ cls: 'side', text: '点击跳转' }); });
  const grid = card.createDiv({ cls: 'cc-modgrid' });
  const cells: [string, string, string, TabKey][] = [
    ['任务', doneN + '/' + tt.length, '今日聚焦 · 完成', 'tasks'],
    ['规划', String((plugin.stores.root.data.cmd.planning?.visions ?? []).filter((v) => !v.realizedAt).length), '愿景与奖励', 'planning'],
    ['财务', '支 ' + Math.round(fin.out) + (fin.inn ? ' · 收 ' + Math.round(fin.inn) : ''), '今日收支', 'finance'],
    ['清单', '+' + (plugin.stores.root.data.life?.inputs ?? []).filter((x: any) => (x.createdAt || '').slice(0, 10) === today()).length + ' 条', '今日新增记录', 'life'],
    ['习惯', hb.done + '/' + hb.all, '今日打卡', 'habits'],
    ['灵感', String((plugin.stores.root.data.cmd.inspirations ?? []).filter((x) => x.status === '收件箱').length), '收件箱待整理', 'inspiration'],
  ];
  for (const [k, v, d, tab] of cells) {
    const c = grid.createDiv({ cls: 'kpi cc-modcard' });
    c.createDiv({ cls: 'k', text: k });
    c.createDiv({ cls: 'v num', text: v });
    c.createDiv({ cls: 'd', text: d });
    c.addEventListener('click', () => (plugin.activeView)?.setTab(tab));
  }

  const focus = panel.createDiv({ cls: 'card' });
  focus.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '今日聚焦' }); t.createSpan({ cls: 'side num', text: doneN + '/' + tt.length }); });
  if (!tt.length) focus.createDiv({ cls: 'empty', text: '今天没有安排，去「任务」页或右栏快速添加一件吧' });
  for (const t of tt) {
    const proj = (plugin.stores.root.data.kanban?.projects ?? []).find((p: any) => p.id === t.projectId);
    const isDone = taskIsDone(t);
    const row = focus.createDiv({ cls: 'ov-focus-item' + (isDone ? ' done' : '') });
    const ck = row.createSpan({ cls: 'ck' + (isDone ? ' on' : ''), text: '✓' });
    ck.addEventListener('click', () => {
      void plugin.stores.kanban.setTaskDone(t.id, !isDone);
    });
    const g = row.createDiv({ cls: 'grow' });
    g.createDiv({ cls: 't', text: t.name });
    const meta = g.createDiv({ cls: 'meta' });
    if (proj) meta.createSpan({ cls: 'tag', text: proj.name });
    if (t.priority) meta.createSpan({ cls: 'small pri-' + t.priority, text: t.priority });
  }

  const now = new Date(); const y = now.getFullYear();
  const yDays = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
  const bars = panel.createDiv({ cls: 'ov-bars' });
  const mkBar = (k: string, v: string, pct: number) => {
    const c = bars.createDiv({ cls: 'ov-bar-card' });
    c.createDiv({ cls: 'k' }, (kk) => { kk.createSpan({ text: k }); kk.createSpan({ cls: 'num', text: v }); });
    c.createDiv({ cls: 'bar' }).createEl('i', { attr: { style: 'width:' + Math.min(100, pct) + '%' } });
  };
  mkBar('今年进度', yPctOf(now), ((now.getTime() - new Date(y, 0, 1).getTime()) / 864e5 + 1) / yDays * 100);
  mkBar('本月进度', (now.getDate() / new Date(y, now.getMonth() + 1, 0).getDate() * 100).toFixed(1) + '%', now.getDate() / new Date(y, now.getMonth() + 1, 0).getDate() * 100);
  mkBar('今日聚焦', tt.length ? doneN + '/' + tt.length + ' · ' + Math.round(doneN / tt.length * 100) + '%' : '0/0', tt.length ? doneN / tt.length * 100 : 0);

  const acts = panel.createDiv({ cls: 'ov-actions' });
  const mkAct = (label: string, tab: TabKey) => {
    const b = acts.createEl('button', { cls: 'btn', text: label });
    b.addEventListener('click', () => (plugin.activeView)?.setTab(tab));
  };
  mkAct('记一笔', 'finance'); mkAct('记清单', 'life'); mkAct('打开任务看板', 'tasks');
}
function yPctOf(now: Date): string {
  const y = now.getFullYear();
  const yDays = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
  return (((now.getTime() - new Date(y, 0, 1).getTime()) / 864e5 + 1) / yDays * 100).toFixed(1) + '%';
}

/* ---------- 图表曲线 ---------- */
function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return '';
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)
       + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)
       + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  return d;
}

/* ---------- 习惯 ---------- */
function hApplies(h: CmdHabit, d = new Date()): boolean {
  const wd = d.getDay(); const t = h.sched?.t || '每天';
  if (t === '每天') return true;
  if (t === '工作日') return wd >= 1 && wd <= 5;
  if (t === '周末') return wd === 0 || wd === 6;
  if (t === '每周') return (h.sched.days || []).includes(wd);
  return true;
}
function schedLabel(h: CmdHabit): string {
  return h.sched?.t === '每周' ? '每周' + (h.sched.days || []).map((x: number) => '日一二三四五六'[x]).join('、') : (h.sched?.t || '每天');
}
function hDayDone(h: CmdHabit, dateStr: string, daily: Record<string, Record<string, number>>): boolean {
  if (dateStr > today()) return false;
  if (!hApplies(h, new Date(dateStr.replace(/-/g, '/')))) return false;
  return (daily[dateStr]?.[h.id] || 0) >= (h.times || 1);
}
function hStreak(h: CmdHabit, daily: Record<string, Record<string, number>>): number {
  let n = 0; const d = new Date();
  for (let i = 0; i < 366; i++) {
    const s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (hApplies(h, d)) {
      if (hDayDone(h, s, daily)) n++;
      else if (!(s === today() && (daily[s]?.[h.id] || 0) > 0)) break;
    }
    d.setDate(d.getDate() - 1);
  }
  return n;
}
let habitsFormOpen = false;
let habitEditing: string | null = null;
function hCount(plugin: CommandCenterPlugin, id: string): number {
  return plugin.stores.root.data.cmd.habitDaily?.[today()]?.[id] || 0;
}
function hbToggle(plugin: CommandCenterPlugin, host: HTMLElement, id: string, times: number): void {
  void plugin.stores.root.mutate((d) => {
    const day = d.cmd.habitDaily[today()] ??= {};
    const cur = day[id] || 0;
    day[id] = Math.min(times, cur + 1);
  });
  renderHabitsPanel(host, plugin);
  (plugin.activeView as any)?.refreshSoft?.();
}
function hbUndo(plugin: CommandCenterPlugin, host: HTMLElement, id: string): void {
  void plugin.stores.root.mutate((d) => {
    const day = d.cmd.habitDaily[today()] ??= {};
    day[id] = Math.max(0, (day[id] || 0) - 1);
  });
  renderHabitsPanel(host, plugin);
  (plugin.activeView as any)?.refreshSoft?.();
}
export function renderHabitsPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const panel = (host.querySelector('[data-panel="habits"]') as HTMLElement | null) ?? host;
  panel.empty();
  const daily = plugin.stores.root.data.cmd.habitDaily ?? {};
  const habits = plugin.stores.root.data.cmd.habits ?? [];
  const now = new Date();
  const dim = now.getDate(); // 本月已过天数

  modHead(panel, 'habits', '习惯', '循环方式 + 每日多次打卡 · 完成 = 打满次数', [
    { label: habitsFormOpen ? '收起表单' : (habitEditing ? '编辑习惯' : '＋ 新增习惯'), primary: true, onClick: () => { habitsFormOpen = !habitsFormOpen; if (!habitsFormOpen) habitEditing = null; renderHabitsPanel(host, plugin); } },
  ]);

  // 表单（新增/编辑共用）
  if (habitsFormOpen) {
    const editing = habitEditing ? habits.find((h) => h.id === habitEditing) : undefined;
    const form = panel.createDiv({ cls: 'card' });
    form.createDiv({ cls: 'card-title', text: editing ? '编辑习惯：' + editing.name : '新增习惯' });
    const row = form.createDiv({ cls: 'cc-formrow' });
    const inp = row.createEl('input', { cls: 'inp grow', attr: { placeholder: '习惯名，例如：喝水', value: editing?.name || '' } });
    const sel = row.createEl('select', { cls: 'sel' });
    const schedNow = editing?.sched?.t || '每天';
    (['每天', '工作日', '周末', '周一三五', '周二四六'] as const).forEach((t) => sel.createEl('option', { value: t, text: t === '周一三五' ? '每周一、三、五' : t === '周二四六' ? '每周二、四、六' : t }));
    sel.value = schedNow;
    const times = row.createEl('input', { cls: 'inp num', attr: { type: 'number', value: String(editing?.times || 1), min: '1', style: 'width:64px' } });
    row.createSpan({ cls: 'small faint', text: '次/日' });
    const unit = row.createEl('input', { cls: 'inp', attr: { placeholder: '单位（可选，如：杯）', value: editing?.unit || '', style: 'width:110px' } });
    const ok = row.createEl('button', { cls: 'btn primary', text: editing ? '保存修改' : '确定添加' });
    ok.addEventListener('click', () => {
      const name = inp.value.trim(); if (!name) { new Notice('请填写习惯名'); return; }
      const sv = sel.value;
      const sched: CmdHabitSchedule = sv === '每天' ? { t: '每天' } : sv === '工作日' ? { t: '工作日' } : sv === '周末' ? { t: '周末' } : sv === '周一三五' ? { t: '每周', days: [1, 3, 5] } : { t: '每周', days: [2, 4, 6] };
      const tms = Math.max(1, parseInt(times.value) || 1); const un = unit.value.trim() || undefined;
      void plugin.stores.root.mutate((d) => {
        const list = d.cmd.habits ?? [];
        if (editing) {
          const idx = list.findIndex((x) => x.id === editing.id);
          if (idx >= 0) list[idx] = { ...list[idx], name, sched, times: tms, unit: un };
        } else {
          const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : 'habit-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
          d.cmd.habits = [...list, { id, name, sched, times: tms, unit: un }];
        }
      });
      habitsFormOpen = false; habitEditing = null;
      renderHabitsPanel(host, plugin);
      (plugin.activeView as any)?.refreshSoft?.();
    });
  }

  /* ---- 上部：习惯卡片左右排列 ---- */
  const top = panel.createDiv({ cls: 'habits-top' });
  const cardsWrap = top.createDiv({ cls: 'cc-habgrid' });
  if (!habits.length) cardsWrap.createDiv({ cls: 'empty', text: '还没有习惯，点右上「＋ 新增习惯」开始' });
  for (const h of habits) {
    const ap = hApplies(h);
    const cnt = hCount(plugin, h.id); const done = cnt >= (h.times || 1);
    const c = cardsWrap.createDiv({ cls: 'cc-habcard' + (done ? ' is-done' : '') + (ap ? '' : ' is-rest') });
    const info = c.createDiv({ cls: 'hinfo' });
    info.createDiv({ cls: 'hnm' }, (n) => {
      n.createSpan({ text: h.name });
      n.createSpan({ cls: 'tag', text: schedLabel(h) });
      n.createSpan({ cls: 'tag blue', text: '每日 ' + (h.times || 1) + ' 次' + (h.unit ? ' · ' + h.unit : '') });
    });
    info.createDiv({ cls: 'hst', text: '连续 ' + hStreak(h, daily) + ' 天' + (ap ? (done ? ' · 已完成' : ' · ' + cnt + '/' + (h.times || 1) + (h.unit ? ' ' + h.unit : '')) : ' · 今日休息') });
    if (ap) info.createDiv({ cls: 'bar thin hbar' }).createEl('i', { attr: { style: 'width:' + Math.min(100, cnt / (h.times || 1) * 100) + '%' } });
    const right = c.createDiv({ cls: 'hops' });
    if (ap) {
      const actions = right.createDiv({ cls: 'cc-habit-actions' });
      if (cnt > 0) {
        const undo = actions.createEl('button', { cls: 'cc-habit-icon', attr: { title: '撤销一次', 'aria-label': '撤销一次' } });
        setIcon(undo, 'undo-2');
        undo.addEventListener('click', () => hbUndo(plugin, host, h.id));
      }
      const complete = actions.createEl('button', {
        cls: 'cc-habit-complete' + (done ? ' is-done' : ''),
        attr: { title: done ? '今日已完成' : '完成一次' },
      });
      setIcon(complete, done ? 'check' : 'plus');
      complete.createSpan({ text: done ? '已完成' : '完成' });
      complete.disabled = done;
      complete.addEventListener('click', () => hbToggle(plugin, host, h.id, h.times || 1));
    } else {
      right.createSpan({ cls: 'tag', text: '休' });
    }
    const more = right.createEl('button', { cls: 'cc-habit-icon cc-habit-more', attr: { title: '更多操作', 'aria-label': '更多操作' } });
    setIcon(more, 'ellipsis');
    more.addEventListener('click', (event) => {
      const menu = new FfMenu(plugin.app);
      menu.addItem((item) => item.setTitle('编辑习惯').setIcon('pencil').onClick(() => {
        habitEditing = h.id;
        habitsFormOpen = true;
        renderHabitsPanel(host, plugin);
      }));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle('删除习惯').setIcon('trash-2').onClick(() => {
        if (!confirm('删除习惯「' + h.name + '」？（历史打卡记录一并清除）')) return;
        void plugin.stores.root.mutate((d) => {
          d.cmd.habits = (d.cmd.habits ?? []).filter((x) => x.id !== h.id);
          for (const counts of Object.values(d.cmd.habitDaily)) delete counts[h.id];
        });
        renderHabitsPanel(host, plugin);
        (plugin.activeView as any)?.refreshSoft?.();
      }));
      menu.showAtMouseEvent(event);
    });
  }
  /* ---- 中部：月完成热度 ｜ 完成进度条 ---- */
  const bottom = panel.createDiv({ cls: 'habits-bottom' });
  const heat = bottom.createDiv({ cls: 'card' });
  heat.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '习惯月完成热度' }); t.createSpan({ cls: 'side', text: '灰 = 休息日 / 未来' }); });
  const hwrap = heat.createDiv({ cls: 'cc-hheat' });
  for (const h of habits) {
    const row = hwrap.createDiv({ cls: 'heat-row' });
    row.createSpan({ cls: 'nm', text: h.name });
    for (let i = 1; i <= dim; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      const ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const on = hDayDone(h, ds, daily);
      const ap = hApplies(h, d);
      const cell = row.createSpan({ cls: 'heat-cell' + (on ? ' l2' : '') + (i === now.getDate() ? ' today' : '') + ((ds > today()) || !ap ? ' future' : ''), attr: { title: ds + (!ap ? ' · 休息日' : '') } });
      cell.addEventListener('click', () => {
        if (ds !== today()) { new Notice('只支持勾选今天'); return; }
        hbToggle(plugin, host, h.id, h.times || 1);
      });
    }
    row.createSpan({ cls: 'small faint', attr: { style: 'margin-left:8px' } }).setText('连续 ' + hStreak(h, daily) + ' 天');
  }
  const prog = bottom.createDiv({ cls: 'card' });
  prog.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '习惯完成进度条' }); t.createSpan({ cls: 'side', text: '本月 · 完成/应完成 天数' }); });
  if (!habits.length) prog.createDiv({ cls: 'empty', text: '暂无习惯' });
  for (const h of habits) {
    let doneDays = 0, should = 0;
    for (let i = 1; i <= dim; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      if (!hApplies(h, d)) continue;
      should++;
      if (hDayDone(h, d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), daily)) doneDays++;
    }
    const pct = should ? Math.round(doneDays / should * 100) : 0;
    const r = prog.createDiv({ attr: { style: 'margin-bottom:10px' } });
    r.createDiv({ cls: 'kv', attr: { style: 'margin-bottom:4px' } }, (kv) => {
      kv.createSpan({ cls: 'k', text: h.name + '（' + schedLabel(h) + '）' });
      kv.createSpan({ cls: 'num' }, (vv) => { vv.setText(doneDays + '/' + should + ' 天 · '); vv.createSpan({ cls: 'm-wine', text: pct + '%' }); });
    });
    r.createDiv({ cls: 'bar' }).createEl('i', { attr: { style: 'width:' + pct + '%' } });
  }
  // 本月趋势图（每日完成习惯数）
  const trend = panel.createDiv({ cls: 'card hab-trend-card' });
  trend.createDiv({ cls: 'card-title' }, (t) => { t.createSpan({ text: '本月趋势' }); t.createSpan({ cls: 'side', text: '每日完成习惯数' }); });
  const applicable = habits.filter((h) => hApplies(h)).length;
  const counts: number[] = [];
  for (let i = 1; i <= dim; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i);
    const ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    counts.push(habits.filter((h) => hDayDone(h, ds, daily)).length);
  }
  const W = Math.max(300, Math.round(panel.clientWidth - 32)), H = 220;
  const maxC = Math.max(applicable, 1);
  const xi = (i: number) => dim > 1 ? (i / (dim - 1)) * (W - 20) + 10 : W / 2;
  const yi = (v: number) => (H - 30) - (v / maxC) * (H - 50);
  const pts = counts.map((v, i) => [xi(i), yi(v)] as [number, number]);
  let svg = '';
  for (let g = 0; g <= 2; g++) { const yy = yi(maxC / 2 * g); svg += '<line x1="10" x2="' + (W - 10) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--ln)" stroke-dasharray="3 5" opacity=".4"/><text x="10" y="' + (yy - 4) + '" font-size="12" fill="var(--ink3)">' + (maxC / 2 * g) + '</text>'; }
  svg += '<path d="' + smoothPath(pts) + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (H - 30) + ' L' + pts[0][0].toFixed(1) + ',' + (H - 30) + ' Z" fill="var(--wine-soft)" stroke="none"/>';
  svg += '<path d="' + smoothPath(pts) + '" fill="none" stroke="var(--wine)" stroke-width="2"/>';
  for (const p of pts) svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5" fill="var(--wine)"/>';
  svg += '<text x="10" y="' + (H - 8) + '" font-size="12" fill="var(--ink3)">1日</text>';
  svg += '<text x="' + (W - 30) + '" y="' + (H - 8) + '" font-size="12" fill="var(--ink3)">' + dim + '日</text>';
  trend.createDiv({ cls: 'chart-wrap', attr: { style: 'height:220px' } }).innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:100%" preserveAspectRatio="none">' + svg + '</svg>';
}

/* ---------- 复盘（只读结构化呈现） ---------- */
interface ReviewSection { title: string; body: string }
function parseReviewSections(raw: string): ReviewSection[] {
  const headings = [...raw.matchAll(/^##\s+(.+?)\s*$/gm)];
  return headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? raw.length;
    const body = raw.slice(start, end).replace(/^-{3,}\s*$/gm, '').trim();
    return { title: heading[1].trim(), body };
  }).filter((section) => section.body.length > 0);
}
function reviewSectionTitle(title: string): string {
  const icons: Array<[string, string]> = [
    ['今日完成', '✅'], ['问题解决', '🧩'], ['今日纪念', '🌟'], ['今日思考', '💭'],
  ];
  const known = icons.find(([name]) => title.includes(name));
  return known ? `${known[1]} ${title}` : title;
}
let reviewLimit = 8;
const reviewRequests = new WeakMap<HTMLElement, object>();
export function renderReviewPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const panel = (host.querySelector('[data-panel="review"]') as HTMLElement | null) ?? host;
  const request = {};
  reviewRequests.set(panel, request);
  void renderReviewAsync(host, plugin, request).catch(error => {
    if (reviewRequests.get(panel) !== request) return;
    panel.empty();
    panel.createDiv({ cls: 'empty', text: '复盘读取失败：' + String(error) });
  });
}
async function renderReviewAsync(host: HTMLElement, plugin: CommandCenterPlugin, request: object): Promise<void> {
  const panel = (host.querySelector('[data-panel="review"]') as HTMLElement | null) ?? host;
  panel.empty();
  const base = '05-复盘迭代/03人生复盘';
  await plugin.app.vault.ensureIndex(undefined, true);
  if (reviewRequests.get(panel) !== request) return;
  const files = plugin.app.vault.getMarkdownFiles()
    .filter(file => file.path.startsWith(base + '/') && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name))
    .map(file => ({ date: file.basename, p: file.path }));
  files.sort((a, b) => b.date.localeCompare(a.date));
  const y = String(new Date().getFullYear());
  const ym = y + '-' + pad(new Date().getMonth() + 1);
  const yearN = files.filter((x) => x.date.startsWith(y)).length;
  const monthN = files.filter((x) => x.date.startsWith(ym)).length;
  const tt = todayTasks(plugin); const doneToday = tt.filter(taskIsDone).length;

  modHead(panel, 'review', '复盘', '正文由你的 AI 工作流写入 05-复盘迭代/03人生复盘 · 此处结构化呈现', [
    { label: '打开复盘目录', onClick: () => {
      void fsOp('open-directory', { path: base }).catch(error => new Notice(String(error)));
    } },
  ]);
  const kpis = panel.createDiv({ cls: 'kpis', attr: { style: 'grid-template-columns:repeat(3,minmax(0,1fr))' } });
  const mk = (k: string, v: string, d: string): void => {
    const c = kpis.createDiv({ cls: 'kpi' });
    c.createDiv({ cls: 'k', text: k });
    c.createDiv({ cls: 'v num', text: v });
    c.createDiv({ cls: 'd', text: d });
  };
  mk('今年复盘数', String(yearN), y + ' 年累计');
  mk('本月复盘数量', String(monthN), ym);
  mk('今日完成任务', doneToday + '/' + tt.length, '来自任务看板');

  const listWrap = panel.createDiv();
  const show = files.slice(0, reviewLimit);
  if (!show.length) listWrap.createDiv({ cls: 'empty', text: '还没有复盘记录' });
  for (const f of show) {
    const file = plugin.app.vault.getAbstractFileByPath(f.p);
    if (!(file instanceof TFile)) continue;
    let raw = ''; try { raw = await plugin.app.vault.read(file); } catch { continue; }
    if (reviewRequests.get(panel) !== request) return;
    const sections = parseReviewSections(raw);
    const item = listWrap.createDiv({ cls: 'card', attr: { style: 'margin-bottom:12px;padding:14px 16px' } });
    item.createDiv({ cls: 'card-title' }, (t) => {
      t.createSpan({ cls: 'num', text: f.date });
      t.createSpan({ cls: 'side', text: '周' + '日一二三四五六'[new Date(f.date.replace(/-/g, '/')).getDay()] });
    });
    const grid = item.createDiv({ cls: 'rv-grid' });
    const blk = (label: string, text: string): void => {
      grid.createDiv({ cls: 'rv-blk' }, (b) => {
        b.createDiv({ cls: 'rv-blk-h', text: label });
        b.createDiv({ cls: 'rv-blk-b', text });
      });
    };
    sections.forEach((section) => blk(reviewSectionTitle(section.title), section.body));
    if (!sections.length) item.createDiv({ cls: 'rv-empty', text: '这篇复盘暂时没有可展示的二级内容' });
  }
  if (files.length > reviewLimit) {
    const more = panel.createDiv({ cls: 'empty' });
    const b = more.createEl('button', { cls: 'btn', text: '显示更多（已显示 ' + reviewLimit + ' / ' + files.length + ' 篇）' });
    b.addEventListener('click', () => { reviewLimit += 8; renderReviewPanel(host, plugin); });
  }
}

/* ---------- 规划 ---------- */
let planningView: 'vision' | 'annual' = 'vision';

export function selectPlanningView(view: 'vision' | 'annual' | 'goals' | 'visions', year?: number | null): void {
  if (view === 'vision' || view === 'annual') planningView = view;
  selectPlanningViewV2(view, year);
}

export function renderPlanningPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  renderPlanningPanelV2(host, plugin);
}

function renderAnnualDirections(panel: HTMLElement, plugin: CommandCenterPlugin): void {
  const currentYear = new Date().getFullYear();
  const directionProgress = (goal: any): number => {
    const subs = Array.isArray(goal.subs) ? goal.subs : [];
    if (!subs.length) return 0;
    const total = subs.reduce((sum: number, sub: any) => {
      const target = Number(sub.target) || 0;
      const current = Number(sub.current) || 0;
      if (target > 0) return sum + (sub.done ? 1 : Math.min(1, current / target));
      return sum + (sub.done ? 1 : 0);
    }, 0);
    return Math.round((total / subs.length) * 100);
  };
  const yearRank = (year: unknown): number => {
    const value = Number(year);
    if (!Number.isFinite(value)) return 9999;
    if (value === currentYear) return 0;
    if (value > currentYear) return value - currentYear;
    return 1000 + currentYear - value;
  };
  const priorityRank = (priority: unknown): number => {
    const index = PRIORITIES.indexOf(priority as Priority);
    return index < 0 ? PRIORITIES.length : index;
  };
  const goals = [...(plugin.stores.root.data.cmd.goals ?? [])].sort((a: any, b: any) => {
    const yearDiff = yearRank(a.year) - yearRank(b.year);
    if (yearDiff) return yearDiff;
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff) return priorityDiff;
    const progressDiff = directionProgress(b) - directionProgress(a);
    if (progressDiff) return progressDiff;
    return Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0);
  });
  const grid = panel.createDiv({ cls: 'goal-grid' });
  for (const g of goals) {
    const c = grid.createDiv({ cls: 'goal-card' });
    c.createDiv({ cls: 'head' }, (h) => {
      h.createSpan({ cls: 'nm', text: g.name });
      const headActions = h.createDiv({ cls: 'cc-goal-actions' });
      headActions.createSpan({ cls: 'tag blue', text: (g.year ?? new Date().getFullYear()) + ' · ' + (g.priority ?? 'P2') });
      headActions.createSpan({ cls: 'tag', text: (g.subs ?? []).length + ' 个阶段成果' });
      const edit = headActions.createEl('button', { cls: 'cc-iconbtn', attr: { title: '编辑年度方向', 'aria-label': '编辑年度方向' } });
      setIcon(edit, 'pencil');
      edit.addEventListener('click', () => new DirectionFormModal(plugin, g, () => plugin.activeView?.setTab('planning')).open());
      const del = headActions.createEl('button', { cls: 'cc-iconbtn', attr: { title: '删除年度方向', 'aria-label': '删除年度方向' } });
      setIcon(del, 'trash-2');
      del.addEventListener('click', () => {
        if (!window.confirm(`确定删除年度方向「${g.name}」？`)) return;
        void plugin.stores.root.mutate((d) => { d.cmd.goals = d.cmd.goals.filter((x: any) => x.id !== g.id); });
      });
    });
    (g.subs ?? []).forEach((sub: any, i: number) => {
      const target = Number(sub.target) || 0;
      const current = Number(sub.current) || 0;
      const complete = sub.done === true || (target > 0 && current >= target);
      const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : complete ? 100 : 0;
      const row = c.createDiv({ cls: 'subgoal' + (complete ? ' done' : '') });
      row.createSpan({ cls: 'ck' + (complete ? ' on' : ''), text: '✓' }).addEventListener('click', () => {
        void plugin.stores.root.mutate((d) => { const gg = d.cmd.goals.find((x: any) => x.id === g.id); if (gg) gg.subs[i].done = !gg.subs[i].done; });
      });
      row.createSpan({ cls: 't', text: sub.name ?? sub.t ?? '未命名阶段成果' });
      const progress = row.createDiv({ cls: 'subgoal-progress' });
      const currentInput = progress.createEl('input', { cls: 'inp subgoal-current', attr: { type: 'number', min: '0', step: 'any', 'aria-label': '实际完成' } });
      currentInput.value = String(current);
      progress.createSpan({ cls: 'subgoal-slash', text: '/' });
      progress.createSpan({ cls: 'subgoal-target', text: String(target) + (sub.unit ? ' ' + sub.unit : '') });
      const bar = progress.createDiv({ cls: 'subgoal-bar' });
      bar.createDiv({ cls: 'subgoal-bar-fill', attr: { style: `width:${pct}%` } });
      progress.createSpan({ cls: 'subgoal-pct num', text: `${pct}%` });
      currentInput.addEventListener('change', () => {
        const value = Math.max(0, Number(currentInput.value) || 0);
        void plugin.stores.root.mutate((d) => {
          const gg = d.cmd.goals.find((x: any) => x.id === g.id);
          if (gg?.subs?.[i]) gg.subs[i].current = value;
        });
      });
    });
  }
}

type DirectionRecord = {
  id: string;
  name: string;
  priority?: Priority;
  year?: number;
  note?: string;
  subs: Array<{ id?: string; t?: string; name?: string; target?: number; current?: number; unit?: string; done?: boolean }>;
};

class DirectionFormModal extends Modal {
  private inputs: Record<string, FieldControl> = {};
  private editor!: SubtaskEditorHandle;

  constructor(private plugin: CommandCenterPlugin, private direction: DirectionRecord | undefined, private onSaved: () => void) {
    super(plugin.app);
    this.modalEl.addClass('pk-modal-el', 'pk-direction-form-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pk-modal');
    contentEl.createEl('div', { cls: 'pk-modal__title', text: this.direction ? '编辑年度方向' : '新增年度方向' });
    const form = contentEl.createDiv({ cls: 'pk-modal__grid' });
    this.inputs.name = renderField(form, { key: 'name', label: '方向名称', type: 'text', value: this.direction?.name ?? '', placeholder: '如：建立稳定的内容生产系统', span: 'full' });
    this.inputs.priority = renderField(form, { key: 'priority', label: '优先级', type: 'select', options: PRIORITIES, value: this.direction?.priority ?? 'P2', span: 'half' });
    const year = new Date().getFullYear();
    const yearOptions = Array.from({ length: 5 }, (_, i) => String(year + i));
    if (this.direction?.year != null && !yearOptions.includes(String(this.direction.year))) yearOptions.unshift(String(this.direction.year));
    this.inputs.year = renderField(form, { key: 'year', label: '所属年份', type: 'select', options: yearOptions, value: String(this.direction?.year ?? year), span: 'half' });
    this.inputs.note = renderField(form, { key: 'note', label: '备注', type: 'textarea', value: this.direction?.note ?? '', placeholder: '补充方向背景、判断或边界', span: 'full' });
    const subField = contentEl.createDiv({ cls: 'pk-field pk-field--full' });
    const editorHost = subField.createDiv({ cls: 'pk-vision__sub-editor' });
    const initial: Subtask[] = (this.direction?.subs ?? []).map((sub) => ({
      id: sub.id ?? uid(), name: sub.name ?? sub.t ?? '', target: Number(sub.target) || 0,
      current: Number(sub.current) || 0, unit: sub.unit ?? '', done: sub.done === true,
    }));
    this.editor = mountSubtaskEditor(editorHost, initial, { showCurrent: false, showDone: false });
    const add = subField.createEl('button', { cls: 'pk-btn pk-btn--ghost pk-btn--sm', text: '＋ 添加子项' });
    add.addEventListener('click', () => this.editor.add());
    const actions = contentEl.createDiv({ cls: 'pk-modal__actions' });
    const cancel = actions.createEl('button', { cls: 'pk-btn pk-btn--ghost', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'pk-btn pk-btn--primary', text: '保存' });
    save.addEventListener('click', () => void this.submit());
    this.inputs.name.focus();
  }

  private async submit(): Promise<void> {
    const name = this.inputs.name.value.trim();
    if (!name) { new Notice('请填写方向名称'); this.inputs.name.focus(); return; }
    const subs = this.editor.getSubtasks().map((sub) => ({ ...sub, t: sub.name }));
    const id = this.direction?.id ?? uid();
    const now = Date.now();
    await this.plugin.stores.root.mutate((d) => {
      const next: DirectionRecord = {
        id, name, priority: this.inputs.priority.value as Priority,
        year: Number(this.inputs.year.value) || new Date().getFullYear(),
        note: this.inputs.note.value.trim(), subs, updatedAt: now,
      } as DirectionRecord;
      const goals = d.cmd.goals ?? [];
      const index = goals.findIndex((goal: any) => goal.id === id);
      if (index >= 0) goals[index] = { ...goals[index], ...next };
      else d.cmd.goals = [...goals, { ...next, createdAt: now }];
    });
    this.onSaved();
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

/* ---------- 灵感 ---------- */
const INSPIRATION_TYPES: InspirationType[] = ['选题', '观点', '故事', '案例', '金句', '开头', '素材'];
const INSPIRATION_STATUSES: InspirationStatus[] = ['收件箱', '待使用', '已使用', '归档'];
let inspirationFilter: InspirationStatus | '全部' = '全部';
let inspirationSearch = '';

export function renderInspirationPanel(host: HTMLElement, plugin: CommandCenterPlugin): void {
  const panel = (host.querySelector('[data-panel="inspiration"]') as HTMLElement | null) ?? host;
  panel.empty();
  modHead(panel, 'inspiration', '灵感 · 内容素材库', '手动记录或由 AI 经你确认后收录', [
    { label: '新增灵感', primary: true, onClick: () => new InspirationModal(plugin, undefined).open() },
  ]);

  const all = plugin.stores.root.data.cmd.inspirations ?? [];
  const toolbar = panel.createDiv({ cls: 'cc-inspiration-toolbar' });
  const search = toolbar.createEl('input', { cls: 'inp', attr: { placeholder: '搜索标题、内容或标签', type: 'search' } });
  search.value = inspirationSearch;
  search.addEventListener('input', () => {
    inspirationSearch = search.value;
    renderInspirationPanel(host, plugin);
    const next = panel.querySelector('.cc-inspiration-toolbar input') as HTMLInputElement | null;
    next?.focus();
    next?.setSelectionRange(inspirationSearch.length, inspirationSearch.length);
  });
  const filters = toolbar.createDiv({ cls: 'cc-inspiration-filters' });
  for (const status of ['全部', ...INSPIRATION_STATUSES] as const) {
    const count = status === '全部' ? all.length : all.filter((x) => x.status === status).length;
    const button = filters.createEl('button', { cls: inspirationFilter === status ? 'is-active' : '', text: `${status} ${count}` });
    button.addEventListener('click', () => { inspirationFilter = status; renderInspirationPanel(host, plugin); });
  }

  const query = inspirationSearch.trim().toLocaleLowerCase();
  const items = [...all]
    .filter((x) => inspirationFilter === '全部' || x.status === inspirationFilter)
    .filter((x) => !query || [x.title, x.content, x.source, x.relatedTo, ...(x.tags ?? [])].join(' ').toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const grid = panel.createDiv({ cls: 'cc-inspiration-grid' });
  if (!items.length) {
    const empty = grid.createDiv({ cls: 'cc-inspiration-empty' });
    empty.createDiv({ cls: 'cc-inspiration-empty__title', text: all.length ? '没有符合条件的灵感' : '灵感收件箱还是空的' });
    empty.createDiv({ cls: 'cc-inspiration-empty__sub', text: all.length ? '换个筛选条件或搜索词。' : '记录一个刚冒出来的选题、观点或故事。' });
    const add = empty.createEl('button', { cls: 'btn primary', text: '新增灵感' });
    add.addEventListener('click', () => new InspirationModal(plugin, undefined).open());
  }
  for (const item of items) renderInspirationCard(grid, item, plugin);
}

function renderInspirationCard(host: HTMLElement, item: CmdInspiration, plugin: CommandCenterPlugin): void {
  const card = host.createDiv({ cls: 'cc-inspiration-card' });
  const top = card.createDiv({ cls: 'cc-inspiration-card__top' });
  top.createSpan({ cls: 'tag', text: item.type });
  top.createSpan({ cls: 'cc-inspiration-status', text: item.status });
  const edit = top.createEl('button', { cls: 'cc-iconbtn', attr: { title: '编辑灵感', 'aria-label': '编辑灵感' } });
  setIcon(edit, 'pencil');
  edit.addEventListener('click', () => new InspirationModal(plugin, item).open());
  card.createDiv({ cls: 'cc-inspiration-card__title', text: item.title });
  if (item.content) card.createDiv({ cls: 'cc-inspiration-card__content', text: item.content });
  if (item.tags?.length) {
    const tags = card.createDiv({ cls: 'cc-inspiration-tags' });
    item.tags.forEach((tag) => tags.createSpan({ text: '#' + tag }));
  }
  const meta = card.createDiv({ cls: 'cc-inspiration-card__meta' });
  meta.createSpan({ text: new Date(item.createdAt).toLocaleDateString('zh-CN') });
  if (item.source) meta.createSpan({ text: item.source });
  if (item.relatedTo) meta.createSpan({ text: '关联：' + item.relatedTo });
  meta.createSpan({ text: item.captureMode === 'ai' ? 'AI 收录' : '手动收录' });
}

class InspirationModal extends Modal {
  constructor(private plugin: CommandCenterPlugin, private item?: CmdInspiration) { super(plugin.app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cc-inspiration-modal');
    contentEl.createEl('h2', { text: this.item ? '编辑灵感' : '新增灵感' });
    const form = contentEl.createDiv({ cls: 'cc-inspiration-form' });
    const field = (label: string): HTMLElement => {
      const wrap = form.createDiv({ cls: 'cc-inspiration-field' });
      wrap.createEl('label', { text: label });
      return wrap;
    };
    const title = field('标题').createEl('input', { attr: { placeholder: '一句话概括这条灵感' } });
    title.value = this.item?.title ?? '';
    const content = field('原始内容').createEl('textarea', { attr: { placeholder: '保留当时最原始的想法和上下文' } });
    content.value = this.item?.content ?? '';
    const row = form.createDiv({ cls: 'cc-inspiration-form__row' });
    const typeField = row.createDiv({ cls: 'cc-inspiration-field' });
    typeField.createEl('label', { text: '类型' });
    const type = typeField.createEl('select');
    INSPIRATION_TYPES.forEach((value) => type.createEl('option', { value, text: value }));
    type.value = this.item?.type ?? '选题';
    const statusField = row.createDiv({ cls: 'cc-inspiration-field' });
    statusField.createEl('label', { text: '状态' });
    const status = statusField.createEl('select');
    INSPIRATION_STATUSES.forEach((value) => status.createEl('option', { value, text: value }));
    status.value = this.item?.status ?? '收件箱';
    const tags = field('标签').createEl('input', { attr: { placeholder: '保险, AI, 个人成长' } });
    tags.value = this.item?.tags?.join(', ') ?? '';
    const source = field('来源').createEl('input', { attr: { placeholder: '对话、文章、链接或人物' } });
    source.value = this.item?.source ?? '';
    const related = field('关联内容').createEl('input', { attr: { placeholder: '关联 IP、项目或文章' } });
    related.value = this.item?.relatedTo ?? '';

    const actions = contentEl.createDiv({ cls: 'cc-inspiration-modal__actions' });
    if (this.item) {
      const del = actions.createEl('button', { cls: 'btn cc-danger', text: '删除' });
      del.addEventListener('click', () => {
        if (!window.confirm(`确定删除灵感「${this.item!.title}」？`)) return;
        void this.plugin.stores.root.mutate((d) => { d.cmd.inspirations = d.cmd.inspirations.filter((x) => x.id !== this.item!.id); });
        this.close();
      });
    }
    const spacer = actions.createDiv({ cls: 'cc-inspiration-modal__spacer' });
    const cancel = actions.createEl('button', { cls: 'btn', text: '取消' });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'btn primary', text: '保存' });
    save.addEventListener('click', () => {
      const titleValue = title.value.trim();
      if (!titleValue) { new Notice('请填写灵感标题'); title.focus(); return; }
      const now = Date.now();
      const nextStatus = status.value as InspirationStatus;
      void this.plugin.stores.root.mutate((d) => {
        const draft: CmdInspiration = {
          id: this.item?.id ?? uid(), title: titleValue, content: content.value.trim(),
          type: type.value as InspirationType, status: nextStatus,
          tags: tags.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
          source: source.value.trim(), relatedTo: related.value.trim(),
          captureMode: this.item?.captureMode ?? 'manual',
          createdAt: this.item?.createdAt ?? now, updatedAt: now,
          usedAt: nextStatus === '已使用' ? (this.item?.usedAt ?? now) : null,
        };
        const index = d.cmd.inspirations.findIndex((x) => x.id === draft.id);
        if (index >= 0) d.cmd.inspirations[index] = draft;
        else d.cmd.inspirations.push(draft);
      });
      this.close();
    });
    void spacer;
    title.focus();
  }

  onClose(): void { this.contentEl.empty(); }
}

function uid(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'cc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
