import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {dataRoot,mediaTool} from './runtime-paths.mjs';
import { runProcess } from './process.mjs';
import {withEngineLock} from './lock.mjs';
import {throwIfCancelled} from './cancellation.mjs';
import {platformId,validatePlatformInput,assertPlatformExecution,draftConfirmed} from './platforms.mjs';
import { matchDouyinWork } from '../engine/MatrixMedia/src/shared/douyinWork.js';
import {assertBatchChild} from './batch-guard.mjs';
import {localId} from './local-store.mjs';
import {withLocalLock} from './local-store.mjs';
import {accountGeneration} from './account-generation.mjs';
import {assertTaskActive} from './task-history.mjs';
import {writeVerificationReport,readVerificationReports} from './verification-report.mjs';

export const defaultRoot=dataRoot;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jobDir=(root,id)=>{if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(String(id))) throw Error('任务编号无效');return path.join(root,'jobs',id);};
async function atomicJson(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+randomUUID()+'.tmp';
  const handle=await fs.open(tmp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();} finally{await handle.close();}
  await fs.rename(tmp,file);
}
async function fingerprint(file,label){
  const resolved=path.resolve(file); const st=await fs.stat(resolved).catch(()=>{throw Error(`${label}文件不存在：${resolved}`);});
  if(!st.isFile()||!st.size) throw Error(`${label}不是有效文件`);
  const hash=createHash('sha256'); for await(const chunk of createReadStream(resolved)) hash.update(chunk);
  return {path:resolved,size:st.size,sha256:hash.digest('hex')};
}
async function probe(file,label){
  const r=await runProcess(mediaTool('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',file]);
  if(r.code!==0) throw Error(`${label}无法读取`);
  const media=JSON.parse(r.stdout);
  if(!media.streams?.some(s=>s.codec_type==='video'&&s.width>0&&s.height>0)) throw Error(`${label}没有可用画面`);
  return media;
}
export async function readJob(id,{root=defaultRoot}={}){return JSON.parse(await fs.readFile(path.join(jobDir(root,id),'job.json'),'utf8'));}
const save=(job,root)=>atomicJson(path.join(jobDir(root,job.id),'job.json'),job);

export async function prepareJob(raw,{root=defaultRoot,batchId}={}){
  const platform=platformId(raw);
  if(platform!=='sph'&&raw.shortTitle)throw Error('该平台不使用视频号短标题');
  const input={platform,phone:String(raw.phone||'').trim(),video:path.resolve(raw.video||'.'),title:String(raw.title||'').trim(),description:String(raw.description||'').trim(),mode:raw.mode??'draft',visibility:raw.visibility??(platform==='dy'?'private':'unknown'),creativeStatement:raw.creativeStatement??'none',...(platform==='sph'?{shortTitle:String(raw.shortTitle||'').trim()}:{})};
  if(batchId)input.batchId=localId(batchId);
  validatePlatformInput(input);
  input.accountGeneration=await accountGeneration(root,input);
  if(!input.phone||!input.title||!raw.video) throw Error('需要账号、视频路径和标题');
  if([...input.title].length>30) throw Error('标题最多 30 个字');
  if(!['draft','publish'].includes(input.mode)) throw Error('执行模式必须为 draft 或 publish');
  if(!['none','ai_generated','fiction','marketing','personal_opinion','repost'].includes(input.creativeStatement)) throw Error('自主声明无效');
  const video=await fingerprint(input.video,'视频'); const media=await probe(video.path,'视频');
  let cover;
  if(raw.cover){cover=await fingerprint(raw.cover,'封面');await probe(cover.path,'封面');}
  const id=randomUUID(),directory=jobDir(root,id); await fs.mkdir(directory,{recursive:true,mode:0o700});
  try{
    if(!cover){
      const coverPath=path.join(directory,'cover.jpg');
      const duration=Number(media.format?.duration)||0;
      const r=await runProcess(mediaTool('ffmpeg'),['-hide_banner','-loglevel','error','-ss',String(Math.min(3,duration/4)),'-i',video.path,'-frames:v','1','-vf','scale=900:1200:force_original_aspect_ratio=decrease,pad=900:1200:(ow-iw)/2:(oh-ih)/2:color=black','-q:v','2',coverPath]);
      if(r.code!==0) throw Error('自动提取封面失败');
      cover=await fingerprint(coverPath,'封面'); await probe(cover.path,'封面');
    }
    const files={video,cover},job={schemaVersion:1,id,createdAt:Date.now(),input,files,inputDigest:digest({input,files}),state:'prepared',moderation:'unknown'};
    await withLocalLock(root,async()=>{
      throwIfCancelled();
      if(await accountGeneration(root,input)!==input.accountGeneration)throw Error('账号在准备期间发生变化，请重新连接后重新准备任务');
      await save(job,root);
    });return job;
  }catch(e){await fs.rm(directory,{recursive:true,force:true});throw e;}
}

function unchangedRecord(job){
  if(digest({input:job.input,files:job.files})!==job.inputDigest) throw Error('任务内容发生变化，请重新准备');
}
export async function assertJobUnchanged(job){
  unchangedRecord(job);
  for(const label of ['video','cover']){
    const actual=await fingerprint(job.files[label].path,label==='video'?'视频':'封面');
    if(actual.sha256!==job.files[label].sha256) throw Error('视频或封面发生变化，请重新准备任务');
  }
}
function workQueryFailure(reply){
  // 只翻译已知原因，不把平台正文、异常 URL 或凭据片段带进界面。
  const reasons={work_list_http:'抖音作品接口请求失败，请检查网络或平台访问状态',work_list_unavailable:'抖音作品接口拒绝查询或返回格式不支持，请检查登录状态',unsafe_work_id:'作品编号无法安全识别',duplicate_work_id:'作品分页出现重复条目',repeated_cursor:'作品分页游标重复',missing_cursor:'作品分页缺少继续或结束标记'};
  if(typeof reply?.reason==='string'&&Object.hasOwn(reasons,reply.reason))return reasons[reply.reason];
  if(reply?.message==='登录态失效，请先登录')return '抖音登录状态失效，请先在账号管理中重新登录';
  if(reply?.message==='作品回查超时')return '抖音作品查询超时，请检查网络后回查';
  return '具体原因尚未识别，请查看本机任务和运行日志';
}
function createdWorkMessage(job){
  const scope={private:'仅自己可见',friends:'好友可见',public:'公开'}[job.input.visibility];
  return `已确认作品已创建；${scope}范围仍待核实，审核状态未知。请勿重复提交。`;
}
async function queryWorks(job,engine,workId){
  try{return await engine.query(job.input.phone,workId);}
  catch(error){
    throwIfCancelled();
    const created=job.verification?.creation?.status==='confirmed'?createdWorkMessage(job):'';
    throw Error(`${created}抖音作品回查未完成：${workQueryFailure({message:error?.message})}。请勿重复提交。`);
  }
}
async function verifyInside(job,engine,root){
  throwIfCancelled();
  if(job.input.mode==='draft') {
    if(engine.queryDraft){const reply=await engine.queryDraft(job);throwIfCancelled();job.verification={...reply,query:{status:reply?.ok===false?'failed':'completed'}};job.state=draftConfirmed(job,reply)?'draft_confirmed':'unknown';job.checkedAt=Date.now();}
    else if(platformId(job.input)!=='dy'){job.state='unknown';job.verification={status:'unknown',reason:'缺少该平台的独立草稿核验，禁止重发'};}
    else job.verification={status:job.state==='draft_confirmed'?'confirmed':'unknown',reason:'草稿仅以引擎的恢复证据确认；不会重新执行'};
    await save(job,root);return job;
  }
  let list=await queryWorks(job,engine,job.platformWorkId);
  throwIfCancelled();
  const candidate=matchDouyinWork({...list,workId:job.platformWorkId||undefined,baselineIds:job.baseline?.works?.map(w=>w.workId),baselineComplete:job.baseline?.complete===true,since:job.startedAt,title:job.input.title,description:job.input.description,now:Date.now()});
  if(candidate.status==='confirmed'){
    const needsIdentityLookup=!job.platformWorkId;
    job.state='unknown';job.platformWorkId=candidate.work.workId;job.platformUrl=candidate.work.url;
    job.verification={status:'unknown',reason:'visibility_pending',creation:{status:'confirmed',workId:job.platformWorkId,checkedAt:Date.now()},visibility:{status:'unknown',requested:job.input.visibility}};
    job.message=createdWorkMessage(job);
    // 创建证据先落盘；后续范围查询失败、取消或中断也不能丢失已找到的作品编号。
    await save(job,root);
    if(needsIdentityLookup){list=await queryWorks(job,engine,job.platformWorkId);throwIfCancelled();}
  }
  const verification=matchDouyinWork({...list,workId:job.platformWorkId||undefined,baselineIds:job.baseline?.works?.map(w=>w.workId),baselineComplete:job.baseline?.complete===true,since:job.startedAt,title:job.input.title,description:job.input.description,visibility:job.input.visibility,now:Date.now()});
  job.verification={...verification,query:{status:list.complete===false||list.ok===false?'failed':'completed',reason:list.reason==='work_list_http'?'work_list_http':'unavailable'},creation:job.verification?.creation||{status:'unknown'},visibility:{status:verification.status==='confirmed'?'confirmed':'unknown',requested:job.input.visibility}};job.checkedAt=Date.now();
  if(verification.status==='confirmed'){job.state='confirmed';job.platformWorkId=verification.work.workId;job.platformUrl=verification.work.url;delete job.message;}
  else {
    job.state='unknown';job.message=job.verification.creation.status==='confirmed'?createdWorkMessage(job):'尚未找到符合本次任务的作品，结果待核实。请勿重复提交。';
    if(list.complete===false)job.message+=`本次回查未完成：${workQueryFailure(list)}。`;
  }
  await save(job,root);return job;
}
export async function runJob(id,{root=defaultRoot,engine,authorization}={}){
  if(!engine) throw Error('缺少执行引擎');
  return withEngineLock(root,async()=>{
    throwIfCancelled();
    const job=await readJob(id,{root});
    await assertTaskActive(root,job);
    await assertBatchChild(job,{root,authorization});
    if(job.state!=='prepared') {if(job.state==='running'){job.state='unknown';job.message='上次运行中断，请先回查，禁止重发';await save(job,root);}return job;}
    if((job.input.accountGeneration??0)!==await accountGeneration(root,job.input))throw Error('该任务的账号已移除，旧任务已作废，请重新准备');
    await assertJobUnchanged(job);
    assertPlatformExecution(job.input);
    throwIfCancelled();
    job.state='running';job.startedAt=Date.now();await save(job,root);
    try{
      throwIfCancelled();
      if(job.input.mode==='publish'){
        job.baseline=await queryWorks(job,engine);await save(job,root);
        throwIfCancelled();
        if(!job.baseline.complete) throw Error(`提交前作品列表不完整，已停止实际发布：${workQueryFailure(job.baseline)}`);
      }
      throwIfCancelled();job.receipt=await engine.publish(job);throwIfCancelled();job.finishedAt=Date.now();
      job.state=platformId(job.input)==='dy'&&job.input.mode==='draft'&&job.receipt.resultStatus==='draft'&&job.receipt.draftEvidence?.ok===true?'draft_confirmed':'unknown';
      await save(job,root);
      if(job.input.mode==='publish'||['sph','xhs'].includes(platformId(job.input))) await verifyInside(job,engine,root);
    }catch(e){job.state='unknown';job.message=String(e.message||e);await save(job,root);}
    return job;
  });
}
export async function verifyJob(id,{root=defaultRoot,engine}={}){
  return withEngineLock(root,async()=>{
    const job=await readJob(id,{root});await assertTaskActive(root,job);if(!job.startedAt)throw Error('任务尚未执行');
    try{await assertBatchChild(job,{root,verification:true});unchangedRecord(job);validatePlatformInput(job.input);}
    catch(error){await writeVerificationReport(root,job,{error,preflight:true});throw error;}
    let failure;try{await verifyInside(job,engine,root);}catch(error){failure=error;job.state='unknown';job.message=error.message;job.checkedAt=Date.now();await save(job,root);}
    await writeVerificationReport(root,job,{error:failure});return {...job,verificationReports:await readVerificationReports(root,id)};
  });
}
