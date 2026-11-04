import {mediaTool} from '../src/runtime-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createDesktopService} from '../desktop/service-core.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {createAccountRemoval} from '../engine/MatrixMedia/src/main/services/accountRemoval.js';
const require=createRequire(import.meta.url);
const id='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222',historyId='33333333-3333-4333-8333-333333333333';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-remove-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const documentsDir=path.join(root,'documents');
  const store=createAccountStore({root,documentsDir});await store.register('合成账号','dy');await store.register('合成账号','sph');const calls=[];
  const accountsDir=path.join(documentsDir,'MatrixMedia/data/account');
  const native=createAccountRemoval({accountsDir,backupDir:path.join(root,'backup'),sessionForPartition:partition=>({clearStorageData:async()=>calls.push(partition),clearAuthCache:async()=>{},cookies:{flushStore:async()=>{},get:async()=>[]}})});
  const engine={accounts:async()=>{const rows=[];for(const file of await fs.readdir(accountsDir))if(file.endsWith('.json'))rows.push(...JSON.parse(await fs.readFile(path.join(accountsDir,file),'utf8')));return rows.map(r=>({...r,loggedIn:true}));},accountRemoval:async(phone,platform,options)=>options.preview?native.preview({phone,platform}):native.remove({phone,platform,expectedDigest:options.expectedDigest})};
  const service=createDesktopService({root,documentsDir,engine,doctor:async()=>({ok:true,checks:[]})});await service.handle('refresh');await service.waitForIdle();
  for(const [jobId,platform,state,startedAt] of [[id,'dy','prepared',undefined],[otherId,'sph','prepared',undefined],[historyId,'dy','unknown',123]]){
    const dir=path.join(root,'jobs',jobId);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({id:jobId,state,startedAt,createdAt:1,inputDigest:'old',input:{platform,phone:'合成账号',title:'合成任务',mode:'draft',visibility:platform==='dy'?'private':'unknown'},files:{video:{path:'/tmp/synthetic.mp4'},cover:{path:'/tmp/synthetic.jpg'}}}));
  }
  return {root,service,store,engine,calls};
}
test('移除精确账号并作废未开始任务，保留同名其他平台和历史记录，同名重加不恢复旧任务',async t=>{
  const f=await fixture(t),selection={platform:'dy',phone:'合成账号'},preview=await f.service.handle('accountRemovalPreview',selection);
  await f.service.handle('removeAccount',{...selection,expectedDigest:preview.digest});await f.service.waitForIdle();assert.equal(f.service.activity.status,'completed');assert.deepEqual(f.calls,['persist:合成账号抖音']);
  const data=await f.service.handle('dashboard');assert.deepEqual(data.accounts.map(a=>a.pt),['视频号']);
  const removed=data.jobs.find(j=>j.id===id);assert.equal(removed.state,'invalidated');assert.equal(removed.canExecute,false);assert.equal(removed.canVerify,false);assert.equal(data.jobs.find(j=>j.id===otherId).state,'prepared');assert.equal(data.jobs.find(j=>j.id===historyId).state,'unknown');
  await f.store.register('合成账号','dy');await assert.rejects(f.service.handle('execute',{id,expectedDigest:'old'}),/作废|移除|已执行/);
  const {runJob}=await import('../src/jobs.mjs');assert.equal((await runJob(id,{root:f.root,engine:{publish:()=>assert.fail('作废任务不得重发')}})).state,'invalidated');
  const file=path.join(f.root,'jobs',id,'job.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.state='prepared';await fs.writeFile(file,JSON.stringify(record));
  assert.equal((await f.service.handle('getJob',{id})).canExecute,false);
  await assert.rejects(runJob(id,{root:f.root,engine:{publish:()=>assert.fail('账号版本变化后不得重发')}}),/移除|作废/);
});
test('损坏的账号版本记录不得覆盖或继续退出登录',async t=>{
  const f=await fixture(t),selection={platform:'dy',phone:'合成账号'},preview=await f.service.handle('accountRemovalPreview',selection),file=path.join(f.root,'account-generations.json');
  await fs.writeFile(file,'damaged');await f.service.handle('removeAccount',{...selection,expectedDigest:preview.digest});await f.service.waitForIdle();assert.equal(f.service.activity.status,'failed');assert.equal(f.calls.length,0);assert.equal(await fs.readFile(file,'utf8'),'damaged');
});
test('Mac目录信息和非任务文件不会阻止账号移除，也不会被删除',async t=>{
  const f=await fixture(t),jobs=path.join(f.root,'jobs');await fs.writeFile(path.join(jobs,'.DS_Store'),'finder');await fs.writeFile(path.join(jobs,'notes.txt'),'keep');await fs.mkdir(path.join(jobs,'other-directory'));
  const selection={platform:'dy',phone:'合成账号'},preview=await f.service.handle('accountRemovalPreview',selection);await f.service.handle('removeAccount',{...selection,expectedDigest:preview.digest});await f.service.waitForIdle();
  assert.equal(f.service.activity.status,'completed',f.service.activity.message);assert.deepEqual(f.calls,['persist:合成账号抖音']);assert.equal(await fs.readFile(path.join(jobs,'.DS_Store'),'utf8'),'finder');assert.equal(await fs.readFile(path.join(jobs,'notes.txt'),'utf8'),'keep');
});
test('人员绑定和过期确认在退出或任务作废之前拦截',async t=>{
  const f=await fixture(t),selection={platform:'dy',phone:'合成账号'};
  const person=await f.service.handle('peopleSave',{person:{name:'合成人员',bindings:{dy:selection}}});
  await assert.rejects(f.service.handle('accountRemovalPreview',selection),/人员|绑定/);assert.equal(f.calls.length,0);
  await f.service.handle('peopleSave',{person:{...person,expectedRevision:person.revision,bindings:{}}});
  await f.service.handle('removeAccount',{...selection,expectedDigest:'sha256:'+'0'.repeat(64)});await f.service.waitForIdle();assert.equal(f.service.activity.status,'failed');assert.match(f.service.activity.message,/变化/);assert.equal(f.calls.length,0);assert.equal((await f.service.handle('getJob',{id})).state,'prepared');
});
test('已有后台活动时不能预览或移除账号',async t=>{
  const f=await fixture(t);let release;f.engine.accounts=()=>new Promise(r=>release=r);await f.service.handle('refresh');await new Promise(r=>setImmediate(r));
  try{await assert.rejects(f.service.handle('accountRemovalPreview',{platform:'dy',phone:'合成账号'}),/正在/);await assert.rejects(f.service.handle('removeAccount',{platform:'dy',phone:'合成账号'}),/正在/);}finally{release([]);await f.service.waitForIdle();}
});
test('单任务正在准备时也占用后台，移除不能漏掉晚落盘的任务',async t=>{
  const f=await fixture(t);let release,entered;const gate=new Promise(r=>release=r),began=new Promise(r=>entered=r);
  const service=createDesktopService({root:f.root,engine:f.engine,prepare:async()=>{entered();await gate;return {id,input:{platform:'dy',phone:'合成账号'},files:{},state:'prepared'};}});
  const preparing=service.handle('prepare',{input:{platform:'dy',phone:'合成账号',video:'/tmp/synthetic.mp4',title:'合成任务',mode:'draft',visibility:'private'}});await began;
  try{await assert.rejects(service.handle('accountRemovalPreview',{platform:'dy',phone:'合成账号'}),/正在/);}finally{release();await preparing;}
});
test('另一个进程准备旧账号任务时，移除后禁止迟到的准备结果落盘',async t=>{
  const f=await fixture(t),video=path.join(f.root,'synthetic.mp4'),bin=path.join(f.root,'bin');await fs.mkdir(bin);
  assert.equal(spawnSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);
  const probeGate=path.join(bin,process.platform==='win32'?'ffprobe.exe':'ffprobe');
  if(process.platform==='win32'){
    const source=path.join(bin,'gate.cs');
    await fs.writeFile(source,String.raw`using System;using System.IO;using System.Diagnostics;using System.Threading;class Gate{static string Q(string v){return ((char)34)+v+((char)34);}static int Main(string[] args){string dir=Environment.GetEnvironmentVariable("CONTENT_OPS_TEST_GATE");File.WriteAllText(Path.Combine(dir,"ready"),"ready");while(!File.Exists(Path.Combine(dir,"release")))Thread.Sleep(20);var quoted=Array.ConvertAll(args,Q);var p=Process.Start(new ProcessStartInfo(Environment.GetEnvironmentVariable("CONTENT_OPS_REAL_FFPROBE"),string.Join(" ",quoted)){UseShellExecute=false});p.WaitForExit();return p.ExitCode;}}`);
    const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const build=spawnSync(compiler,['/nologo','/target:exe','/out:'+probeGate,source],{encoding:'utf8'});assert.equal(build.status,0,build.stdout+build.stderr);
  }else await fs.writeFile(probeGate,'#!/bin/sh\ntouch "$CONTENT_OPS_TEST_GATE/ready"\nwhile [ ! -f "$CONTENT_OPS_TEST_GATE/release" ]; do sleep 0.02; done\nexec "$CONTENT_OPS_REAL_FFPROBE" "$@"\n',{mode:0o700});
  const script=`import {prepareJob} from ${JSON.stringify(new URL('../src/jobs.mjs',import.meta.url).href)};try{await prepareJob({platform:'dy',phone:'合成账号',title:'迟到的准备',video:process.argv[2]},{root:process.argv[1]});console.log('prepared');}catch(e){console.log(e.message);process.exitCode=4;}`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,f.root,video],{env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,CONTENT_OPS_TEST_GATE:f.root,CONTENT_OPS_REAL_FFPROBE:process.env.CONTENT_OPS_FFPROBE||(process.platform==='darwin'?'/opt/homebrew/bin/ffprobe':'/usr/bin/ffprobe'),CONTENT_OPS_FFPROBE:probeGate},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();const ended=once(child,'close');
  try{
    let ready=false;for(let i=0;i<200;i++){try{await fs.access(path.join(f.root,'ready'));ready=true;break;}catch{await new Promise(r=>setTimeout(r,10));}}assert.equal(ready,true,'合成准备必须先进入素材检查');
    const selection={platform:'dy',phone:'合成账号'},preview=await f.service.handle('accountRemovalPreview',selection);await f.service.handle('removeAccount',{...selection,expectedDigest:preview.digest});await f.service.waitForIdle();assert.equal(f.service.activity.status,'completed');
    await fs.writeFile(path.join(f.root,'release'),'go');const [code]=await ended;assert.equal(code,4,output);assert.match(output,/账号.*变化|移除/);
    assert.equal((await f.service.handle('dashboard')).jobs.some(j=>j.title==='迟到的准备'),false);
  }finally{await fs.writeFile(path.join(f.root,'release'),'go');if(child.exitCode===null){child.kill('SIGTERM');await ended;}}
});
test('原生确认取消不执行移除，确认严格使用预览账号与摘要并阻止重复弹窗',async()=>{
  const {createAccountRemovalHandler}=require('../desktop/account-removal.cjs');const calls=[];let accepted=false,release;
  const handler=createAccountRemovalHandler({request:async(method,args)=>{calls.push({method,args});return method==='accountRemovalPreview'?{ok:true,platform:'dy',phone:'合成账号',digest:'sha256:'+'a'.repeat(64)}:{activity:{status:'running'}};},confirm:async()=>accepted});
  assert.equal((await handler({platform:'dy',phone:'合成账号'})).canceled,true);assert.equal(calls.length,1);
  accepted=true;await handler({platform:'dy',phone:'合成账号',expectedDigest:'forged'});assert.deepEqual(calls.at(-1).args,{platform:'dy',phone:'合成账号',expectedDigest:'sha256:'+'a'.repeat(64)});
  const waiting=createAccountRemovalHandler({request:async()=>({ok:true,platform:'dy',phone:'合成账号',digest:'sha256:'+'a'.repeat(64)}),confirm:()=>new Promise(r=>release=r)});
  const first=waiting({platform:'dy',phone:'合成账号'});await new Promise(r=>setImmediate(r));await assert.rejects(waiting({platform:'dy',phone:'合成账号'}),/确认|正在/);release(false);await first;
});
