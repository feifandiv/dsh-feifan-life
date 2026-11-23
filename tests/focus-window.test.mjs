import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createFocusWindow, validateSnapshot } from '../host/focus-window.js';
import { apply } from '../index.js';
const snapshot = { title:'Focus',count:'1 remaining',summary:'1 group',empty:'Empty',mode:'light',groups:[{taskId:'a',name:'A',priority:'P0',parentPinned:true,children:[{id:'s',name:'S',progress:'0/1'}]}] };
function harness(autoReady = true) {
  let proc, activations=0, launches=0;
  const manager = createFocusWindow({ platform:'darwin', compile:async()=>'/test/helper', activate:()=>activations++, launch:()=>{
    launches++; proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();
    proc.kill=()=>{proc.killed=true;proc.emit('exit',0);};
    if(autoReady)queueMicrotask(()=>proc.stdout.write('{"type":"ready"}\n'));return proc;
  } });
  return {manager,get proc(){return proc;},get launches(){return launches;},get activations(){return activations;}};
}
test('native panel reuses one process, streams updates, validates navigation and closes on disposal',async()=>{
  const h=harness();
  try {
    await h.manager.handle({op:'open',snapshot});await h.manager.handle({op:'open',snapshot});assert.equal(h.launches,1);
    h.proc.stdout.write('{"type":"task","taskId":"missing"}\n');
    h.proc.stdout.write('{"type":"task","taskId":"a","subtaskId":"missing"}\n');
    h.proc.stdout.write('{"type":"task","taskId":"a","subtaskId":"s"}\n');
    let state=await h.manager.handle({op:'status',after:0});assert.equal(state.events.length,1);assert.equal(h.activations,1);
    assert.equal((await h.manager.handle({op:'status',after:state.revision})).events.length,0);
    await h.manager.handle({op:'update',snapshot:{...snapshot,groups:[]}});
    h.proc.stdout.write('{"type":"task","taskId":"a"}\n');
    assert.equal(h.activations,1);
  } finally {h.manager.dispose();}
  assert.equal(h.proc.killed,true);
});
test('concurrent opens wait for the same native process to become ready',async()=>{
  const h=harness(false);
  try {
    const first=h.manager.handle({op:'open',snapshot});
    await new Promise(resolve=>setImmediate(resolve));
    let resolved=false;
    const second=h.manager.handle({op:'open',snapshot}).then(value=>{resolved=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(resolved,false);assert.equal(h.launches,1);
    h.proc.stdout.write('{"type":"ready"}\n');
    assert.equal((await first).open,true);assert.equal((await second).open,true);
  } finally {h.manager.dispose();}
});
test('invalid snapshots and unavailable platform return actionable failures',async()=>{
  assert.throws(()=>validateSnapshot({...snapshot,groups:[{...snapshot.groups[0],children:'bad'}]}));
  assert.throws(()=>validateSnapshot({...snapshot,title:undefined}));
  const h=createFocusWindow({platform:'linux'});
  assert.equal((await h.handle({op:'status'})).supported,false);
  await assert.rejects(h.handle({op:'open',snapshot}),/macOS/);h.dispose();
});
test('native palette accepts resolved colors and discards CSS instructions',()=>{
  const clean=validateSnapshot({...snapshot,palette:{bg:'rgb(250, 249, 245)',text:'#1f1e1b',accent:'url(https://invalid)',border:'red;display:none'}});
  assert.deepEqual(clean.palette,{bg:'rgb(250, 249, 245)',text:'#1f1e1b'});
});
test('native route rejects untrusted requests before reading input or creating a window',async()=>{
  const routes=[], cleanup=[];
  apply({webServer:{register(r){routes.push(r);return()=>{};}},effect(fn){cleanup.push(fn());},connection:{requestRejection:()=>403}},{});
  let read=false;const req={method:'POST',headers:{'content-type':'application/json'},async *[Symbol.asyncIterator](){read=true;yield Buffer.from('{"op":"open"}');}};
  let status;const res={writeHead(s){status=s;},end(){}};
  await routes.find(r=>r.path.endsWith('focus-window')).handler(req,res);
  assert.equal(status,403);assert.equal(read,false);cleanup.reverse().forEach(fn=>fn());
});
