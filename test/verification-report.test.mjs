import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
const id='12345678-1234-1234-1234-123456789012';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'reports-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('creation, requested visibility and moderation remain independent in report history',async t=>{
 const root=await fixture(t),api=await import('../src/verification-report.mjs');const job={id,state:'unknown',input:{platform:'dy',mode:'publish',visibility:'public'},platformWorkId:'work',verification:{creation:{status:'confirmed'},visibility:{status:'unknown'}}};
 const first=await api.writeVerificationReport(root,job);assert.equal(first.checks.find(c=>c.key==='creation').status,'confirmed');assert.equal(first.checks.find(c=>c.key==='visibility').status,'unknown');assert.equal(first.checks.find(c=>c.key==='moderation').status,'unknown');assert.match(first.summary,/待核实|未确认/);
 const second=await api.writeVerificationReport(root,{...job,state:'confirmed',verification:{creation:{status:'confirmed'},visibility:{status:'confirmed'}}});assert.notEqual(first.id,second.id);assert.equal((await api.readVerificationReports(root,id)).length,2);assert.equal(second.checks.find(c=>c.key==='moderation').status,'unknown');
});
test('failed verification writes an honest report and never uploads, including preflight rejection',async t=>{
 const root=await fixture(t),{verifyJob}=await import('../src/jobs.mjs'),{readVerificationReports}=await import('../src/verification-report.mjs');const input={platform:'dy',phone:'合成账号',title:'标题',description:'',mode:'draft',visibility:'private'},files={};const job={id,input,files,inputDigest:createHash('sha256').update(JSON.stringify({input,files})).digest('hex'),state:'unknown',startedAt:1};
 const dir=path.join(root,'jobs',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'job.json'),JSON.stringify(job));let publishes=0;
 await verifyJob(id,{root,engine:{queryDraft:async()=>{throw Error('网络超时 private-token');},publish:async()=>publishes++}});let reports=await readVerificationReports(root,id);assert.equal(reports.length,1);assert.equal(reports[0].outcome,'unknown');assert.doesNotMatch(JSON.stringify(reports),/private-token/);assert.equal(publishes,0);
 const invalid={...job,input:{...input,title:'发生变化'}};await fs.writeFile(path.join(dir,'job.json'),JSON.stringify(invalid));await assert.rejects(verifyJob(id,{root,engine:{}}),/变化/);reports=await readVerificationReports(root,id);assert.equal(reports.length,2);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'job.json'),'utf8')).input.title,'发生变化');
});

test('平台返回结构化查询失败也写失败检查，保留已经确认的作品创建证据',async t=>{
 const root=await fixture(t),{verifyJob}=await import('../src/jobs.mjs'),{readVerificationReports}=await import('../src/verification-report.mjs');
 for(const [n,mode]of ['draft','publish'].entries()){
  const taskId=n?'22345678-1234-1234-1234-123456789012':id,input={platform:'dy',phone:'合成',title:'标题',description:'',mode,visibility:'public'},files={};const job={id:taskId,input,files,inputDigest:createHash('sha256').update(JSON.stringify({input,files})).digest('hex'),state:'unknown',startedAt:1,...(mode==='publish'?{platformWorkId:'7703578090676440339',verification:{creation:{status:'confirmed'}}}:{})};const dir=path.join(root,'jobs',taskId);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'job.json'),JSON.stringify(job));
  await verifyJob(taskId,{root,engine:{query:async()=>({ok:false,complete:false,works:[],reason:'work_list_http'}),queryDraft:async()=>({ok:false,message:'private raw text'})}});const report=(await readVerificationReports(root,taskId))[0];assert.equal(report.checks.find(c=>c.key==='query')?.status,'failed');assert.doesNotMatch(JSON.stringify(report),/private raw text/);if(mode==='publish')assert.equal(report.checks.find(c=>c.key==='creation').status,'confirmed');
 }
});
