import { PRIORITIES, subtaskComplete, taskIsDone, taskSubtasks } from '../app/src/kanban/models';
import type { Task, Subtask, Project } from '../app/src/kanban/models';

export interface FocusPin { date: string; taskId: string; subtaskId?: string }
export interface FocusEntry { pin: FocusPin; task: Task; subtask?: Subtask; index: number }
export interface FocusGroup { task: Task; parent?: FocusEntry; children: FocusEntry[] }
export const pinKeyOf = (pin: FocusPin): string => JSON.stringify([pin.taskId, pin.subtaskId ?? null]);
export const legacyPinKeyOf = (pin: FocusPin): string => pin.subtaskId ? pin.taskId + '::' + pin.subtaskId : pin.taskId;
export const entryDone = (entry: FocusEntry): boolean => taskIsDone(entry.task) || !!(entry.subtask && subtaskComplete(entry.subtask));

/** Resolve only today's live, unfinished pins. Never mutate the source pins. */
export function pendingEntries(pins: FocusPin[], tasks: Task[], projects: Project[], date: string): FocusEntry[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const order = new Map(projects.map((p, i) => [p.id, i]));
  const seen = new Set<string>();
  const taskOrder = new Map<string, number>();
  const result: FocusEntry[] = [];
  pins.forEach((pin, index) => {
    if (pin.date !== date) return;
    if (!taskOrder.has(pin.taskId)) taskOrder.set(pin.taskId, index);
    const key = pinKeyOf(pin);
    if (seen.has(key)) return;
    seen.add(key);
    const task = byId.get(pin.taskId);
    if (!task || task.archived) return;
    const subtask = pin.subtaskId ? taskSubtasks(task).find(s => s.id === pin.subtaskId) : undefined;
    if (pin.subtaskId && !subtask) return;
    const entry = { pin, task, subtask, index };
    if (!entryDone(entry)) result.push(entry);
  });
  return result.sort((a, b) => {
    const project = (id: string | null) => id ? order.get(id) ?? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
    return project(a.task.projectId) - project(b.task.projectId)
      || PRIORITIES.indexOf(a.task.priority) - PRIORITIES.indexOf(b.task.priority)
      || (a.task.id === b.task.id ? Number(!!a.subtask) - Number(!!b.subtask) || a.index - b.index
        : taskOrder.get(a.task.id)! - taskOrder.get(b.task.id)!);
  });
}

export function selectEntries(all: FocusEntry[], picks: string[] | null): FocusEntry[] {
  if (picks === null) return all;
  const keys = new Set(picks);
  return all.filter(entry => keys.has(pinKeyOf(entry.pin)) || keys.has(legacyPinKeyOf(entry.pin)));
}

/** A parent is rendered once, even when only its children are selected. */
export function groupEntries(entries: FocusEntry[]): FocusGroup[] {
  const groups = new Map<string, FocusGroup>();
  for (const entry of entries) {
    let group = groups.get(entry.task.id);
    if (!group) { group = { task: entry.task, children: [] }; groups.set(entry.task.id, group); }
    if (entry.subtask) group.children.push(entry);
    else group.parent = entry;
  }
  return [...groups.values()];
}
