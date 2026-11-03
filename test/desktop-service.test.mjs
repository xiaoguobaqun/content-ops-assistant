import {mediaTool} from '../src/runtime-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const uuid='cd43d70b-abbc-47fd-bcfe-e1586e920581';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const job={id:uuid,createdAt:1,state:'prepared',inputDigest:'hash-1',input:{phone:'账号A',title:'真实标题',description:'简介',mode:'draft',visibility:'private',creativeStatement:'none'},files:{video:{path:'/tmp/a.mov'},cover:{path:'/tmp/a.jpg'}}};
  const directory=path.join(root,'jobs',uuid);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'job.json'),JSON.stringify(job));
  return {root,job};
}
const api=()=>import('../desktop/service-core.mjs');
test('dashboard shows real persisted jobs with honest Chinese states',async t=>{
  const {root}=await fixture(t);const {createDesktopService}=await api();
  const service=createDesktopService({root,engine:{accounts:async()=>[]},doctor:async()=>({ok:true,checks:[]})});
  const data=await service.handle('dashboard',{});
  assert.equal(data.jobs[0].title,'真实标题');assert.equal(data.jobs[0].statusLabel,'待执行');assert.equal(data.jobs[0].mode,'draft');
  await assert.rejects(service.handle('getJob',{id:'../../secret'}),/任务编号/);
  await assert.rejects(service.handle('shell',{cmd:'echo unsafe'}),/不支持/);
});
test('execute validates the approved task fingerprint and prevents concurrent operations',async t=>{
  const {root,job}=await fixture(t);const {createDesktopService}=await api();let unblock,calls=0;const gate=new Promise(r=>unblock=r);const events=[];
  const service=createDesktopService({root,engine:{},onEvent:e=>events.push(e),run:async()=>{calls++;await gate;return {...job,state:'draft_confirmed'};}});
  await assert.rejects(service.handle('execute',{id:uuid,expectedDigest:'wrong'}),/变化|重新/);
  const started=await service.handle('execute',{id:uuid,expectedDigest:'hash-1'});assert.equal(started.activity.status,'running');
  try{await assert.rejects(service.handle('verify',{id:uuid}),/正在/);}finally{unblock();}
  await service.waitForIdle();assert.equal(calls,1);assert.ok(events.some(e=>e.activity?.status==='completed'));
});
test('an uncertain result stays unknown and cannot be represented as published',async t=>{
  const {root,job}=await fixture(t);const {createDesktopService}=await api();const events=[];
  const service=createDesktopService({root,engine:{},onEvent:e=>events.push(e),run:async()=>({...job,state:'unknown',message:'等待核实'})});
  await service.handle('execute',{id:uuid,expectedDigest:'hash-1'});await service.waitForIdle();
  const result=events.find(e=>e.job)?.job;assert.equal(result.state,'unknown');assert.equal(result.statusLabel,'待核实');
});
test('prepare rejects unsupported modes/visibility and invalid account before invoking engine',async t=>{
  const {root}=await fixture(t);const {createDesktopService}=await api();let called=false;
  const service=createDesktopService({root,engine:{},prepare:async()=>{called=true;}});
  for(const change of [{visibility:''},{mode:'auto'},{phone:''},{title:''}])await assert.rejects(service.handle('prepare',{input:{phone:'账号A',video:'/tmp/a.mov',title:'标题',mode:'draft',visibility:'private',...change}}));
  assert.equal(called,false);
});
test('an interrupted running record can be checked after reopening without being re-executed',async t=>{
  const {root,job}=await fixture(t);await fs.writeFile(path.join(root,'jobs',uuid,'job.json'),JSON.stringify({...job,state:'running',startedAt:1}));
  const {createDesktopService}=await api();const service=createDesktopService({root,engine:{}});const data=await service.handle('dashboard');assert.equal(data.jobs[0].canExecute,false);assert.equal(data.jobs[0].canVerify,true);
  assert.equal(data.jobs[0].state,'unknown');assert.equal(data.jobs[0].statusLabel,'待核实');assert.match(data.jobs[0].message,/中断|回查/);
});
test('a record with a forged ID is rejected rather than sent to the renderer',async t=>{
  const {root,job}=await fixture(t);await fs.writeFile(path.join(root,'jobs',uuid,'job.json'),JSON.stringify({...job,id:'\" onclick=\"unsafe'}));
  const {createDesktopService}=await api();const service=createDesktopService({root,engine:{}});const data=await service.handle('dashboard');assert.equal(data.jobs.length,0);assert.equal(data.warnings.length,1);
  await assert.rejects(service.handle('getJob',{id:uuid}),/记录/);
});
test('a first login registers metadata before reading the real account list and persists after reopening',async t=>{
  const {root}=await fixture(t);const documentsDir=path.join(root,'documents');const {createDesktopService}=await api();let loggedIn=false;
  const engine={login:async()=>{loggedIn=true;},accounts:async()=>{
    let files=[];try{files=await fs.readdir(path.join(documentsDir,'MatrixMedia/data/account'));}catch{}
    const rows=[];for(const file of files)if(file.endsWith('.json'))rows.push(...JSON.parse(await fs.readFile(path.join(documentsDir,'MatrixMedia/data/account',file),'utf8')));
    return rows.map(row=>({...row,loggedIn}));
  }};
  const service=createDesktopService({root,documentsDir,engine});await service.handle('login',{phone:'新账号'});await service.waitForIdle();
  assert.equal(service.activity.status,'completed');const data=await service.handle('dashboard');assert.equal(data.accounts.length,1);assert.equal(data.accounts[0].phone,'新账号');assert.equal(data.accounts[0].loggedIn,true);
  await service.handle('login',{phone:'新账号'});await service.waitForIdle();assert.equal((await engine.accounts()).length,1);
  const reopened=createDesktopService({root,documentsDir,engine});assert.equal((await reopened.handle('dashboard')).accounts[0].phone,'新账号');
});
test('new names cannot silently reuse another account session or an empty session key',async t=>{
  const {root}=await fixture(t);const documentsDir=path.join(root,'documents'),directory=path.join(documentsDir,'MatrixMedia/data/account');await fs.mkdir(directory,{recursive:true});
  const original=[{id:'keep',phone:'品牌-A',pt:'抖音',partition:'persist:历史记录抖音',defaultPublishToDraft:true,custom:'保留'}];await fs.writeFile(path.join(directory,'2026-10-29.json'),JSON.stringify(original));
  const {createDesktopService}=await api();let calls=0;const service=createDesktopService({root,documentsDir,engine:{login:async()=>calls++,accounts:async()=>[]}});
  await assert.rejects(service.handle('login',{phone:'品牌-B'}),/名称|登录|分区/);await assert.rejects(service.handle('login',{phone:'-新账号'}),/名称|登录|分区/);assert.equal(calls,0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'2026-10-29.json'),'utf8')),original);
});
test('login does not claim success when the account session cannot be read back',async t=>{
  const {root}=await fixture(t);const {createDesktopService}=await api();const service=createDesktopService({root,documentsDir:path.join(root,'documents'),engine:{login:async()=>{},accounts:async()=>[]}});
  await service.handle('login',{phone:'未确认账号'});await service.waitForIdle();assert.equal(service.activity.status,'failed');assert.match(service.activity.message,/登录|连接|确认/);
});
test('扫码后只确认本次平台账号，保留其他平台缓存且不等待无关网络检查',async t=>{
  const {root}=await fixture(t);const {createDesktopService}=await api();let loggingIn=false;const checks=[];
  const rows=[{phone:'抖音合成',pt:'抖音',loggedIn:false},{phone:'视频号合成',pt:'视频号',loggedIn:true}];
  const service=createDesktopService({root,documentsDir:path.join(root,'documents'),doctor:async()=>({ok:true}),engine:{login:async()=>{loggingIn=true;},accounts:async(phone,platform)=>{
    checks.push({phone,platform});if(!loggingIn)return rows;
    assert.equal(phone,'抖音合成','不应重新探测所有账号');assert.equal(platform,'dy');return [{phone,pt:'抖音',loggedIn:true}];
  }}});
  await service.handle('refresh');await service.waitForIdle();await service.handle('login',{phone:'抖音合成',platform:'dy'});await service.waitForIdle();
  assert.equal(service.activity.status,'completed',service.activity.message);const data=await service.handle('dashboard');assert.equal(data.accounts.length,2);assert.equal(data.accounts.find(a=>a.pt==='视频号').loggedIn,true);assert.equal(data.accounts.find(a=>a.pt==='抖音').loggedIn,true);assert.deepEqual(checks.at(-1),{phone:'抖音合成',platform:'dy'});
});
test('本次登录确认缺失时仅将目标标为待核实，不沿用已登录缓存冒充成功',async t=>{
  const {root}=await fixture(t);const {createDesktopService}=await api();let loggingIn=false;
  const service=createDesktopService({root,documentsDir:path.join(root,'documents'),doctor:async()=>({ok:true}),engine:{login:async()=>{loggingIn=true;},accounts:async()=>loggingIn?[]:[{phone:'合成账号',pt:'抖音',loggedIn:true},{phone:'另一个',pt:'小红书',loggedIn:true}]}});
  await service.handle('refresh');await service.waitForIdle();await service.handle('login',{phone:'合成账号',platform:'dy'});await service.waitForIdle();assert.equal(service.activity.status,'failed');
  const accounts=(await service.handle('dashboard')).accounts;assert.equal(accounts.find(a=>a.phone==='合成账号')?.loggedIn,null);assert.equal(accounts.find(a=>a.phone==='另一个')?.loggedIn,true);
});
test('same account name on sph is isolated and login success requires that platform',async t=>{
  const {root}=await fixture(t);const {createAccountStore}=await import('../src/accounts.mjs');const documentsDir=path.join(root,'documents');const store=createAccountStore({root,documentsDir});
  const dy=await store.register('品牌-A','dy');const sph=await store.register('品牌-A','sph');assert.equal(sph.pt,'视频号');assert.notEqual(dy.partition,sph.partition);
  await assert.rejects(store.checkName('品牌-B','sph'),/名称|登录|分区/);
  const {createDesktopService}=await api();let options;const service=createDesktopService({root,documentsDir,engine:{login:async(phone,value)=>{options=value;},accounts:async()=>[{phone:'品牌-A',pt:'抖音',loggedIn:true}]}});
  await service.handle('login',{phone:'品牌-A',platform:'sph'});await service.waitForIdle();assert.equal(options.platform,'sph');assert.equal(service.activity.status,'failed');
});

test('xhs account connection and preparation preserve a closed execution gate',async t=>{
  const {root}=await fixture(t);const documentsDir=path.join(root,'Documents');const {createDesktopService}=await api();let prepared=false;
  const service=createDesktopService({root,documentsDir,engine:{login:async()=>{},accounts:async()=>[{phone:'小红书测试',pt:'小红书',loggedIn:true}]},prepare:async input=>{prepared=true;return {id:'prepared-xhs',input,files:{},state:'prepared'};}});
  await service.handle('login',{platform:'xhs',phone:'小红书测试'});await service.waitForIdle();assert.equal(service.activity.status,'completed');
  const files=await fs.readdir(path.join(documentsDir,'MatrixMedia/data/account'));const rows=JSON.parse(await fs.readFile(path.join(documentsDir,'MatrixMedia/data/account',files[0]),'utf8'));assert.equal(rows[0].partition,'persist:小红书测试小红书');assert.equal(rows[0].useRealBrowser,false);
  const job=await service.handle('prepare',{input:{platform:'xhs',phone:'小红书测试',video:'/tmp/a.mov',title:'标题',mode:'draft',visibility:'unknown'}});assert.equal(prepared,true);assert.equal(job.canExecute,false);
});

test('an old xhs record pointing to another partition blocks login before any engine action',async t=>{
  const {root}=await fixture(t),documentsDir=path.join(root,'Documents'),dir=path.join(documentsDir,'MatrixMedia/data/account');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'old.json'),JSON.stringify([{phone:'品牌A',pt:'小红书',partition:'persist:品牌B小红书'}]));const {createDesktopService}=await api();let called=false;const service=createDesktopService({root,documentsDir,engine:{login:async()=>{called=true;}}});
  await assert.rejects(service.handle('login',{platform:'xhs',phone:'品牌A'}),/分区|账号记录/);assert.equal(called,false);
});

test('desktop people and batch requests show one parent, require exact fresh confirmation and preserve closed gates',async t=>{
 const {root}=await fixture(t);const video=path.join(root,'合成.mp4');assert.equal(spawnSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);
 const {createDesktopService}=await api();const accounts=['dy','sph','xhs'].map(platform=>({platform,phone:'本机示例',loggedIn:true}));const calls=[];
 const engine={accounts:async()=>accounts,publish:async job=>{calls.push(job.input.platform);return {resultStatus:'draft',draftEvidence:{ok:true}};},queryDraft:async job=>({ok:true,evidence:{ok:true,preserved:true,platform:job.input.platform,clientTaskId:job.id}})};
 const service=createDesktopService({root,engine,doctor:async()=>({ok:true})});await service.handle('refresh');await service.waitForIdle();
 const person=await service.handle('peopleSave',{person:{name:'人员示例',bindings:Object.fromEntries(accounts.map(a=>[a.platform,{platform:a.platform,phone:a.phone}]))}});
 const batch=await service.handle('prepareBatch',{input:{personId:person.id,platforms:['dy','sph','xhs'],title:'示例',video}});
 const data=await service.handle('dashboard');assert.equal(data.people.length,1);assert.equal(data.jobs.filter(j=>j.kind==='batch').length,1);assert.equal(data.jobs.length,2);
 await assert.rejects(service.handle('execute',{id:batch.jobs[0].id,expectedDigest:batch.jobs[0].inputDigest}),/批次/);
 await assert.rejects(service.handle('executeBatch',{id:batch.id,expectedDigest:'stale',expectedAttempt:0,targetIds:batch.targetIds}),/变化|确认/);
 await service.handle('executeBatch',{id:batch.id,expectedDigest:batch.digest,expectedAttempt:batch.attempt,targetIds:batch.targetIds});await service.waitForIdle();
 assert.deepEqual(calls,['dy','sph']);assert.equal((await service.handle('getBatch',{id:batch.id})).state,'partial');
});

test('preparing batches reserves the service and offline accounts block the entire execution before upload',async t=>{
 const {root}=await fixture(t);const {createDesktopService}=await api();let release;const gate=new Promise(r=>release=r);let invoked;const began=new Promise(r=>invoked=r);
 const accounts=[{platform:'dy',phone:'本机示例',loggedIn:true}];const {prepareJob}=await import('../src/jobs.mjs');
 const video=path.join(root,'合成.mp4');assert.equal(spawnSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);
 let uploads=0;const service=createDesktopService({root,engine:{accounts:async()=>accounts,publish:async()=>{uploads++;}},doctor:async()=>({ok:true}),prepare:async(...args)=>{invoked();await gate;return prepareJob(...args);}});
 await service.handle('refresh');await service.waitForIdle();const person=await service.handle('peopleSave',{person:{name:'人员示例',bindings:{dy:{platform:'dy',phone:'本机示例'}}}});
 const preparing=service.handle('prepareBatch',{input:{personId:person.id,platforms:['dy'],title:'测试',video}});await began;
 try{await assert.rejects(service.handle('peopleSave',{person:{name:'另一人',bindings:{}}}),/正在/);}finally{release();}
 const batch=await preparing;accounts[0].loggedIn=null;
 await service.handle('executeBatch',{id:batch.id,expectedDigest:batch.digest,expectedAttempt:batch.attempt,targetIds:batch.targetIds});await service.waitForIdle();
 assert.equal(uploads,0);assert.match((await service.handle('getBatch',{id:batch.id})).message,/连接状态/);
});

test('人员绑定只发送人员更新，不等待全量任务或后台刷新',async t=>{
 const {root}=await fixture(t),{createDesktopService}=await api();const events=[];let release;const waiting=new Promise(r=>release=r);
 const service=createDesktopService({root,onEvent:e=>events.push(e),doctor:async()=>({ok:true}),engine:{accounts:async()=>waiting}});await service.handle('refresh');
 try{const person=await service.handle('peopleSave',{person:{name:'即时人员',bindings:{}}});assert.equal(person.name,'即时人员');assert.ok(events.some(e=>e.type==='peopleUpdated'));assert.equal(events.some(e=>e.type==='snapshot'),false);}finally{release([]);await service.waitForIdle();}
});

test('同平台两个账号可分别连接并保留，连接副号不退出或覆盖主号',async t=>{
 const {root}=await fixture(t),documentsDir=path.join(root,'documents'),{createDesktopService}=await api();const logged=new Set(),calls=[];
 const engine={login:async(phone,options)=>{calls.push({phone,options});logged.add(phone);},accounts:async(phone)=>[...logged].filter(p=>!phone||p===phone).map(phone=>({phone,pt:'抖音',loggedIn:true}))};
 const service=createDesktopService({root,documentsDir,engine});for(const phone of ['合成主号','合成副号']){await service.handle('login',{phone,platform:'dy'});await service.waitForIdle();assert.equal(service.activity.status,'completed');}
 const accounts=(await service.handle('dashboard')).accounts;assert.deepEqual(accounts.map(a=>a.phone).sort(),['合成主号','合成副号'].sort());assert.equal(accounts.every(a=>a.loggedIn===true),true);assert.equal(calls.length,2);
 const {createAccountStore}=await import('../src/accounts.mjs'),store=createAccountStore({root,documentsDir});const a=await store.checkName('合成主号','dy'),b=await store.checkName('合成副号','dy');assert.notEqual(a.partition,b.partition);assert.equal((await store.checkName('合成主号','dy')).partition,a.partition);
});

test('installed diagnostics run in the configured worker and cannot overlap active operations',async t=>{
 const {root}=await fixture(t),{createDesktopService}=await api();let release;const gate=new Promise(r=>release=r);
 const health={ok:true,checks:[{name:'ffmpeg',ok:true},{name:'ffprobe',ok:true}]};
 const service=createDesktopService({root,doctor:async()=>health,engine:{accounts:async()=>gate,help:async()=>'publish --help'}});
 await service.handle('refresh');await assert.rejects(service.handle('runtimeCheck'),/正在/);release([]);await service.waitForIdle();
 assert.deepEqual(await service.handle('runtimeCheck'),{health,engineHelp:'publish --help'});
});
