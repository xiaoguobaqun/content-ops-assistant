import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const id='12345678-1234-1234-1234-123456789012';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'history-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('trash is reversible and blocks execution without deleting immutable evidence',async t=>{
 const root=await fixture(t),api=await import('../src/task-history.mjs');const job={id,state:'confirmed',startedAt:1,input:{mode:'publish'},platformWorkId:'original-work'};
 await fs.mkdir(path.join(root,'jobs',id),{recursive:true});const file=path.join(root,'jobs',id,'job.json');await fs.writeFile(file,JSON.stringify(job));
 await api.setTaskTrashed(root,id,true);assert.ok(await api.taskTrashedAt(root,id));await assert.rejects(api.assertTaskActive(root,job),/回收站/);
 const {runJob}=await import('../src/jobs.mjs');let calls=0;await assert.rejects(runJob(id,{root,engine:{publish:async()=>calls++}}),/回收站/);assert.equal(calls,0);assert.equal((await fs.readFile(file,'utf8')),JSON.stringify(job));
 await api.setTaskTrashed(root,id,false);assert.equal(await api.taskTrashedAt(root,id),null);await api.assertTaskActive(root,job);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).state,'confirmed');
});
test('batch trash blocks its children, and corrupt history fails closed',async t=>{
 const root=await fixture(t),api=await import('../src/task-history.mjs');await api.setTaskTrashed(root,id,true);await assert.rejects(api.assertTaskActive(root,{id:'87654321-1234-1234-1234-123456789012',input:{batchId:id}}),/回收站/);
 await fs.writeFile(path.join(root,'task-history.json'),'{broken');await assert.rejects(api.assertTaskActive(root,{id,input:{}}),/记录/);
});
test('service trash and restore preserve state, refuse running tasks and keep audit data',async t=>{
 const root=await fixture(t),{createDesktopService}=await import('../desktop/service-core.mjs');const dir=path.join(root,'jobs',id);await fs.mkdir(dir,{recursive:true});const job={id,state:'confirmed',createdAt:1,startedAt:2,input:{phone:'合成账号',mode:'publish',visibility:'private'},files:{}};await fs.writeFile(path.join(dir,'job.json'),JSON.stringify(job));
 const service=createDesktopService({root,engine:{}});await service.handle('trashTask',{id});let d=await service.handle('dashboard');assert.equal(d.jobs.length,0);assert.equal(d.trash.length,1);assert.equal(d.trash[0].canExecute,false);assert.equal(d.trash[0].canVerify,false);
 await service.handle('restoreTask',{id});d=await service.handle('dashboard');assert.equal(d.jobs[0].state,'confirmed');assert.equal(d.trash.length,0);
 await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({...job,state:'running'}));await assert.rejects(service.handle('trashTask',{id}),/执行|运行|处理/);
});
test('date filters include local calendar endpoints and use latest operation, not only creation',async()=>{
 const {operationTime,filterTaskDates}=await import('../desktop/ui/task-filters.mjs');const morning=new Date(2026,10,3,0,0,0).getTime(),night=new Date(2026,10,3,23,59,59,999).getTime();
 const rows=[{id:'a',createdAt:morning-86400000,checkedAt:morning},{id:'b',createdAt:night},{id:'c',createdAt:night+1},{id:'batch',createdAt:morning-86400000,jobs:[{startedAt:morning}]}];
 assert.equal(operationTime(rows[0]),morning);assert.deepEqual(filterTaskDates(rows,'2026-11-03','2026-11-03').map(r=>r.id),['a','b','batch']);
 assert.throws(()=>filterTaskDates(rows,'2026-11-04','2026-11-03'),/开始|日期/);assert.throws(()=>filterTaskDates(rows,'2026-02-31',''),/日期/);assert.equal(filterTaskDates(rows,'','').length,4);
});
