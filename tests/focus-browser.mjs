/** Isolated browser regression tests; synthetic stores, no personal data writes. */
import fs from 'node:fs/promises';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const root=fileURLToPath(new URL('../',import.meta.url));
const css=await fs.readFile(root+'shim/focus-bar.css','utf8');
const tokens=await fs.readFile(root+'app/src/design-system/tokens.css','utf8');
const port=await fs.readFile(root+'shim/port.css','utf8');
const skinSource=await fs.readFile(root+'../dsh-skins/client.js','utf8');
const skinCSS=JSON.parse(skinSource.match(/const SKIN_CSS = ("(?:[^"\\]|\\.)*");/)[1]);
const bundle=await build({stdin:{resolveDir:root,contents:`
import {installDomHelpers} from './shim/dom';import {mountFocusBar} from './shim/focus-bar';
installDomHelpers();
const d=new Date(),date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const sub=(id,name,done=false,target=1,current=0)=>({id,name,done,target,current});
const tasks=[{id:'a',name:'海外虚拟 IP 落地',priority:'P0',projectId:'p',subtasks:[sub('phone','手机购买'),sub('plan','策划落地',false,1,1)]},{id:'b',name:'陈杰内容规划',priority:'P2',subtasks:[sub('research','资料收集')]},{id:'c',name:'AI 短视频创作课',priority:'P2',subtasks:[],done:false},{id:'done',name:'不应展示的完成任务',priority:'P0',subtasks:[],done:true}];
const pins=[{date,taskId:'a'},{date,taskId:'a',subtaskId:'phone'},{date,taskId:'b'},{date,taskId:'b',subtaskId:'research'},{date,taskId:'c'},{date,taskId:'a',subtaskId:'plan'},{date,taskId:'done'}];
const subs=new Set();const store={subscribe(fn){subs.add(fn);return()=>subs.delete(fn);}};
window.fixture={tasks,pins,subs,emit:()=>subs.forEach(fn=>fn())};window.opened=[];
const plugin={stores:{root:{...store,data:{cmd:{focusPins:pins}}},kanban:{...store,getTasks:()=>tasks,getProjects:()=>[{id:'p'}]}},theme:{attach(el){el.classList.add('ff-ui');el.dataset.ffMode='light';return()=>el.classList.remove('ff-ui');},get effectiveMode(){return document.body.hasAttribute('data-ds-dark-theme')?'dark':'light';}}};
const copy={focusOpenTask:'查看任务',focusBar:'今日聚焦',focusExpand:'展开今日聚焦',focusCollapse:'收起',focusRemaining:'剩余 {n} 项',focusGroupCount:'{n} 组任务',focusPreviewHint:'点击名称查看任务',focusPick:'选择',focusPickTitle:'选择悬浮的聚焦',focusPickDone:'完成',focusPickHint:'勾选要展示的未完成项',focusPopout:'悬浮到其他软件上方',focusNoneSelected:'点选择添加任务',focusEmpty:'暂无未完成聚焦',focusRetry:'重试',focusPopoutFailed:'系统悬浮窗打开失败'};
window.mount=()=>mountFocusBar(document.getElementById('host'),{ensureBooted:async()=>{},getPlugin:()=>plugin,openTask:(...args)=>window.opened.push(args),t:k=>copy[k]??k});window.dispose=window.mount();
`},bundle:true,write:false,format:'iife'});
let nativeFail=false;
const requests=[];
const server=http.createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url?.includes('/focus-window')){let b='';for await(const c of req)b+=c;const body=JSON.parse(b);requests.push(body);res.setHeader('content-type','application/json');res.end(JSON.stringify(body.op==='open'&&nativeFail?{ok:false,error:'test native failure'}:{ok:true,supported:true,open:body.op==='open',revision:0,events:[]}));return;}
 if(req.url==='/native'){res.setHeader('content-type','text/html; charset=utf-8');res.end(await fs.readFile(root+'native/focus.html','utf8'));return;}
 res.setHeader('content-type','text/html; charset=utf-8');res.end('<html data-dsh-skin="paper"><head><meta charset="utf-8"><style>'+skinCSS+tokens+port+css+'</style></head><body style="margin:0;background:#faf9f7"><h1 style="font:20px sans-serif;margin:32px">DSH 对话区域</h1><div id="host"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:1000,height:760}});const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origin);await page.locator('.fl-focus-ball').waitFor();
 // Host swallows click at the document level. Pointerup must still expand.
 await page.evaluate(()=>document.addEventListener('click',e=>e.stopImmediatePropagation(),{capture:true,once:true}));
 await page.locator('.fl-focus-ball').click();await page.locator('.fl-focus-card').waitFor();
 assert.equal(await page.locator('.fl-focus-group').count(),3);
 assert.equal(await page.locator('.fl-focus-row').count(),5);
 assert.ok((await page.locator('.fl-focus-card__num').innerText()).includes('5'));
 assert.equal(await page.getByText('策划落地',{exact:true}).count(),0);
 assert.equal(await page.getByText('不应展示的完成任务',{exact:true}).count(),0);
 assert.equal(await page.getByText('海外虚拟 IP 落地',{exact:true}).count(),1);
 const reminderBox=await page.locator('.fl-focus-card').boundingBox();assert.ok(reminderBox.width<=280&&reminderBox.height<=240);
 await fs.mkdir(root+'_docs/qa/focus-20261123',{recursive:true});
 await page.screenshot({path:root+'_docs/qa/focus-20261123/grouped-light.png'});
 await page.getByRole('button',{name:'收起',exact:true}).click();await page.locator('.fl-focus-ball').waitFor();
 // Drag should stay compact and dock; the next click expands.
 let r=await page.locator('.fl-focus-ball').boundingBox();
 await page.mouse.move(r.x+26,r.y+26);await page.mouse.down();await page.mouse.move(120,300,{steps:8});await page.mouse.up();
 assert.equal(await page.locator('.fl-focus-card').count(),0);assert.equal(await page.locator('.fl-focus-ball').count(),1);
 await page.locator('.fl-focus-ball').click();await page.locator('.fl-focus-card').waitFor();
 // Keyboard activation is independent of pointer deduplication.
 await page.getByRole('button',{name:'收起',exact:true}).click();await page.locator('.fl-focus-ball').focus();await page.keyboard.press('Enter');await page.locator('.fl-focus-card').waitFor();
 // Child navigation has the correct parent and child ids.
 await page.getByRole('button',{name:'手机购买',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.opened.at(-1)),['a','phone']);
 // Explicitly selecting none stays empty instead of silently reverting to all.
 await page.getByRole('button',{name:'选择',exact:true}).click();
 while(await page.getByRole('checkbox',{checked:true}).count())await page.getByRole('checkbox',{checked:true}).first().click();
 await page.getByRole('button',{name:'完成',exact:true}).click();assert.equal(await page.locator('.fl-focus-row').count(),0);
 await page.getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('checkbox',{name:/手机购买/}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
 assert.equal(await page.locator('.fl-focus-group').count(),1);assert.equal(await page.locator('.fl-focus-row').count(),1);
 assert.equal(await page.getByText('海外虚拟 IP 落地',{exact:true}).count(),1);
 // Completion via the task store immediately removes it; no write from the widget.
 await page.evaluate(()=>{window.fixture.tasks[0].subtasks[0].current=1;window.fixture.emit();});
 assert.equal(await page.locator('.fl-focus-row').count(),0);
 await page.evaluate(()=>{window.fixture.tasks[0].subtasks[0].current=0;window.fixture.emit();});
 await page.getByRole('button',{name:'悬浮到其他软件上方',exact:true}).click();await page.locator('.fl-focus-ball').waitFor();
 const open=requests.find(r=>r.op==='open');assert.equal(open.snapshot.groups.length,1);assert.equal(open.snapshot.groups[0].children[0].id,'phone');
 assert.match(open.snapshot.palette.bg,/^rgb/);
 await page.locator('.fl-focus-ball').click();nativeFail=true;
 await page.getByRole('button',{name:'悬浮到其他软件上方',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/test native failure/);
 // Fit narrow windows; re-clamp persisted edge offsets on resize.
 await page.setViewportSize({width:320,height:480});await page.waitForTimeout(50);
 r=await page.locator('.fl-focus-card').boundingBox();assert.ok(r.x>=0&&r.x+r.width<=321&&r.y>=0&&r.y+r.height<=481);
 await page.screenshot({path:root+'_docs/qa/focus-20261123/grouped-narrow.png'});
 await page.evaluate(()=>{window.dispose();});assert.equal(await page.locator('.fl-focus-root').count(),0);assert.equal(await page.evaluate(()=>window.fixture.subs.size),0);
 assert.deepEqual(errors,[]);
 // Native presentation uses the resolved host palette and requests a content-sized window.
 const nativePage=await context.newPage();await nativePage.setViewportSize({width:280,height:222});await nativePage.goto(origin+'/native');
 const nativeSnapshot={...open.snapshot,count:'剩余 5 项',summary:'3 组任务 · 点击名称查看任务',groups:[{taskId:'a',name:'海外虚拟 IP 落地',priority:'P0',parentPinned:true,children:[{id:'phone',name:'手机购买',progress:'0/1 台'}]},{taskId:'b',name:'陈杰内容规划',priority:'P2',parentPinned:true,children:[{id:'research',name:'资料收集',progress:''}]},{taskId:'c',name:'AI 短视频创作课',priority:'P2',parentPinned:true,children:[]}]};
 await nativePage.evaluate(data=>{window.nativeEvents=[];window.webkit={messageHandlers:{focus:{postMessage:event=>window.nativeEvents.push(event)}}};window.applySnapshot(data);},nativeSnapshot);
 await nativePage.waitForFunction(()=>window.nativeEvents.some(e=>e.type==='size'));
 const height=await nativePage.evaluate(()=>window.nativeEvents.find(e=>e.type==='size').height);assert.ok(height<=240);
 await nativePage.setViewportSize({width:280,height});
 await nativePage.mouse.move(279,height-1);
 assert.ok(await nativePage.evaluate(()=>document.body.scrollWidth<=window.innerWidth));
 await nativePage.screenshot({path:root+'_docs/qa/focus-20261123/native-compact-light.png'});
 await nativePage.getByRole('button',{name:'手机购买',exact:true}).click();assert.deepEqual(await nativePage.evaluate(()=>window.nativeEvents.at(-1)),{type:'task',taskId:'a',subtaskId:'phone'});
 await nativePage.evaluate(data=>window.applySnapshot({...data,mode:'dark',palette:{bg:'rgb(40, 39, 36)',surface:'rgb(52, 51, 47)',text:'rgb(238, 234, 226)',secondary:'rgb(181, 177, 167)',border:'rgb(69, 67, 61)',accent:'rgb(225, 139, 107)',danger:'rgb(237, 139, 128)',warning:'rgb(210, 173, 107)'}}),nativeSnapshot);
 await nativePage.screenshot({path:root+'_docs/qa/focus-20261123/native-compact-dark.png'});
 await nativePage.close();
 console.log('PASS: click swallowed by host, drag/click, keyboard, pending filter, groups, selection, completion sync, native errors, resize, disposal.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
