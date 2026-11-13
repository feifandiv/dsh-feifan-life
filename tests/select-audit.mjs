import assert from 'node:assert/strict';
import path from 'node:path';

// Exercise real controls with real option strings, through pointer and keyboard.
export async function auditSelects(page, qa, results, variant = 'desktop-light') {
  const inspected=[];
  async function inspect(scope, name) {
    const controls=scope.locator('.ff-select-button:visible');
    for(let i=0;i<await controls.count();i++) {
      const control=controls.nth(i);
      const label=await control.innerText();
      await control.click();
      const menu=page.locator('.ff-select-menu');
      await menu.waitFor();
      const geometry=await menu.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {x:rect.x,right:rect.right,width:rect.width,viewport:innerWidth,overflow:el.scrollWidth-el.clientWidth,options:[...el.querySelectorAll('[role=option]')].map(option=>{
          const range=document.createRange();range.selectNodeContents(option);
          const text=range.getBoundingClientRect(),box=option.getBoundingClientRect();
          return {label:option.textContent,height:text.height,lineHeight:parseFloat(getComputedStyle(option).lineHeight),width:text.width,available:box.width-18};
        })};
      });
      const arrow=await control.evaluate(el=>({before:getComputedStyle(el,'::before').content,after:getComputedStyle(el,'::after').content,icons:el.querySelectorAll('.ff-select-caret svg').length}));
      if(name==='life-inputs'&&i===0) await page.screenshot({path:path.join(qa,'select-life-type-'+variant+'.png'),animations:'disabled'});
      assert.equal(arrow.icons,1,name+': '+label);
      assert.ok(['none','normal'].includes(arrow.after),'duplicate pseudo arrow: '+name+': '+label);
      assert.ok(geometry.x>=7&&geometry.right<=geometry.viewport-7,'menu viewport: '+name+': '+label);
      for(const option of geometry.options) {
        assert.ok(option.height<=option.lineHeight+2,'wrapped option '+name+': '+option.label+' '+JSON.stringify(geometry));
        assert.ok(option.width<=option.available+2,'clipped option '+name+': '+option.label);
      }
      assert.ok(geometry.overflow<=1,'menu content unexpectedly clipped: '+name+': '+label);
      if(name==='life-inputs'&&label==='榜单') await page.screenshot({path:path.join(qa,'select-life-long-'+variant+'.png'),animations:'disabled'});
      const search=menu.locator('input');
      if(await search.count()&&geometry.options.length) {
        const query=geometry.options.at(-1).label;
        await search.fill(query);
        assert.ok(await menu.getByRole('option').count()>0,'search lost matching option');
        await search.fill('');
      }
      await page.keyboard.press('End');
      await page.keyboard.press('Home');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ff-select-portal').count(),0);
      assert.equal(await control.evaluate(el=>document.activeElement===el),true);
      inspected.push({name,label,options:geometry.options.length,width:geometry.width});
    }
  }
  await page.locator('.cc-tab[data-tab="life"]').click();
  const life=page.locator('[data-panel="life"]');
  for(const [label,name] of [['输入清单','life-inputs'],['物资清单','life-inventory']]) {
    await life.getByRole('button',{name:label,exact:true}).click();
    await inspect(life,name);
    await life.getByRole('button',{name:'+ 新增',exact:true}).click();
    await inspect(page.getByRole('dialog'),name+'-form');
    await page.keyboard.press('Escape');
  }
  await page.locator('.cc-tab[data-tab="finance"]').click();
  const finance=page.locator('[data-panel="finance"]');
  await finance.locator('.fl-tab').filter({hasText:'收支明细'}).click();
  await inspect(finance,'finance-detail');
  await finance.getByRole('button',{name:'+ 记一笔',exact:true}).click();
  await inspect(page.getByRole('dialog'),'finance-form');
  await page.keyboard.press('Escape');
  await page.locator('.cc-tab[data-tab="tasks"]').click();
  const tasks=page.locator('[data-panel="tasks"]');
  await inspect(tasks,'tasks');
  await tasks.getByRole('button',{name:'新建任务',exact:true}).click();
  await inspect(page.getByRole('dialog'),'task-form');
  await page.keyboard.press('Escape');
  results.selectAudit ??= {};
  results.selectAudit[variant]=inspected;
  results.checks.push(variant+': all '+inspected.length+' shared dropdowns across task/finance/life filters and forms: single arrow, full single-line labels, bounds, search, keyboard and cleanup');
}
