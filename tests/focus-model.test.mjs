import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../shim/focus-model.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { pendingEntries, groupEntries, selectEntries, pinKeyOf } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const date = '2026-11-23';
const sub = (id, done = false, target = 0, current = 0) => ({ id, name: id, done, target, current });
const a = { id: 'a', name: 'Parent A', priority: 'P0', projectId: 'p', subtasks: [sub('s1'), sub('s2', false, 1, 1)] };
const b = { id: 'b', name: 'Parent B', priority: 'P2', subtasks: [], done: false };
const pin = (taskId, subtaskId, day = date) => ({ date: day, taskId, ...(subtaskId ? { subtaskId } : {}) });

test('completed, quantified, archived, dangling, old and duplicate pins are excluded', () => {
  const pins = [pin('a'), pin('a','s1'), pin('a','s2'), pin('a','s1'), pin('missing'), pin('a','missing'), pin('b',null,'2026-11-22'),pin('c'),pin('d')];
  const before = JSON.stringify(pins);
  const entries = pendingEntries(pins, [a,b,{...b,id:'c',done:true},{...b,id:'d',archived:true}],[],date);
  assert.deepEqual(entries.map(e => [e.task.id, e.subtask?.id]), [['a',undefined],['a','s1']]);
  assert.equal(JSON.stringify(pins), before);
  assert.equal(pendingEntries([pin('a'),pin('a','s1')],[{...a,subtasks:[sub('s1',true)]}],[],date).length,0);
});
test('each task is grouped once; child-only selection retains parent context', () => {
  const all = pendingEntries([pin('a'),pin('b'),pin('a','s1')],[a,b],[],date);
  const groups = groupEntries(all);
  assert.equal(groups.length,2);assert.equal(groups[0].task.id,'a');assert.equal(groups[0].children.length,1);
  const selected = groupEntries(selectEntries(all,[pinKeyOf(pin('a','s1'))]));
  assert.equal(selected.length,1);assert.equal(selected[0].parent,undefined);assert.equal(selected[0].task.name,a.name);
});
test('unset selection shows pending items; explicitly empty selection stays empty; legacy choices migrate', () => {
  const all = pendingEntries([pin('a'),pin('a','s1')],[a],[],date);
  assert.equal(selectEntries(all,null).length,2);assert.equal(selectEntries(all,[]).length,0);
  assert.equal(selectEntries(all,['a::s1']).length,1);
  assert.equal(selectEntries(all,['a']).length,1);
});
