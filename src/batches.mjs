import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,withLocalLock,processAlive,contentDigest,localId} from './local-store.mjs';
import {batchFile,batchDigest,readBatchRecord,checkBatchChild} from './batch-guard.mjs';
import {prepareJob,readJob,runJob,assertJobUnchanged} from './jobs.mjs';
import {getPlatform,validatePlatformInput,assertPlatformExecution} from './platforms.mjs';
import {accountMatches} from './people.mjs';
import {throwIfCancelled} from './cancellation.mjs';
import {assertTaskActive} from './task-history.mjs';
import {readVerificationReports} from './verification-report.mjs';
import {jobView} from '../desktop/model.mjs';
const running=batch=>batch.phase==='running'&&processAlive(batch.ownerPid);
const save=(root,batch)=>atomicJson(batchFile(root,batch.id),batch);
function validateCommon(input){
 if(!input||typeof input!=='object'||!Array.isArray(input.platforms)||!input.platforms.length||new Set(input.platforms).size!==input.platforms.length)throw Error('请选择至少一个平台');
 if(input.mode!==undefined&&input.mode!=='draft')throw Error('人员批次目前只支持草稿');
 for(const key of ['title','video'])if(typeof input[key]!=='string'||!input[key].trim())throw Error('请选择视频并填写标题');
 if(input.description!==undefined&&typeof input.description!=='string')throw Error('简介格式无效');
 if(input.cover!==undefined&&typeof input.cover!=='string')throw Error('封面格式无效');
 if(input.shortTitle!==undefined&&typeof input.shortTitle!=='string')throw Error('短标题格式无效');
 for(const platform of input.platforms)getPlatform(platform);
}
export function createBatchStore({root,people,engine,prepare=prepareJob,run=runJob,onProgress=()=>{}}){
 async function children(batch){const jobs=[];for(const t of batch.targets){const job=await readJob(t.jobId,{root});checkBatchChild(batch,job);jobs.push(job);}return jobs;}
 async function read(id){const batch=await readBatchRecord(root,localId(id));await children(batch);return batch;}
 function remaining(batch,jobs){return batch.targets.filter(t=>t.eligible&&jobs.some(j=>j.id===t.jobId&&!j.startedAt&&j.state==='prepared')).map(t=>t.jobId);}
 async function view(id,{active=false}={}){
  const batch=await read(id),raw=await children(batch),jobs=await Promise.all(raw.map(async(job,i)=>({...jobView({...job,verificationReports:await readVerificationReports(root,job.id)},{active:active&&batch.activeJobId===job.id}),eligible:batch.targets[i].eligible,blockedReason:batch.targets[i].blockedReason||''})));
  const ready=!['preparing','preparation_failed'].includes(batch.phase),live=running(batch),targetIds=ready?remaining(batch,raw):[];
  const unknown=jobs.filter(j=>j.startedAt&&j.state!=='draft_confirmed'),success=jobs.filter(j=>j.state==='draft_confirmed').length;
  const state=live?'running':!ready?'incomplete':unknown.length?'unknown':success===jobs.length&&jobs.length?'draft_confirmed':success?'partial':'prepared';
  const statusLabel={running:'处理中',incomplete:'准备未完成',unknown:'待核实',draft_confirmed:'全部草稿已核实',partial:'部分完成',prepared:batch.attempt?'已停止 · 尚有待处理项':'待执行'}[state];
  return {kind:'batch',id:batch.id,person:batch.person,title:batch.input.title,description:batch.input.description,shortTitle:batch.input.shortTitle||'',mode:'draft',digest:batch.digest,attempt:batch.attempt,createdAt:batch.createdAt,state,statusLabel,tone:state==='draft_confirmed'?'green':['partial','unknown','incomplete'].includes(state)?'amber':live?'blue':'neutral',
   jobs,targetIds,canExecute:ready&&!live&&targetIds.length>0,requiresUnknownConfirmation:unknown.length>0,needsVerification:unknown.some(j=>!j.checkedAt),message:batch.message||'',
   videoPath:jobs[0]?.videoPath||'',coverPath:jobs[0]?.coverPath||'',videoName:jobs[0]?.videoName||path.basename(batch.input.video),successCount:success};
 }
 async function prepareBatch(input){
  validateCommon(input);const person=await people.get(input.personId),platforms=['dy','sph','xhs'].filter(p=>input.platforms.includes(p));
  for(const platform of platforms){const b=person.bindings[platform];if(!b)throw Error('所选人员未绑定该平台账号');validatePlatformInput({platform,phone:b.phone,title:input.title.trim(),description:input.description||'',mode:'draft',visibility:platform==='dy'?'private':'unknown',...(platform==='sph'?{shortTitle:input.shortTitle||''}:{})});}
  const batch={schemaVersion:1,id:randomUUID(),createdAt:Date.now(),person,input:{title:input.title.trim(),description:input.description||'',video:input.video,cover:input.cover||null,shortTitle:input.shortTitle||''},targets:[],phase:'preparing',attempt:0,ownerPid:process.pid};
  await withLocalLock(root,async()=>{await people.assertSnapshot(person);await save(root,batch);});
  try{
   let cover=input.cover;
   for(const platform of platforms){throwIfCancelled();const p=getPlatform(platform),phone=person.bindings[platform].phone;
    const job=await prepare({platform,phone,video:input.video,cover,title:input.title.trim(),description:input.description||'',shortTitle:platform==='sph'?input.shortTitle||'':undefined,mode:'draft',visibility:platform==='dy'?'private':'unknown',creativeStatement:'none'},{root,batchId:batch.id});
    if(!cover)cover=job.files.cover.path;
    batch.targets.push({platform,phone,jobId:job.id,digest:job.inputDigest,eligible:p.executionEnabled!==false,blockedReason:p.executionEnabled===false?`${p.name}待实机验收，本次不会执行`:''});await save(root,batch);
   }
   throwIfCancelled();await withLocalLock(root,async()=>{await people.assertSnapshot(person);batch.digest=batchDigest(batch);batch.phase='prepared';batch.ownerPid=null;await save(root,batch);});return batch;
  }catch(e){batch.phase='preparation_failed';batch.ownerPid=null;batch.message=e.message;await save(root,batch);throw e;}
 }
 async function execute(id,{expectedDigest,expectedAttempt,targetIds,allowUnknown=false}={}){
  await assertTaskActive(root,{id,input:{}});
  let batch,token;
  // 素材哈希可能耗时；登记锁内只复核持久化快照。runJob 上传前仍再次检查文件。
  const initial=await read(id);for(const job of await children(initial))await assertJobUnchanged(job);
  await withLocalLock(root,async()=>{
   batch=await read(id);if(running(batch))throw Error('该批次正在执行');
   if(['preparing','preparation_failed'].includes(batch.phase)||batch.digest!==expectedDigest||batch.attempt!==expectedAttempt)throw Error('批次或确认信息发生变化，请重新确认');
   await people.assertSnapshot(batch.person);const jobs=await children(batch),pending=remaining(batch,jobs);
   if(!pending.length||contentDigest(pending)!==contentDigest(targetIds))throw Error('待执行范围发生变化，请重新确认，不能重复执行');
   const unknown=jobs.filter(j=>j.startedAt&&j.state!=='draft_confirmed');if(unknown.some(j=>!j.checkedAt))throw Error('请先回查待核实平台，再继续未开始的平台');if(unknown.length&&allowUnknown!==true)throw Error('需要明确确认继续其他未开始平台');
   for(const job of jobs)if(pending.includes(job.id))assertPlatformExecution(job.input);
   batch.attempt++;batch.token=token=randomUUID();batch.ownerPid=process.pid;batch.phase='running';batch.activeJobId=null;batch.message='';await save(root,batch);
  });
  try{
   throwIfCancelled();const accounts=await engine.accounts();throwIfCancelled();
   for(const target of batch.targets.filter(t=>targetIds.includes(t.jobId)))if(!accounts.some(a=>accountMatches(a,target.platform,target.phone)&&a.loggedIn===true))throw Error('目标账号连接状态未确认，请重新连接后再继续');
   for(const jobId of targetIds){
    throwIfCancelled();await people.assertSnapshot(batch.person);
    await withLocalLock(root,async()=>{const current=await read(id);if(current.token!==token||current.phase!=='running')throw Error('批次执行记录发生变化，已停止');batch=current;batch.activeJobId=jobId;await save(root,batch);});
    await onProgress({batchId:id,jobId});const result=await run(jobId,{root,engine,authorization:{batchId:batch.id,attempt:batch.attempt,token}});await onProgress({batchId:id,jobId});
    if(result.state!=='draft_confirmed')throw Error('一个平台结果待核实，已停止后续平台，请先回查');
   }
   batch.phase='finished';
  }catch(e){batch.phase='stopped';batch.message=e.message;}
  finally{batch.activeJobId=null;batch.ownerPid=null;batch.token=null;await withLocalLock(root,()=>save(root,batch),{waitMs:Infinity});}
  return view(id);
 }
 return {prepare:prepareBatch,read,view,execute,async list(){let ids=[];try{ids=await fs.readdir(path.join(root,'batches'));}catch(e){if(e.code!=='ENOENT')throw e;}const result=[];for(const id of ids){try{localId(id);result.push(await view(id));}catch{if(/^[a-f\d-]{36}$/.test(id))result.push({kind:'batch',id,title:'批次记录无法读取',person:{name:'待检查'},createdAt:0,state:'unknown',tone:'amber',statusLabel:'记录待检查',canExecute:false,jobs:[],targetIds:[],message:'批次记录损坏，请检查本机文件；关联子任务不会独立执行。'});}}return result;}};
}
