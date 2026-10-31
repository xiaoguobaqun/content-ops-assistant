import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const uuid='e7352393-0cae-5025-be7f-3a732201a507';
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
test('same account name on sph is isolated and login success requires that platform',async t=>{
  const {root}=await fixture(t);const {createAccountStore}=await import('../src/accounts.mjs');const documentsDir=path.join(root,'documents');const store=createAccountStore({root,documentsDir});
  const dy=await store.register('品牌-A','dy');const sph=await store.register('品牌-A','sph');assert.equal(sph.pt,'视频号');assert.notEqual(dy.partition,sph.partition);
  await assert.rejects(store.checkName('品牌-B','sph'),/名称|登录|分区/);
  const {createDesktopService}=await api();let options;const service=createDesktopService({root,documentsDir,engine:{login:async(phone,value)=>{options=value;},accounts:async()=>[{phone:'品牌-A',pt:'抖音',loggedIn:true}]}});
  await service.handle('login',{phone:'品牌-A',platform:'sph'});await service.waitForIdle();assert.equal(options.platform,'sph');assert.equal(service.activity.status,'failed');
});

test('xhs account connection and preparation preserve a closed execution gate',async t=>{
  const {root}=await fixture(t);const documentsDir=path.join(root,'Documents');const {createDesktopService}=await api();let prepared=false;
  const service=createDesktopService({root,documentsDir,engine:{login:async()=>{},accounts:async()=>[{phone:'小红书示例',pt:'小红书',loggedIn:true}]},prepare:async input=>{prepared=true;return {id:'prepared-xhs',input,files:{},state:'prepared'};}});
  await service.handle('login',{platform:'xhs',phone:'小红书示例'});await service.waitForIdle();assert.equal(service.activity.status,'completed');
  const files=await fs.readdir(path.join(documentsDir,'MatrixMedia/data/account'));const rows=JSON.parse(await fs.readFile(path.join(documentsDir,'MatrixMedia/data/account',files[0]),'utf8'));assert.equal(rows[0].partition,'persist:小红书示例小红书');assert.equal(rows[0].useRealBrowser,false);
  const job=await service.handle('prepare',{input:{platform:'xhs',phone:'小红书示例',video:'/tmp/a.mov',title:'标题',mode:'draft',visibility:'unknown'}});assert.equal(prepared,true);assert.equal(job.canExecute,false);
});

test('an old xhs record pointing to another partition blocks login before any engine action',async t=>{
  const {root}=await fixture(t),documentsDir=path.join(root,'Documents'),dir=path.join(documentsDir,'MatrixMedia/data/account');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'old.json'),JSON.stringify([{phone:'品牌A',pt:'小红书',partition:'persist:品牌B小红书'}]));const {createDesktopService}=await api();let called=false;const service=createDesktopService({root,documentsDir,engine:{login:async()=>{called=true;}}});
  await assert.rejects(service.handle('login',{platform:'xhs',phone:'品牌A'}),/分区|账号记录/);assert.equal(called,false);
});
