import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);const puppeteer=require('../engine/MatrixMedia/node_modules/puppeteer-core');
let browser,server,origin;
test.before(async()=>{
  const directory=fileURLToPath(new URL('../desktop/ui/',import.meta.url));
  const allowed=new Set(['index.html','app.mjs','styles.css','form-state.mjs','people-ui.mjs','icons.svg','src/platforms.mjs']);
  server=http.createServer(async(req,res)=>{const name=req.url.split('?')[0].replace(/^\//,'')||'index.html';if(!allowed.has(name)){res.writeHead(404).end();return;}const types={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};res.setHeader('Content-Type',types[name.split('.').pop()]);res.end(await fs.readFile(name==='src/platforms.mjs'?fileURLToPath(new URL('../src/platforms.mjs',import.meta.url)):path.join(directory,name)));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:process.env.CONTENT_OPS_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function pageFixture(){
  const page=await browser.newPage();await page.setViewport({width:1380,height:940});
  await page.evaluateOnNewDocument(()=>{
    const job={id:'e7352393-0cae-5025-be7f-3a732201a507',title:'<img src=x onerror="window.injected=true">',description:'真实的测试说明',phone:'测试账号',state:'prepared',statusLabel:'待执行',tone:'neutral',mode:'draft',visibility:'private',inputDigest:'hash',videoName:'素材.mp4',canExecute:true};
    window.__calls=[];window.contentOps={onUpdate:handler=>{window.__emit=handler;return ()=>{};},invoke:async(method,args)=>{
      window.__calls.push({method,args});
      if(method==='dashboard')return {jobs:[job],accounts:[{phone:'测试账号',pt:'抖音',loggedIn:true}],health:{ok:true,checks:[]}};
      if(method==='refresh')return {};
      if(method==='chooseVideo')return {path:'/fixtures/素材.mp4',name:'素材.mp4',size:102400,url:null};
      if(method==='prepare')return new Promise(resolve=>{window.__finishPrepare=()=>resolve({...job,title:args.input.title,videoPath:args.input.video});});
      return {};
    }};
  });
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.querySelector('#account')?.value==='测试账号');return page;
}
test('renderer treats content as text, filters real states and keeps actions visible',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=tasks]');assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.$$('img[src=x]').then(a=>a.length),0);
    await page.type('#task-search','不存在');assert.match(await page.$eval('#task-list',e=>e.textContent),/没有找到/);
    await page.click('[data-view=workspace]');const bounds=await page.$eval('#primary-action',e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});assert.ok(bounds.top>0&&bounds.bottom<=940,JSON.stringify(bounds));
  }finally{await page.close();}
});
test('changing form content while preparation runs never enables stale execution',async()=>{
  const page=await pageFixture();try{
    await page.click('#choose-video');await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);
    await page.click('#title');await page.keyboard.type('新内容');await page.evaluate(()=>window.__finishPrepare());await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled);
    assert.match(await page.$eval('#primary-action',e=>e.textContent),/准备任务/);assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='execute')),false);
  }finally{await page.close();}
});
test('a prepared task has a visible execute button directly in the task list',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=tasks]');
    const button=await page.$('[data-execute="e7352393-0cae-5025-be7f-3a732201a507"]');
    assert.ok(button,'待执行任务应在列表中直接显示执行按钮');assert.match(await button.evaluate(e=>e.textContent),/执行任务/);
    await button.click();await page.waitForFunction(()=>window.__calls.some(c=>c.method==='execute'));
    assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.method==='execute').map(c=>c.args.id)),['e7352393-0cae-5025-be7f-3a732201a507']);
  }finally{await page.close();}
});
test('after preparing, the main action explicitly says execute and invokes the task',async()=>{
  const page=await pageFixture();try{
    await page.click('#choose-video');await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);await page.evaluate(()=>window.__finishPrepare());
    await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled&&document.querySelector('#primary-action').textContent.includes('草稿'));
    assert.match(await page.$eval('#primary-action',e=>e.textContent),/执行/);await page.click('#primary-action');
    await page.waitForFunction(()=>window.__calls.some(c=>c.method==='execute'));assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='execute').args.id),'e7352393-0cae-5025-be7f-3a732201a507');
  }finally{await page.close();}
});
test('tasks awaiting verification do not offer a new execute action',async()=>{
  const page=await pageFixture();try{
    await page.evaluate(()=>window.__emit({type:'snapshot',data:{jobs:[{id:'b68b81ca-c22e-4500-8b0a-b908702ec026',title:'等待回查',phone:'测试账号',state:'unknown',statusLabel:'待核实',mode:'draft',visibility:'private',canExecute:false,canVerify:true}],accounts:[{phone:'测试账号',pt:'抖音',loggedIn:true}],health:{ok:true,checks:[]}}}));
    await page.click('[data-view=tasks]');assert.equal(await page.$$('[data-execute]').then(buttons=>buttons.length),0);
  }finally{await page.close();}
});
test('switching platforms invalidates pending preparation and keeps accounts and scope specific',async()=>{
  const page=await pageFixture();try{
    await page.click('#choose-video');await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);
    assert.ok(await page.$('#platform'),'工作台应可选择平台');
    await page.select('#platform','sph');await page.evaluate(()=>window.__finishPrepare());
    await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled);
    assert.match(await page.$eval('#primary-action',e=>e.textContent),/准备任务/);
    assert.equal(await page.$('#visibility'),null);assert.equal(await page.$('[data-mode="publish"]'),null);
    assert.match(await page.$eval('#main',e=>e.textContent),/可见范围尚未验证/);assert.equal(await page.$('#account'),null);
    assert.ok(await page.$('#short-title'));assert.match(await page.$eval('#main',e=>e.textContent),/标题.*描述/);
  }finally{await page.close();}
});
test('sph account login sends platform and shows WeChat QR wording',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=accounts]');assert.ok(await page.$('#login-platform'));await page.select('#login-platform','sph');
    await page.type('#login-phone','视频账号');await page.click('#login-button');
    await page.waitForFunction(()=>window.__calls.some(c=>c.method==='login'));
    assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='login').args.platform),'sph');
    assert.match(await page.$eval('.login-panel',e=>e.textContent),/微信/);
  }finally{await page.close();}
});

test('xhs can connect while its draft workspace is marked pending live acceptance',async()=>{
  const page=await pageFixture();try{
    assert.equal(await page.$eval('#platform option[value=xhs]',e=>e.disabled),false);
    await page.click('[data-view=accounts]');assert.equal(await page.$eval('#login-platform option[value=xhs]',e=>e.disabled),false);await page.select('#login-platform','xhs');await page.type('#login-phone','小红书示例');await page.click('#login-button');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='login'));
    assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='login').args.platform),'xhs');assert.match(await page.$eval('.login-panel',e=>e.textContent),/本人|小红书/);
  }finally{await page.close();}
});

test('xhs workspace uses a 20-character count, local-draft notice and a review action while execution is gated',async()=>{
  const page=await pageFixture();try{
    assert.equal(await page.$eval('#platform option[value=xhs]',e=>e.disabled),false);
    await page.evaluate(()=>window.__emit({type:'snapshot',data:{jobs:[],accounts:[{phone:'小红书示例',pt:'小红书',loggedIn:true}],health:{ok:true,checks:[]}}}));await page.select('#platform','xhs');assert.equal(await page.$eval('#title-count',e=>e.textContent),'0 / 20');assert.match(await page.$eval('#main',e=>e.textContent),/本机草稿|本机浏览器/);assert.equal(await page.$('[data-mode=publish]'),null);
    await page.click('#choose-video');await page.$eval('#title',e=>{e.value='标题';e.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.$eval('#title-count',e=>e.textContent),'2 / 20');
    await page.evaluate(()=>{const invoke=window.contentOps.invoke;window.contentOps.invoke=async(method,args)=>method==='prepare'?{id:'e7352393-0cae-5025-be7f-3a732201a507',platform:'xhs',title:args.input.title,phone:'小红书示例',state:'prepared',mode:'draft',visibility:'unknown',canExecute:false,statusLabel:'待执行'}:invoke(method,args);});
    await page.click('#primary-action');await page.waitForFunction(()=>document.querySelector('#primary-action')?.textContent.includes('查看'));await page.click('#primary-action');assert.ok(await page.$eval('#task-dialog',e=>e.open));assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='execute')),false);assert.match(await page.$eval('#main',e=>e.textContent),/待实机验收|尚未.*验收/);
  }finally{await page.close();}
});

async function peoplePage(){
 const page=await pageFixture();await page.evaluate(()=>{
  const person={id:'897c72c7-5dd7-4d02-a144-eb4034851a11',name:'人员示例',revision:1,bindings:{dy:{platform:'dy',phone:'抖音示例'},sph:{platform:'sph',phone:'视频号示例'},xhs:{platform:'xhs',phone:'小红书示例'}}};
  const accounts=Object.values(person.bindings).map(a=>({...a,loggedIn:true}));const invoke=window.contentOps.invoke;
  window.contentOps.invoke=async(method,args)=>{if(['peopleSave','prepareBatch','executeBatch'].includes(method))window.__calls.push({method,args});
   if(method==='peopleSave')return {...args.person,id:person.id,revision:2};
   if(method==='prepareBatch')return {kind:'batch',id:'27d283fe-f258-468a-ad15-42879479e753',person,title:args.input.title,description:args.input.description,mode:'draft',state:'prepared',statusLabel:'待执行',canExecute:true,digest:'batch-digest',attempt:0,targetIds:['a','b'],jobs:[{id:'a',platform:'dy',platformName:'抖音',phone:'抖音示例',statusLabel:'待执行'},{id:'b',platform:'sph',platformName:'微信视频号',phone:'视频号示例',statusLabel:'待执行'},{id:'c',platform:'xhs',platformName:'小红书',phone:'小红书示例',statusLabel:'待执行',blockedReason:'待实机验收，本次不会执行'}]};
   return invoke(method,args);
  };
  window.__emit({type:'snapshot',data:{people:[person],jobs:[],accounts,health:{ok:true}}});
 });return page;
}
test('people workspace selects owned accounts, shows gated targets and invokes a single batch preparation',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-flow=people]');assert.equal(await page.$eval('#person',e=>e.value),'897c72c7-5dd7-4d02-a144-eb4034851a11');
  assert.match(await page.$eval('#main',e=>e.textContent),/抖音示例/);assert.match(await page.$eval('#main',e=>e.textContent),/小红书.*待.*验收/s);assert.equal(await page.$eval('#title-count',e=>e.textContent),'0 / 20');
  assert.equal(await page.$('[data-mode=publish]'),null);await page.click('#choose-video');await page.$eval('#title',e=>{e.value='多平台示例';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('#primary-action');
  await page.waitForFunction(()=>window.__calls.some(c=>c.method==='prepareBatch'));
  const input=await page.evaluate(()=>window.__calls.find(c=>c.method==='prepareBatch').args.input);assert.deepEqual(input.platforms,['dy','sph','xhs']);assert.equal(input.personId,'897c72c7-5dd7-4d02-a144-eb4034851a11');
  await page.waitForFunction(()=>document.querySelector('#primary-action')?.textContent.includes('执行'));await page.click('#primary-action');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='executeBatch'));
  await page.click('[data-view=tasks]');assert.match(await page.$eval('#main',e=>e.textContent),/人员示例/);assert.equal(await page.$$('[data-execute-batch]').then(x=>x.length),1);
  await page.click('[data-detail]');assert.match(await page.$eval('#task-dialog',e=>e.textContent),/本次不会执行/);
 }finally{await page.close();}
});
test('people manager edits all platform bindings and escapes names while selection changes invalidate preparation',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-view=accounts]');await page.select('#people-editor','897c72c7-5dd7-4d02-a144-eb4034851a11');assert.equal(await page.$eval('#binding-dy',e=>e.value),'抖音示例');
  await page.$eval('#person-name',e=>e.value='<img src=x onerror="window.injected=true">');await page.select('#binding-xhs','');await page.click('#save-person');
  await page.waitForFunction(()=>window.__calls.some(c=>c.method==='peopleSave'));const saved=await page.evaluate(()=>window.__calls.find(c=>c.method==='peopleSave').args.person);assert.equal(saved.expectedRevision,1);assert.equal(saved.bindings.xhs,undefined);assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.click('[data-view=workspace]');await page.click('[data-flow=people]');await page.click('#choose-video');await page.click('#primary-action');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='prepareBatch'));
  await page.click('[data-batch-platform=sph]');assert.match(await page.$eval('#primary-action',e=>e.textContent),/准备/);
 }finally{await page.close();}
});

test('unbound platform checkboxes stay disabled when the workspace is idle',async()=>{
 const page=await peoplePage();try{
  await page.evaluate(()=>window.__emit({type:'snapshot',data:{people:[{id:'897c72c7-5dd7-4d02-a144-eb4034851a11',name:'仅一个平台',revision:2,bindings:{dy:{platform:'dy',phone:'示例'}}}],jobs:[],accounts:[{platform:'dy',phone:'示例',loggedIn:true}]}}));
  await page.click('[data-flow=people]');assert.equal(await page.$eval('[data-batch-platform=dy]',e=>e.disabled),false);
  for(const id of ['sph','xhs'])assert.equal(await page.$eval(`[data-batch-platform=${id}]`,e=>e.disabled),true);
 }finally{await page.close();}
});
