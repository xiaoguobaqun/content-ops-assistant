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
  const allowed=new Set(['index.html','app.mjs','styles.css','form-state.mjs','people-ui.mjs','icons.svg','src/platforms.mjs','src/profile-schema.mjs','profiles-ui.mjs','task-filters.mjs','task-ui.mjs']);
  server=http.createServer(async(req,res)=>{const name=req.url.split('?')[0].replace(/^\//,'')||'index.html';if(!allowed.has(name)){res.writeHead(404).end();return;}const types={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};res.setHeader('Content-Type',types[name.split('.').pop()]);res.end(await fs.readFile(name.startsWith('src/')?fileURLToPath(new URL('../'+name,import.meta.url)):path.join(directory,name)));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:process.env.CONTENT_OPS_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
async function pageFixture(){
  const page=await browser.newPage();await page.setViewport({width:1380,height:940});
  await page.evaluateOnNewDocument(()=>{
    const job={id:'cd43d70b-abbc-47fd-bcfe-e1586e920581',title:'<img src=x onerror="window.injected=true">',description:'真实的测试说明',phone:'测试账号',state:'prepared',statusLabel:'待执行',tone:'neutral',mode:'draft',visibility:'private',inputDigest:'hash',videoName:'素材.mp4',canExecute:true};
    window.__calls=[];window.contentOps={onUpdate:handler=>{window.__emit=handler;return ()=>{};},invoke:async(method,args)=>{
      window.__calls.push({method,args});
      if(method==='dashboard')return {protocolVersion:1,jobs:[job],accounts:[{phone:'测试账号',pt:'抖音',loggedIn:true}],health:{ok:true,checks:[]}};
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
    const button=await page.$('[data-execute="cd43d70b-abbc-47fd-bcfe-e1586e920581"]');
    assert.ok(button,'待执行任务应在列表中直接显示执行按钮');assert.match(await button.evaluate(e=>e.textContent),/执行任务/);
    await button.click();await page.waitForFunction(()=>window.__calls.some(c=>c.method==='execute'));
    assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.method==='execute').map(c=>c.args.id)),['cd43d70b-abbc-47fd-bcfe-e1586e920581']);
  }finally{await page.close();}
});
test('after preparing, the main action explicitly says execute and invokes the task',async()=>{
  const page=await pageFixture();try{
    await page.click('#choose-video');await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);await page.evaluate(()=>window.__finishPrepare());
    await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled&&document.querySelector('#primary-action').textContent.includes('草稿'));
    assert.match(await page.$eval('#primary-action',e=>e.textContent),/执行/);await page.click('#primary-action');
    await page.waitForFunction(()=>window.__calls.some(c=>c.method==='execute'));assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='execute').args.id),'cd43d70b-abbc-47fd-bcfe-e1586e920581');
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
test('扫码结束进入登录确认时隐藏旧二维码并明确无需重复扫码',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=accounts]');
    await page.evaluate(()=>window.__emit({type:'activity',activity:{id:'login',kind:'login',status:'running',platform:'dy',loginStage:'confirming',startedAt:Date.now(),qrUrl:'data:image/png;base64,invalid'}}));
    assert.equal(await page.$('#qr-region img'),null);assert.match(await page.$eval('#qr-region',e=>e.textContent),/确认.*登录|登录.*确认/);assert.match(await page.$eval('#qr-region',e=>e.textContent),/无需重复扫码/);
    assert.doesNotMatch(await page.$eval('#activity-region',e=>e.textContent),/二维码会自动刷新/);
  }finally{await page.close();}
});
test('二维码尚未生成时显示加载状态，不要求用户确认还没出现的二维码',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=accounts]');
    await page.evaluate(()=>window.__emit({type:'activity',activity:{id:'login',kind:'login',status:'running',platform:'dy',label:'请用抖音 App扫描二维码',startedAt:Date.now()}}));
    assert.match(await page.$eval('#activity-region',e=>e.textContent),/正在获取.*二维码/);
    assert.doesNotMatch(await page.$eval('#activity-region',e=>e.textContent),/二维码会自动刷新/);
    assert.doesNotMatch(await page.$eval('#qr-region',e=>e.textContent),/请在手机上确认登录/);
  }finally{await page.close();}
});
test('抖音扫码提示官方窗口可能继续要求短信本人验证',async()=>{
  const page=await pageFixture();try{
    await page.click('[data-view=accounts]');
    assert.match(await page.$eval('.login-panel',e=>e.textContent),/短信.*验证|验证.*短信/);
    await page.evaluate(()=>window.__emit({type:'activity',activity:{id:'login',kind:'login',status:'running',platform:'dy',qrUrl:'data:image/png;base64,offline',startedAt:Date.now()}}));
    assert.match(await page.$eval('#qr-region',e=>e.textContent),/抖音窗口.*短信|短信.*抖音窗口/);
    assert.match(await page.$eval('#activity-region',e=>e.textContent),/本人验证/);
  }finally{await page.close();}
});
test('账号移除按平台和名称发送到原生确认，取消保留列表，后台进行时按钮禁用',async()=>{
  const page=await pageFixture();try{
    await page.evaluate(()=>window.__emit({type:'snapshot',data:{people:[],jobs:[],accounts:[{phone:'测试账号',pt:'抖音',loggedIn:true},{phone:'测试账号',pt:'视频号',loggedIn:true}],health:{ok:true,checks:[]}}}));
    await page.click('[data-view=accounts]');
    const buttons=await page.$$('[data-remove-account]');assert.equal(buttons.length,2,'每个账号应有移除入口');
    await page.evaluate(()=>{const original=window.contentOps.invoke;window.contentOps.invoke=async(method,args)=>{if(method==='removeAccount'){window.__calls.push({method,args});return {canceled:true};}return original(method,args);};});
    await page.click('[data-remove-platform=dy]');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='removeAccount'));
    assert.deepEqual(await page.evaluate(()=>window.__calls.find(c=>c.method==='removeAccount').args),{platform:'dy',phone:'测试账号'});assert.equal(await page.$$('.account-row').then(rows=>rows.length),2);
    await page.evaluate(()=>window.__emit({type:'activity',activity:{id:'busy',status:'running',kind:'verify',startedAt:Date.now(),label:'模拟回查'}}));assert.equal(await page.$$eval('[data-remove-account]',rows=>rows.every(row=>row.disabled)),true);
  }finally{await page.close();}
});

test('xhs can connect while its draft workspace is marked pending live acceptance',async()=>{
  const page=await pageFixture();try{
    assert.equal(await page.$eval('#platform option[value=xhs]',e=>e.disabled),false);
    await page.click('[data-view=accounts]');assert.equal(await page.$eval('#login-platform option[value=xhs]',e=>e.disabled),false);await page.select('#login-platform','xhs');await page.type('#login-phone','小红书测试');await page.click('#login-button');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='login'));
    assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='login').args.platform),'xhs');assert.match(await page.$eval('.login-panel',e=>e.textContent),/本人|小红书/);
  }finally{await page.close();}
});

test('xhs workspace uses a 20-character count, local-draft notice and a review action while execution is gated',async()=>{
  const page=await pageFixture();try{
    assert.equal(await page.$eval('#platform option[value=xhs]',e=>e.disabled),false);
    await page.evaluate(()=>window.__emit({type:'snapshot',data:{jobs:[],accounts:[{phone:'小红书测试',pt:'小红书',loggedIn:true}],health:{ok:true,checks:[]}}}));await page.select('#platform','xhs');assert.equal(await page.$eval('#title-count',e=>e.textContent),'0 / 20');assert.match(await page.$eval('#main',e=>e.textContent),/本机草稿|本机浏览器/);assert.equal(await page.$('[data-mode=publish]'),null);
    await page.click('#choose-video');await page.$eval('#title',e=>{e.value='标题';e.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.$eval('#title-count',e=>e.textContent),'2 / 20');
    await page.evaluate(()=>{const invoke=window.contentOps.invoke;window.contentOps.invoke=async(method,args)=>method==='prepare'?{id:'cd43d70b-abbc-47fd-bcfe-e1586e920581',platform:'xhs',title:args.input.title,phone:'小红书测试',state:'prepared',mode:'draft',visibility:'unknown',canExecute:false,statusLabel:'待执行'}:invoke(method,args);});
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

async function profilePage({candidate=false,delayCapabilities=false}={}){
 const page=await peoplePage();await page.evaluate(({candidate,delayCapabilities})=>{
  if(delayCapabilities)window.__delayMethod="profileCapabilities";
  const id='897c72c7-5dd7-4d02-a144-eb4034851a11';const result={positioning:'合成定位',niche:'摄影',audience:'小商家',value:'实用知识',columns:['案例','方法','清单'],style:'平实',platformFocus:{dy:'演示'},boundaries:[],questions:[],observations:[]};
  window.__profile={personId:id,revision:0,currentBindingsDigest:'empty-bindings',bindingsDigest:'empty-bindings',mode:'manual',manual:{business:'',offering:'',goal:'',audience:'',resources:''},targetPlatforms:['dy','sph','xhs'],selectedPlatforms:[],samples:[],excludedWorkIds:[],candidate:candidate?{requestId:'candidate-id',result,materials:{mode:'manual',manual:{},accounts:[],targetPlatforms:[]}}:null,confirmed:null,run:null};
  const invoke=window.contentOps.invoke;window.contentOps.invoke=async(method,args={})=>{
   args=structuredClone(args);
   if(method===window.__delayMethod)await new Promise(resolve=>{window.__finishRequest=resolve;});
   if(method.startsWith('profile')||method.startsWith('aiSettings')||method==='setUnsaved')window.__calls.push({method,args});
   if(method==='profileGet')return structuredClone(args.personId===id?window.__profile:window.__otherProfile);
   if(method==='profileCapabilities')return Object.fromEntries(['dy','sph','xhs'].map(p=>[p,{available:false,reason:'账号资料读取待实机验收'}]));
   if(method==='aiSettingsGet')return window.__providers||(window.__providers=['openai','claude','deepseek'].map(id=>({id,label:id==='claude'?'Claude':id==='openai'?'OpenAI':'DeepSeek',protocol:id==='claude'?'anthropic':'openai',baseURL:'https://fixture.example/v1',model:'',hasKey:false,configured:false})));
   if(method==='aiSettingsSave'){const value={...window.__providers.find(p=>p.id===args.id),baseURL:args.baseURL,model:args.model,hasKey:!!args.apiKey,configured:!!args.apiKey};window.__providers=window.__providers.map(p=>p.id===args.id?value:p);return value;}
   if(method==='profileSave'){const key=args.personId===id?'__profile':'__otherProfile';window[key]={...window[key],...args,revision:window[key].revision+1};delete window[key].expectedRevision;return structuredClone(window[key]);}
   if(method==='profilePreview'&&['business','offering','goal'].some(key=>!window.__profile.manual[key].trim()))throw Error('请填写必填基础信息');
   if(method==='profilePreview')return {materials:{mode:window.__profile.mode,manual:window.__profile.manual,targetPlatforms:window.__profile.targetPlatforms,accounts:[]},sourceDigest:'fixture-source',revision:window.__profile.revision,bindingsDigest:'empty-bindings'};
   if(method==='profileConfirm'){window.__profile={...window.__profile,revision:window.__profile.revision+1,confirmed:{requestId:args.requestId,result:args.result,manual:{...window.__profile.manual}}};return structuredClone(window.__profile);}
   if(method==='setUnsaved')return {ok:true};return invoke(method,args);
  };
  window.__otherProfile={...structuredClone(window.__profile),personId:'89bc72c7-5dd7-4d02-a144-eb4034851a12',manual:{business:'乙的业务',offering:'乙的服务',goal:'乙的目标',audience:'',resources:''}};
  window.__emit({type:'snapshot',data:{people:[{id,name:'尚无账号的客户',revision:1,bindings:{}},{id:window.__otherProfile.personId,name:'乙',revision:1,bindings:{}}],jobs:[],accounts:[],health:{ok:true}}});
 },{candidate,delayCapabilities});await page.click('[data-view=accounts]');return page;
}
test('profile inputs work without bound accounts, keep both source forms, and never analyze on save',async()=>{
 const page=await profilePage();try{await page.waitForSelector('#profile-business',{timeout:1000});
  for(const [id,text] of [['business','摄影'],['offering','摄影服务'],['goal','建立专业形象']])await page.type('#profile-'+id,text);
  await page.click('[data-profile-source=accounts]');assert.match(await page.$eval('#profiles-panel',e=>e.textContent),/尚未绑定/);await page.click('[data-profile-source=manual]');assert.equal(await page.$eval('#profile-business',e=>e.value),'摄影');
  await page.click('#profile-save');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='profileSave'));await page.click('#profile-preview');await page.waitForSelector('#profile-materials');
  assert.equal(await page.$eval('#profile-analyze',e=>e.disabled),true);assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='profileAnalyze')),false);assert.match(await page.$eval('#profiles-panel',e=>e.textContent),/配置.*AI|AI.*配置/);
 }finally{await page.close();}
});
test('a generated profile is editable and only an explicit confirmation adopts it',async()=>{
 const page=await profilePage({candidate:true});try{await page.waitForSelector('#profile-result-style',{timeout:1000});assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='profileConfirm')),false);await page.$eval('#profile-result-style',e=>{e.value='人工修改的风格';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('#profile-confirm');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='profileConfirm'));assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='profileConfirm').args.result.style),'人工修改的风格');}finally{await page.close();}
});
test('three provider settings are visible, and saving clears the password field without triggering a request',async()=>{
 const page=await profilePage();try{await page.click('[data-view=system]');await page.waitForSelector('#ai-openai-model',{timeout:1000});for(const name of ['openai','claude','deepseek'])assert.ok(await page.$('#ai-'+name+'-model'));await page.type('#ai-openai-model','合成模型');await page.type('#ai-openai-key','synthetic-key-only');await page.click('[data-ai-save=openai]');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='aiSettingsSave'));await page.waitForFunction(()=>document.querySelector('#ai-openai-key').value==='');assert.equal(await page.$eval('#main',e=>e.textContent.includes('synthetic-key-only')),false);assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='profileAnalyze')),false);}finally{await page.close();}
});
test('unsaved profile edits remain when navigation is declined',async()=>{
 const page=await profilePage();try{await page.waitForSelector('#profile-business',{timeout:1000});await page.type('#profile-business','未保存资料');await page.evaluate(()=>window.confirm=()=>false);await page.click('[data-view=tasks]');assert.ok(await page.$('#profile-business'));assert.equal(await page.$eval('#profile-business',e=>e.value),'未保存资料');}finally{await page.close();}
});
test('editing the underlying inputs cannot adopt a candidate for the old material',async()=>{
 const page=await profilePage({candidate:true});try{await page.waitForSelector('#profile-business');await page.type('#profile-business','新的业务信息');await page.click('#profile-confirm');assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='profileConfirm')),false);assert.equal(await page.$eval('#profile-business',e=>e.value),'新的业务信息');}finally{await page.close();}
});
test('saving one AI provider preserves other unsaved provider fields',async()=>{
 const page=await profilePage();try{await page.click('[data-view=system]');await page.waitForSelector('#ai-openai-model');await page.type('#ai-deepseek-model','尚未保存的DeepSeek模型');await page.type('#ai-deepseek-key','synthetic-unsaved');await page.type('#ai-openai-model','合成模型');await page.type('#ai-openai-key','synthetic-only');await page.click('[data-ai-save=openai]');await page.waitForFunction(()=>document.querySelector('#ai-openai-key').value==='');assert.equal(await page.$eval('#ai-deepseek-model',e=>e.value),'尚未保存的DeepSeek模型');assert.equal(await page.$eval('#ai-deepseek-key',e=>e.value),'synthetic-unsaved');}finally{await page.close();}
});
test('a newly saved provider becomes selectable when returning to the profile',async()=>{
 const page=await profilePage();try{await page.waitForSelector('#profile-business');await page.click('[data-view=system]');await page.waitForSelector('#ai-openai-model');await page.type('#ai-openai-model','合成模型');await page.type('#ai-openai-key','synthetic-only');await page.click('[data-ai-save=openai]');await page.waitForFunction(()=>document.querySelector('#ai-openai-key').value==='');await page.click('[data-view=accounts]');await page.waitForSelector('#profile-provider');assert.equal(await page.$eval('#profile-provider option[value=openai]',e=>e.disabled),false);}finally{await page.close();}
});

for(const action of ['switch','reload'])test(`discarding profile edits on ${action} redraws the loaded person and never saves old text`,async()=>{
 const page=await profilePage();try{
  await page.waitForSelector('#profile-business');await page.type('#profile-business','甲的未保存文字');
  await page.evaluate(()=>{window.confirm=()=>true;window.__profile.manual={business:'甲的已存业务',offering:'甲服务',goal:'甲目标',audience:'',resources:''};});
  if(action==='switch')await page.select('#profile-person','89bc72c7-5dd7-4d02-a144-eb4034851a12');else await page.click('#profile-reload');
  await page.waitForFunction(()=>window.__calls.filter(c=>c.method==='profileGet').length>=2);
  assert.equal(await page.$eval('#profile-business',e=>e.value),action==='switch'?'乙的业务':'甲的已存业务');
  await page.$eval('#profile-business',e=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);});await page.type('#profile-business','补充');await page.click('#profile-save');await page.waitForFunction(()=>window.__calls.some(c=>c.method==='profileSave'));
  const saved=await page.evaluate(()=>window.__calls.find(c=>c.method==='profileSave').args);assert.equal(saved.manual.business,action==='switch'?'乙的业务补充':'甲的已存业务补充');assert.equal(saved.personId,action==='switch'?'89bc72c7-5dd7-4d02-a144-eb4034851a12':'897c72c7-5dd7-4d02-a144-eb4034851a11');
 }finally{await page.close();}
});
test('partial manual drafts can save without AI while incomplete preview explains missing fields',async()=>{
 const page=await profilePage();try{
  await page.waitForSelector('#profile-business');await page.type('#profile-business','只填写业务');await page.click('#profile-save');
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='profileSave').length),1);
  await page.click('#profile-preview');await page.waitForFunction(()=>document.querySelector('#profiles-panel [role=status]')?.textContent.includes('必填'));
  assert.equal(await page.$eval('#profile-business',e=>e.value),'只填写业务');assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='profileAnalyze')),false);
 }finally{await page.close();}
});
for(const [method,button,input] of [['profileSave','#profile-save','#profile-business'],['profileConfirm','#profile-confirm','#profile-result-style']])test(`${method} disables edits immediately and blocks leaving until the cloned IPC reply arrives`,async()=>{
 const page=await profilePage({candidate:true});try{
  await page.waitForSelector(input);await page.evaluate(method=>{window.__delayMethod=method;window.confirm=()=>true;},method);
  if(method==='profileSave')for(const id of ['business','offering','goal'])await page.type('#profile-'+id,'保存前内容');
  await page.click(button);await page.waitForFunction(()=>!!window.__finishRequest);
  assert.equal(await page.$eval(input,e=>e.disabled),true);assert.equal(await page.$eval('#profile-person',e=>e.disabled),true);assert.equal(await page.$eval('#profile-reload',e=>e.disabled),true);
  await page.click('[data-view=tasks]');assert.ok(await page.$(input));
  await page.evaluate(()=>window.__finishRequest());await page.waitForFunction(input=>!document.querySelector(input)?.disabled,{},input);
  await page.type(input,'保存后的新编辑');assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='setUnsaved').at(-1).args.hasChanges),true);
  assert.ok((await page.$eval(input,e=>e.value)).includes('保存后的新编辑'));
 }finally{await page.close();}
});
test('AI configuration save disables editing and navigation until its cloned reply while keeping other drafts',async()=>{
 const page=await profilePage();try{
  await page.click('[data-view=system]');await page.waitForSelector('#ai-openai-model');await page.type('#ai-openai-model','model-before');await page.type('#ai-openai-key','synthetic-before');await page.type('#ai-deepseek-model','other-draft');
  await page.evaluate(()=>{window.__delayMethod='aiSettingsSave';window.confirm=()=>true;});await page.click('[data-ai-save=openai]');await page.waitForFunction(()=>!!window.__finishRequest);
  assert.equal(await page.$eval('#ai-openai-model',e=>e.disabled),true);assert.equal(await page.$eval('#ai-openai-key',e=>e.disabled),true);
  await page.click('[data-view=accounts]');assert.ok(await page.$('#ai-openai-model'));
  await page.evaluate(()=>window.__finishRequest());await page.waitForFunction(()=>!document.querySelector('#ai-openai-model').disabled);
  assert.equal(await page.$eval('#ai-openai-key',e=>e.value),'');assert.equal(await page.$eval('#ai-deepseek-model',e=>e.value),'other-draft');
  await page.type('#ai-openai-model','-after');await page.type('#ai-openai-key','synthetic-after');assert.equal(await page.$eval('#ai-openai-model',e=>e.value),'model-before-after');assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='setUnsaved').at(-1).args.hasChanges),true);
  const call=await page.evaluate(()=>window.__calls.find(c=>c.method==='aiSettingsSave').args);assert.equal(call.model,'model-before');assert.equal(call.apiKey,'synthetic-before');
 }finally{await page.close();}
});
test('profile configuration shortcut brings the AI settings heading into view',async()=>{
 const page=await profilePage();try{
  await page.waitForSelector('#profile-settings');await page.evaluate(()=>window.__emit({type:'snapshot',data:{people:[{id:window.__profile.personId,name:'尚无账号的客户',revision:1,bindings:{}},{id:window.__otherProfile.personId,name:'乙',revision:1,bindings:{}}],jobs:[],accounts:[],health:{ok:true,checks:Array.from({length:15},(_,i)=>({name:'合成检查 '+i,ok:true,message:'合成检查通过'}))}}}));
  await page.click('#profile-settings');await page.waitForSelector('#ai-openai-model');const bounds=await page.$eval('#ai-settings-panel h2',el=>{const rect=el.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:window.innerHeight};});assert.ok(bounds.top>=0&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
 }finally{await page.close();}
});

test('任务记录可按操作日期筛选并查看可恢复删除的回收站',async()=>{
 const page=await pageFixture();try{
  const id='cd43d70b-abbc-47fd-bcfe-e1586e920581';
  await page.evaluate(id=>window.__emit({type:'snapshot',data:{people:[],accounts:[],jobs:[{id,title:'已执行的合成任务',state:'confirmed',statusLabel:'已发布',phone:'合成',platform:'dy',mode:'publish',visibility:'private',createdAt:new Date(2026,10,2).getTime(),checkedAt:new Date(2026,10,3,14).getTime(),canExecute:false}],trash:[{id:'b68b81ca-c22e-4500-8b0a-b908702ec026',title:'回收的合成任务',state:'confirmed',statusLabel:'已发布',platform:'dy',mode:'publish',visibility:'private',trashedAt:1,canExecute:false,canVerify:false}]}}),id);
  await page.click('[data-view=tasks]');assert.ok(await page.$('#task-from'));assert.ok(await page.$('[data-trash-task]'));
  await page.$eval('#task-from',e=>{e.value='2026-11-04';e.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(await page.$eval('#task-list',e=>e.textContent),/没有找到/);
  await page.$eval('#task-from',e=>{e.value='2026-11-03';e.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(await page.$eval('#task-list',e=>e.textContent),/已执行的合成任务/);
  await page.click('[data-task-scope=trash]');assert.ok(await page.$('[data-restore-task]'));assert.equal(await page.$('[data-execute]'),null);assert.equal(await page.$('[data-verify]'),null);
 }finally{await page.close();}
});
test('回查结束自动打开持久报告，作品创建与可见范围未知分别展示',async()=>{
 const page=await pageFixture();try{
  await page.evaluate(()=>{const id='cd43d70b-abbc-47fd-bcfe-e1586e920581';const job={id,title:'核验合成',platform:'dy',phone:'合成',mode:'publish',visibility:'public',state:'unknown',statusLabel:'待核实',canVerify:true,verificationReports:[{id:'report',checkedAt:Date.now(),summary:'部分证据不足',outcome:'unknown',checks:[{key:'creation',label:'作品创建',status:'confirmed',detail:'已确认'},{key:'visibility',label:'可见范围',status:'unknown',detail:'未知'},{key:'moderation',label:'平台审核',status:'unknown',detail:'未知'}],nextSteps:['请勿重复提交']}]};const original=window.contentOps.invoke;window.contentOps.invoke=(method,args)=>method==='getJob'?Promise.resolve(job):original(method,args);window.__emit({type:'activity',activity:{id:'verification',jobId:id,kind:'verify',status:'running',startedAt:Date.now()}});window.__emit({type:'activity',activity:{id:'verification',jobId:id,kind:'verify',status:'completed',message:'已回查'},job});});
  await page.waitForFunction(()=>document.querySelector('#task-dialog').open&&document.querySelector('#task-dialog').textContent.includes('回查报告'));
  assert.match(await page.$eval('#task-dialog',e=>e.textContent),/作品创建.*已确认/);assert.match(await page.$eval('#task-dialog',e=>e.textContent),/可见范围.*未知/);assert.match(await page.$eval('#task-dialog',e=>e.textContent),/请勿重复提交/);
 }finally{await page.close();}
});

test('工作台内可直接编辑人员绑定，保存期间禁用重复提交且保留视频表单',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-view=workspace]');assert.ok(await page.$('[data-action=bindings]'));await page.click('[data-action=bindings]');await page.waitForFunction(()=>document.querySelector('#bindings-dialog').open);
  await page.evaluate(()=>{const original=window.contentOps.invoke;window.contentOps.invoke=(method,args)=>method==='peopleSave'?new Promise(resolve=>{window.__calls.push({method,args});window.__finishBinding=()=>resolve({...args.person,id:args.person.id||'897c72c7-5dd7-4d02-a144-eb4034851a11',revision:2});}):original(method,args);});
  await page.click('#bindings-dialog #save-person');await page.waitForFunction(()=>!!window.__finishBinding);assert.equal(await page.$eval('#bindings-dialog #save-person',e=>e.disabled),true);assert.match(await page.$eval('#bindings-dialog #save-person',e=>e.textContent),/保存/);
  await page.evaluate(()=>window.__finishBinding());await page.waitForFunction(()=>!document.querySelector('#bindings-dialog').open);assert.ok(await page.$('#choose-video'));assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='peopleSave').length),1);
 }finally{await page.close();}
});
test('画像能力检查再慢也不阻塞基础资料或离开账号页面',async()=>{
 const page=await profilePage({delayCapabilities:true});try{
  await page.waitForSelector('#profile-business',{timeout:800});assert.equal(await page.$eval('#profile-business',e=>e.disabled),false);await page.type('#profile-business','保留输入');
  await page.evaluate(()=>window.__finishRequest());await page.waitForFunction(()=>document.querySelector('#profile-business')?.value==='保留输入');assert.equal(await page.$eval('#profile-business',e=>e.value),'保留输入');
 }finally{await page.close();}
});

test('拖入视频只选择素材，准备过程中更换视频使旧准备失效',async()=>{
 const page=await pageFixture();try{
  await page.evaluate(()=>window.__emit({type:'videoSelected',video:{path:'/fixtures/drop.mp4',name:'拖入视频.mp4',size:100}}));assert.match(await page.$eval('#choose-video',e=>e.textContent),/拖入视频.mp4/);assert.equal(await page.evaluate(()=>window.__calls.some(c=>['prepare','execute'].includes(c.method))),false);
  await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);await page.evaluate(()=>{window.__emit({type:'videoSelected',video:{path:'/fixtures/new.mp4',name:'更换视频.mp4',size:120}});window.__finishPrepare();});await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled);assert.match(await page.$eval('#primary-action',e=>e.textContent),/准备任务/);
 }finally{await page.close();}
});

test('抖音直接选择草稿、私密或公开，仍先准备且切换范围使旧任务失效',async()=>{
 const page=await pageFixture();try{
  assert.ok(await page.$('[data-mode=publish][data-visibility=private]'));assert.ok(await page.$('[data-mode=publish][data-visibility=public]'));
  await page.click('#choose-video');await page.click('[data-mode=publish][data-visibility=private]');assert.equal(await page.$eval('#visibility',e=>e.value),'private');await page.click('#primary-action');await page.waitForFunction(()=>!!window.__finishPrepare);assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.method==='prepare').args.input.mode),'publish');
  await page.click('[data-mode=publish][data-visibility=public]');await page.evaluate(()=>window.__finishPrepare());await page.waitForFunction(()=>!document.querySelector('#primary-action').disabled);assert.match(await page.$eval('#primary-action',e=>e.textContent),/准备任务/);assert.equal(await page.$eval('#visibility',e=>e.value),'public');assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.method==='execute')),false);
 }finally{await page.close();}
});
test('多平台草稿明确提示发布入口，同平台多账号保留登录的说明可见',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-flow=people]');assert.match(await page.$eval('#main',e=>e.textContent),/私密.*公开|公开.*私密/);assert.equal(await page.$('[data-mode=publish]'),null);
  await page.click('[data-view=accounts]');assert.match(await page.$eval('.login-panel',e=>e.textContent),/同平台.*多个账号/);
 }finally{await page.close();}
});

test('绑定草稿和保存状态跨后台刷新保留，不能在等待中再次编辑或提交',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-view=accounts]');await page.type('#person-name','新绑定草稿');const before=await page.$eval('#person-name',e=>e.value);
  await page.evaluate(()=>window.__emit({type:'snapshot',data:{people:[],accounts:[],jobs:[],health:{ok:true}}}));assert.equal(await page.$eval('#person-name',e=>e.value),before);
  await page.evaluate(()=>{const original=window.contentOps.invoke;window.contentOps.invoke=(method,args)=>method==='peopleSave'?new Promise(resolve=>window.__finishBinding=()=>resolve({...args.person,id:'897c72c7-5dd7-4d02-a144-eb4034851a11',revision:1})):original(method,args);});await page.click('#save-person');await page.waitForFunction(()=>!!window.__finishBinding);
  await page.evaluate(()=>{window.__emit({type:'activity',activity:{id:'refresh',kind:'refresh',status:'running',startedAt:Date.now()}});window.__emit({type:'snapshot',data:{people:[],accounts:[],jobs:[],health:{ok:true}}});});assert.equal(await page.$eval('#person-name',e=>e.value),before);assert.equal(await page.$eval('#person-name',e=>e.disabled),true);assert.equal(await page.$eval('#save-person',e=>e.disabled),true);await page.evaluate(()=>window.__finishBinding());
 }finally{await page.close();}
});
test('未完成的原生日期输入显示错误，不能静默清除筛选',async()=>{
 const page=await pageFixture();try{await page.click('[data-view=tasks]');await page.$eval('#task-from',e=>{Object.defineProperty(e,'validity',{get:()=>({badInput:true,valid:false})});e.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(await page.$eval('#task-list',e=>e.textContent),/日期.*完整|日期.*无效/);}finally{await page.close();}
});

test('较晚到达的旧刷新不能覆盖已保存的人员修订',async()=>{
 const page=await peoplePage();try{
  await page.click('[data-view=accounts]');await page.evaluate(()=>{const id='897c72c7-5dd7-4d02-a144-eb4034851a11';window.__emit({type:'peopleUpdated',people:[{id,name:'已保存的新名字',revision:3,bindings:{}}]});window.__emit({type:'snapshot',data:{people:[{id,name:'旧刷新名字',revision:1,bindings:{}}],accounts:[],jobs:[]}});});assert.match(await page.$eval('#people-editor',e=>e.textContent),/已保存的新名字/);assert.doesNotMatch(await page.$eval('#people-editor',e=>e.textContent),/旧刷新名字/);
 }finally{await page.close();}
});

test('installed startup check rejects a loaded blank renderer and confirms a working UI and preload bridge',async()=>{
 const {rendererReady}=require('../desktop/installed-check.cjs');
 const blank=await browser.newPage();try{await blank.setContent('<html><body>loaded but broken</body></html>');assert.equal(await rendererReady({executeJavaScript:script=>blank.evaluate(script)},{timeoutMs:40}),false);}finally{await blank.close();}
 const page=await pageFixture();try{assert.equal(await rendererReady({executeJavaScript:script=>page.evaluate(script)},{timeoutMs:1000}),true);}finally{await page.close();}
});
