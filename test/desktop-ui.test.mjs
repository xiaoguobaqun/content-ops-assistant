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
  const allowed=new Set(['index.html','app.mjs','styles.css','form-state.mjs','icons.svg','src/platforms.mjs']);
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
