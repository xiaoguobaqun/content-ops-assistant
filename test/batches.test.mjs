import {mediaTool} from '../src/runtime-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createPeopleStore} from '../src/people.mjs';
import {runJob,readJob,verifyJob} from '../src/jobs.mjs';
import {withCancellation} from '../src/cancellation.mjs';
async function fixture(t,{engine:extra={},prepare,onProgress}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'batch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const video=path.join(root,'合成.mp4');const r=spawnSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]);assert.equal(r.status,0);
 const accounts=['dy','sph','xhs'].map(platform=>({platform,phone:'账号甲',loggedIn:true}));const people=createPeopleStore({root});
 const person=await people.save({name:'人员甲',bindings:Object.fromEntries(accounts.map(a=>[a.platform,{platform:a.platform,phone:a.phone}]))},{accounts});const calls=[];
 const engine={accounts:async()=>accounts,publish:async job=>{calls.push(job.input.platform);return {resultStatus:'draft',draftEvidence:{ok:true}};},queryDraft:async job=>({ok:true,evidence:{ok:true,preserved:true,platform:job.input.platform,clientTaskId:job.id}}),...extra};
 const {createBatchStore}=await import('../src/batches.mjs');const store=createBatchStore({root,people,engine,prepare,onProgress});
 return {root,store,people,person,engine,accounts,calls,input:{personId:person.id,platforms:['dy','sph','xhs'],video,title:'合成验证',description:'离线测试'}};
}
const approval=view=>({expectedDigest:view.digest,expectedAttempt:view.attempt,targetIds:view.targetIds});
test('batch freezes exact targets, shares one cover, gates xhs and cannot execute a child directly',async t=>{
 const f=await fixture(t),batch=await f.store.prepare(f.input),view=await f.store.view(batch.id);
 assert.equal(view.jobs.length,3);assert.equal(new Set(view.jobs.map(j=>j.coverPath)).size,1);assert.equal(view.targetIds.length,2);assert.match(view.jobs[2].blockedReason,/验收/);
 await assert.rejects(runJob(view.jobs[0].id,{root:f.root,engine:f.engine}),/批次/);
 await f.store.execute(batch.id,approval(view));const result=await f.store.view(batch.id);
 assert.deepEqual(f.calls,['dy','sph']);assert.equal(result.state,'partial');assert.equal(result.targetIds.length,0);assert.notEqual(result.statusLabel,'全部完成');
 await assert.rejects(f.store.execute(batch.id,approval(view)),/变化|执行|确认/);assert.deepEqual(f.calls,['dy','sph']);
});
test('unknown stops the queue; continue after checking only starts untouched platforms',async t=>{
 const f=await fixture(t,{engine:{publish:async()=>({}),queryDraft:async()=>({ok:false})}}),b=await f.store.prepare(f.input);
 await f.store.execute(b.id,approval(await f.store.view(b.id)));let v=await f.store.view(b.id);
 assert.equal(v.jobs[0].state,'unknown');assert.equal(v.jobs[1].startedAt,undefined);
 await assert.rejects(f.store.execute(b.id,{...approval(v),allowUnknown:true}),/回查/);
 await verifyJob(v.jobs[0].id,{root:f.root,engine:f.engine});let calls=0;f.engine.publish=async()=>{calls++;return {};};
 v=await f.store.view(b.id);await f.store.execute(b.id,{...approval(v),allowUnknown:true});assert.equal(calls,1);
 assert.equal((await f.store.view(b.id)).jobs[0].state,'unknown');
});
test('double execution is rejected while running and cancellation never starts the next platform',async t=>{
 const controller=new AbortController();let resolve,started;const gate=new Promise(r=>resolve=r),began=new Promise(r=>started=r);
 const f=await fixture(t,{engine:{publish:async()=>{started();await gate;return {};}}}),b=await f.store.prepare(f.input),v=await f.store.view(b.id);
 const running=withCancellation(controller.signal,()=>f.store.execute(b.id,approval(v)));await began;
 await assert.rejects(f.store.execute(b.id,approval(v)),/执行|变化|正在/);
 await assert.rejects(f.people.save({...f.person,expectedRevision:1,name:'另一个名字'},{accounts:f.accounts}),/处理|修改/);
 controller.abort(Error('停止'));resolve();await running;const after=await f.store.view(b.id);assert.equal(after.jobs[1].startedAt,undefined);assert.equal(after.jobs[0].state,'unknown');
});
test('changed person, media, approval or parent linkage prevents any upload',async t=>{
 const f=await fixture(t),b=await f.store.prepare(f.input),v=await f.store.view(b.id);
 await assert.rejects(f.store.execute(b.id,{...approval(v),targetIds:[v.jobs[2].id]}),/确认|变化/);
 await fs.appendFile(f.input.video,'change');await assert.rejects(f.store.execute(b.id,approval(v)),/变化/);assert.equal(f.calls.length,0);
 const g=await fixture(t),c=await g.store.prepare(g.input),w=await g.store.view(c.id);
 await g.people.save({...g.person,name:'已改名',expectedRevision:1},{accounts:g.accounts});await assert.rejects(g.store.execute(c.id,approval(w)),/变化/);
 await fs.rm(path.join(g.root,'batches',c.id,'batch.json'));await assert.rejects(runJob(w.jobs[0].id,{root:g.root,engine:g.engine}),/批次/);
});
test('failed preparation is retained but its children never become independent runnable tasks',async t=>{
 const {prepareJob}=await import('../src/jobs.mjs');let count=0;
 const f=await fixture(t,{prepare:async(...args)=>{if(++count===2)throw Error('模拟准备失败');return prepareJob(...args);}});
 await assert.rejects(f.store.prepare(f.input),/模拟/);const list=await f.store.list();assert.equal(list.length,1);assert.equal(list[0].canExecute,false);
 const names=await fs.readdir(path.join(f.root,'jobs'));assert.equal(names.length,1);const child=await readJob(names[0],{root:f.root});assert.ok(child.input.batchId);
 await assert.rejects(runJob(child.id,{root:f.root,engine:f.engine}),/批次/);assert.equal(f.calls.length,0);
});

test('recovery uses persisted child facts when the parent was not updated before a crash',async t=>{
 const f=await fixture(t),b=await f.store.prepare({...f.input,platforms:['dy','sph']}),v=await f.store.view(b.id);
 const file=path.join(f.root,'jobs',v.jobs[0].id,'job.json'),child=JSON.parse(await fs.readFile(file));child.startedAt=1;child.state='draft_confirmed';await fs.writeFile(file,JSON.stringify(child));
 const parentFile=path.join(f.root,'batches',b.id,'batch.json'),parent=JSON.parse(await fs.readFile(parentFile));parent.phase='running';parent.ownerPid=99999999;parent.attempt=1;await fs.writeFile(parentFile,JSON.stringify(parent));
 const recovered=await f.store.view(b.id);assert.equal(recovered.successCount,1);assert.deepEqual(recovered.targetIds,[v.jobs[1].id]);await f.store.execute(b.id,approval(recovered));assert.deepEqual(f.calls,['sph']);assert.equal((await f.store.view(b.id)).state,'draft_confirmed');
});

test('tampered immutable parent and child records cannot be accepted as a runnable batch',async t=>{
 const f=await fixture(t),b=await f.store.prepare(f.input),v=await f.store.view(b.id),file=path.join(f.root,'batches',b.id,'batch.json');
 const parent=JSON.parse(await fs.readFile(file));parent.person.name='被替换';await fs.writeFile(file,JSON.stringify(parent));await assert.rejects(f.store.view(b.id),/批次|变化/);
 assert.equal((await f.store.list())[0].canExecute,false);await assert.rejects(runJob(v.jobs[0].id,{root:f.root,engine:f.engine}),/批次/);assert.equal(f.calls.length,0);
});

for(const selected of [['dy','sph'],['dy']])test(`metadata contention ${selected.length===1?'during finalization':'between children'} releases without stranding the batch`,async t=>{
 let progress=0,root,holder;
 const f=await fixture(t,{onProgress:async()=>{if(++progress!==2)return;
  const url=new URL('../src/local-store.mjs',import.meta.url).href;
  holder=spawn(process.execPath,['--input-type=module','-e',`import {withLocalLock} from ${JSON.stringify(url)};process.stdin.resume();await withLocalLock(process.argv[1],async()=>{process.stdout.write('held');await new Promise(r=>process.stdin.once('end',r));});`,root],{stdio:['pipe','pipe','pipe']});
  // Resume stdin so EOF releases the external process's file lock.
  holder.stdin.on('error',()=>{});t.after(()=>{try{holder.kill('SIGKILL');}catch{}});await once(holder.stdout,'data');setTimeout(()=>holder.kill('SIGTERM'),150);
 }});root=f.root;
 const batch=await f.store.prepare({...f.input,platforms:selected});await f.store.execute(batch.id,approval(await f.store.view(batch.id)));
 const result=await f.store.view(batch.id);assert.equal(result.state,'draft_confirmed');assert.equal(result.canExecute,false);assert.deepEqual(f.calls,selected);
});

test('批次刷新和回收恢复保留子任务报告，退出的旧处理进程不永久阻止删除',async t=>{
 const f=await fixture(t,{engine:{publish:async()=>({}),queryDraft:async()=>({ok:false})}}),batch=await f.store.prepare({...f.input,platforms:['dy']});await f.store.execute(batch.id,approval(await f.store.view(batch.id)));const id=(await f.store.view(batch.id)).jobs[0].id;
 await verifyJob(id,{root:f.root,engine:f.engine});assert.equal((await f.store.view(batch.id)).jobs[0].verificationReports.length,1);
 const parentFile=path.join(f.root,'batches',batch.id,'batch.json'),parent=JSON.parse(await fs.readFile(parentFile));parent.phase='running';parent.ownerPid=99999999;await fs.writeFile(parentFile,JSON.stringify(parent));
 const {createDesktopService}=await import('../desktop/service-core.mjs'),service=createDesktopService({root:f.root,engine:f.engine});await service.handle('trashTask',{id:batch.id});await service.handle('restoreTask',{id:batch.id});const fresh=await service.handle('dashboard');assert.equal(fresh.jobs[0].jobs[0].verificationReports.length,1);assert.equal(f.calls.length,0);
});
