import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';
import { auditSelects } from './select-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.join(root, '_docs/qa');
await fs.mkdir(qa, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'feifan-life-browser-'));
const data = path.join(temp, 'data');
const live = '/Users/feifan/FEIFAN/08-系统/09非凡人生数据';
await fs.cp(live, data, { recursive: true });
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const dshRequire = require;
const skinSource = await fs.readFile(path.join(root, '../dsh-skins/client.js'), 'utf8');
const skinCSS = JSON.parse(skinSource.match(/const SKIN_CSS = ("(?:[^"\\]|\\.)*");/)[1]);
const bootstrap = await esbuild.build({ stdin: { contents: `
  import * as React from ${JSON.stringify(dshRequire.resolve('react'))};
  import { createRoot } from ${JSON.stringify(dshRequire.resolve('react-dom/client'))};
  const entries = [];
  let selected = null;
  let update;
  const layout = {selectPanel(id) { selected = id; update?.(id); }};
  window.testLayout = layout;
  function Frame() {
    const [panel, setPanel] = React.useState(selected);
    const [width, setWidth] = React.useState(280);
    update = setPanel;
    window.setSidebarWidth = setWidth;
    const Main = entries.find(e => e.options.name === 'main' && e.options.key === panel)?.Component;
    const panels = entries.filter(e => e.options.name === 'sidebar.panellist').sort((a,b)=>a.options.order-b.options.order);
    return React.createElement('div', {id:'frame',style:{display:'grid',gridTemplateColumns:width+'px minmax(0,1fr)',height:'100dvh',overflow:'hidden'}},
      React.createElement('aside', {id:'sidebar',style:{background:'var(--dsw-specific-sidebar-fill)',color:'var(--dsw-alias-label-primary)',minWidth:0,overflow:'hidden',padding:'12px',display:'flex',flexDirection:'column',gap:'12px'}},
        React.createElement('button',{id:'sidebar-toggle',onClick:()=>setWidth(w=>w===280?56:280)},'☰'),
        React.createElement('button',{id:'conversation',onClick:()=>layout.selectPanel(null)},'对话'),
        React.createElement('nav',{id:'panel-list'},
          React.createElement('button',{'aria-label':'自动化任务'},'自动化任务'),
          ...panels.map(({options,Component})=>React.createElement('button',{key:options.id,'aria-label':options.label(),'aria-current':panel===options.id?'page':undefined,onClick:()=>layout.selectPanel(options.id)},
            React.createElement(Component,{size:width>56?16:18,active:panel===options.id}),width>56?options.label():null)),
          React.createElement('button',{'aria-label':'更多'},'更多'))),
      React.createElement('main',{id:'main',style:{display:'flex',flexDirection:'column',minWidth:0,minHeight:0}}, Main ? React.createElement(Main) : 'DSH 对话'));
  }
  window.__ModuleLoader__ = {load(def) {
    const plugin = def.factory(name => { if(name === 'react') return React; throw Error(name); });
    window.disposePlugin = plugin.apply({
      layout,
      slots: {
        inject(name, callback) { return callback(); },
        register(options, Component) {
          if (!options.name || typeof Component !== 'function') throw Error('Invalid DSH slot registration');
          if(options.name === 'sidebar.footer.action') throw Error('Launcher must use native panel navigation');
          if(options.name === 'sidebar.panellist' && (options.id !== 'feifan-life' || options.order !== 20 || typeof options.label !== 'function')) throw Error('Invalid panel navigation metadata');
          if(options.name === 'main' && options.key !== 'feifan-life') throw Error('Missing native panel key');
          entries.push({options,Component}); return () => {};
        }
      }, locale: {getLocale: () => ({id:'zh'})}, effect: fn => fn()
    });
    createRoot(document.getElementById('host')).render(React.createElement(Frame));
  }};
`, resolveDir: root }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const routes = [];
const effects = [];
apply({
  webServer: { register(route) { routes.push(route); return () => {}; } },
  effect(fn) { effects.push(fn()); },
  connection: { authorizeIndex(req, res) {
    const cookie = req.headers instanceof Headers ? req.headers.get('cookie') : req.headers.cookie;
    if (cookie === 'audit=synthetic') return true;
    res.writeHead(401, {}); res.end('Unauthorized'); return false;
  } },
}, { dataDir: data, vaultDir: data });
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!DOCTYPE html><html data-dsh-skin="paper"><head><meta charset="utf-8"><style>'+skinCSS+' body{--dsw-alias-label-primary-inverted:#fff;--dsw-radius-md:10px} body[data-ds-dark-theme]{--dsw-alias-label-primary-inverted:#181818}</style></head><body style="margin:0"><div id="host"></div><script src="/bootstrap.js"></script><script src="/client.js"></script></body></html>'); return; }
    if (req.url === '/bootstrap.js') { res.setHeader('content-type', 'text/javascript'); res.end(bootstrap.outputFiles[0].text); return; }
    if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'client.js'))); return; }
    const route = routes.find(r => r.kind === 'exact' && req.url === r.path) || routes.find(r => r.kind === 'prefix' && req.url.startsWith(r.path));
    if (!route) { res.writeHead(404); res.end(); return; }
    if (route.handler) { await route.handler(req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const response = await route.resource(new Request('http://localhost' + req.url, { headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const results = { origin, testedAt: new Date().toISOString(), checks: [], errors: [] };
let browser;
try {
  const anonymous = await fetch(origin + '/dsh-feifan-life/api/fs', { method: 'POST', headers: {'content-type':'application/json'}, body: '{"op":"read","path":".obsidian/plugins/feifan-life/data.json"}' });
  assert.equal(anonymous.status, 401);
  results.checks.push('host rejects unauthenticated filesystem access');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: {width:1372,height:1000}, colorScheme:'light' });
  context.setDefaultTimeout(10000);
  await context.addCookies([{name:'audit',value:'synthetic',url:origin}]);
  const page = await context.newPage();
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('console', msg => { if(msg.type()==='error') results.errors.push(msg.text().slice(0,1000)); });
  await page.route('https://**', route => route.abort());
  await page.goto(origin);
  await page.getByRole('button', { name: '非凡人生', exact: true }).click();
  await page.waitForSelector('.cc-tabs', { timeout: 15000 });
  assert.equal(await page.locator('.cc-tab').count(), 8);
  assert.ok((await page.locator('.hero-greet').innerText()).includes('非凡'));
  await page.screenshot({animations:'disabled',path:path.join(qa,'overview-light.png'),fullPage:true});
  assert.equal(await page.locator('#panel-list [aria-current="page"]').getAttribute('aria-label'),'非凡人生');
  assert.equal(await page.getByRole('button',{name:'非凡人生',exact:true}).count(),1);
  results.checks.push('launch from native sidebar panel row; selected state, single entry; original eight tabs and personal greeting');
  assert.equal(await page.locator('.cc-left').count(),0);
  await page.locator('.cc-tab[data-tab="finance"]').click();
  for(const width of [280,56,360]) {
    await page.evaluate(w=>window.setSidebarWidth(w),width);
    await page.waitForFunction(w=>Math.abs(document.querySelector('#fl-overlay').getBoundingClientRect().left-w)<1,width);
    assert.equal(await page.locator('#sidebar-toggle').evaluate(el=>document.elementFromPoint(el.getBoundingClientRect().x+5,el.getBoundingClientRect().y+5)===el),true);
  }
  assert.equal(await page.locator('.cc-tab.active').getAttribute('data-tab'),'finance');
  await page.locator('#sidebar-toggle').click();
  await page.locator('#conversation').click();
  await page.waitForSelector('#fl-overlay',{state:'detached'});
  await page.getByRole('button',{name:'非凡人生',exact:true}).click();
  await page.waitForSelector('.cc-tabs');
  assert.equal(await page.locator('.cc-tab').count(),8);
  results.checks.push('native main panel: sidebar expanded/collapsed/resized stays clickable; navigate away and reopen; no internal left column');
  for(const skin of ['paper','mimo']) for(const dark of [false,true]) {
    await page.evaluate(({skin,dark})=>{document.documentElement.dataset.dshSkin=skin;document.body.toggleAttribute('data-ds-dark-theme',dark);},{skin,dark});
    await page.waitForFunction(dark=>document.querySelector('.ff-ui').dataset.ffMode===(dark?'dark':'light'),dark);
    const colors=await page.evaluate(()=>{const host=getComputedStyle(document.body),ui=getComputedStyle(document.querySelector('.ff-ui'));return {canvas:ui.getPropertyValue('--ff-canvas').trim(),hostCanvas:host.getPropertyValue('--dsw-alias-bg-base').trim(),text:ui.getPropertyValue('--ff-text').trim(),hostText:host.getPropertyValue('--dsw-alias-label-primary').trim(),action:ui.getPropertyValue('--ff-action').trim(),hostAction:host.getPropertyValue('--dsw-alias-button-primary-fill').trim()};});
    assert.equal(colors.canvas,colors.hostCanvas);assert.equal(colors.text,colors.hostText);assert.equal(colors.action,colors.hostAction);
    await page.waitForFunction(()=>{const button=document.querySelector('.btn.primary');const probe=document.createElement('span');probe.style.color='var(--dsw-alias-button-primary-fill)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(button).backgroundColor===expected;});
    await page.screenshot({animations:'disabled',path:path.join(qa,'skin-'+skin+'-'+(dark?'dark':'light')+'.png')});
  }
  await page.evaluate(()=>{document.documentElement.dataset.dshSkin='paper';document.body.removeAttribute('data-ds-dark-theme');window.setSidebarWidth(280);});
  results.checks.push('live Paper/Ink × light/dark switching: canvas, text and actions inherit exact host tokens');
  for (const tab of ['overview','tasks','planning','finance','life','habits','inspiration','review']) {
    await page.locator('.cc-tab[data-tab="'+tab+'"]').click();
    if(tab==='review') await page.waitForSelector('[data-panel="review"] .rv-grid');
    const content = await page.locator('[data-panel="'+tab+'"]').innerText();
    assert.ok(content.trim().length>0,tab+' is empty');
    await page.screenshot({animations:'disabled',path:path.join(qa,tab+'-light.png')});
    results.checks.push('page renders: '+tab);
  }
  await auditSelects(page,qa,results);
  await page.evaluate(()=>{document.body.setAttribute('data-ds-dark-theme','');window.setSidebarWidth(56);});
  await page.setViewportSize({width:1024,height:900});
  await auditSelects(page,qa,results,'1024-dark');
  await page.evaluate(()=>window.setSidebarWidth(0));
  await page.setViewportSize({width:390,height:900});
  await auditSelects(page,qa,results,'390-dark');
  await page.evaluate(()=>{document.body.removeAttribute('data-ds-dark-theme');window.setSidebarWidth(280);});
  await page.setViewportSize({width:1372,height:1000});
  await page.locator('.cc-tab[data-tab="tasks"]').click();
  const newTask = page.locator('[data-panel="tasks"]').getByRole('button',{name:'新建任务',exact:true});
  await newTask.click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.evaluate(el=>getComputedStyle(el.closest('.ff-ui')).getPropertyValue('--ff-text').trim()===getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim()),true);
  await dialog.getByPlaceholder('例如：完成首页设计稿').fill('Codex 临时任务验收');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('placeholder')), '例如：完成首页设计稿');
  await dialog.getByRole('combobox').filter({hasText:'P2'}).click();
  await page.getByRole('option',{name:'P0',exact:true}).click();
  await page.screenshot({animations:'disabled',path:path.join(qa,'new-task-dialog.png')});
  await dialog.getByRole('button',{name:'确定',exact:true}).click();
  await page.waitForFunction(()=>window.__dshFeifanLife.plugin().stores.root.data.kanban.tasks.some(x=>x.name==='Codex 临时任务验收'&&x.priority==='P0'));
  await page.evaluate(()=>window.__dshFeifanLife.plugin().stores.root.flush());
  results.checks.push('task form: name, priority dropdown, create and persist');
  await newTask.click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.locator('#fl-overlay').getAttribute('data-fl-open'),'true');
  assert.equal(await newTask.evaluate(el=>document.activeElement===el),true);
  results.checks.push('Escape closes modal, restores focus, leaves workspace open');
  for(let run=0;run<2;run++) {
    await page.locator('.notice-container').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
    await page.locator('[data-panel="tasks"]').getByRole('button',{name:'同步到知识库',exact:true}).click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.notice')).some(n=>n.textContent.includes('已同步')));
  }
  const mirrorFiles=await fs.readdir(path.join(data,'02-任务看板'));
  assert.ok(mirrorFiles.includes('任务-Codex 临时任务验收.md'));
  results.checks.push('task mirror writes to dedicated data directory; second sync succeeds');
  // Persist a synthetic record through the actual queue, then reload a fresh page.
  await page.evaluate(async () => {
    const p=window.__dshFeifanLife.plugin();
    await p.stores.root.mutate(d => d.cmd.inspirations.push({id:'codex-audit-only',title:'临时验收记录',content:'仅测试副本',type:'观点',status:'收件箱',tags:[],source:'test',captureMode:'manual',relatedTo:'',createdAt:Date.now(),updatedAt:Date.now(),usedAt:null}));
  });
  const saved = JSON.parse(await fs.readFile(path.join(data,'data.json'),'utf8'));
  assert.ok(saved.cmd.inspirations.some(x=>x.id==='codex-audit-only'));
  await page.reload();
  await page.getByRole('button',{name:'非凡人生',exact:true}).click();
  await page.waitForSelector('.cc-tabs');
  assert.equal(await page.evaluate(()=>window.__dshFeifanLife.plugin().stores.root.data.cmd.inspirations.some(x=>x.id==='codex-audit-only')),true);
  results.checks.push('save queue writes to dedicated data directory; survives full page reload');
  await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''));
  await page.waitForFunction(()=>document.querySelector('.ff-ui').dataset.ffMode==='dark');
  await page.screenshot({animations:'disabled',path:path.join(qa,'overview-dark.png')});
  results.checks.push('dark mode');
  for(const width of [1024,390]) {
    await page.evaluate(w=>window.setSidebarWidth(w<500?0:56),width);
    await page.setViewportSize({width,height:900});
    await page.screenshot({animations:'disabled',path:path.join(qa,'overview-'+width+'.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    await page.locator('.cc-tab[data-tab="tasks"]').click();
    await page.locator('[data-panel="tasks"]').getByRole('button',{name:'新建任务',exact:true}).click();
    const rect=await page.getByRole('dialog').boundingBox();
    assert.ok(rect.x>=0&&rect.x+rect.width<=width+1,'dialog exceeds viewport at '+width);
    await page.screenshot({animations:'disabled',path:path.join(qa,'new-task-'+width+'.png')});
    await page.keyboard.press('Escape');
    await page.locator('.cc-tab[data-tab="overview"]').click();
  }
  results.checks.push('1024 and 390: page and task dialog remain within viewport');
  // Recover the actual RootStore from an invalid main file and the saved before-write snapshots.
  await page.close();
  await fs.writeFile(path.join(data,'data.json'),'{invalid audit fixture');
  const restoredPage=await context.newPage();
  await restoredPage.goto(origin);
  await restoredPage.getByRole('button',{name:'非凡人生',exact:true}).click();
  await restoredPage.waitForSelector('.cc-tabs',{timeout:15000});
  const restored=JSON.parse(await fs.readFile(path.join(data,'data.json'),'utf8'));
  assert.ok(restored.finance.ledgers.personal.transactions.length>0);
  results.checks.push('corrupted main data recovered from valid backup by production RootStore');
  // The blocked weather request is deliberate; no network-dependent weather success is claimed.
  results.errors=results.errors.filter(x=>!x.includes('ERR_FAILED')&&!x.includes('天气')&&!x.includes('Failed to load resource'));
  assert.deepEqual(results.errors,[]);
} catch(error) {
  results.failure=error.stack;
  await browser?.contexts()[0]?.pages()[0]?.screenshot({path:path.join(qa,'failure.png')}).catch(()=>{});
  console.error(error.stack);
  process.exitCode=1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(qa,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
  await fs.rm(temp,{recursive:true,force:true});
  console.log(JSON.stringify(results,null,2));
}
