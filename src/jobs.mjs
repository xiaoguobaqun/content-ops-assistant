import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { runProcess } from './process.mjs';
import {withEngineLock} from './lock.mjs';
import {throwIfCancelled} from './cancellation.mjs';
import {platformId,validatePlatformInput,assertPlatformExecution,draftConfirmed} from './platforms.mjs';
import { matchDouyinWork } from '../engine/MatrixMedia/src/shared/douyinWork.js';

export const defaultRoot=fileURLToPath(new URL('../.local',import.meta.url));
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
  const r=await runProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]);
  if(r.code!==0) throw Error(`${label}无法读取`);
  const media=JSON.parse(r.stdout);
  if(!media.streams?.some(s=>s.codec_type==='video'&&s.width>0&&s.height>0)) throw Error(`${label}没有可用画面`);
  return media;
}
export async function readJob(id,{root=defaultRoot}={}){return JSON.parse(await fs.readFile(path.join(jobDir(root,id),'job.json'),'utf8'));}
const save=(job,root)=>atomicJson(path.join(jobDir(root,job.id),'job.json'),job);

export async function prepareJob(raw,{root=defaultRoot}={}){
  const platform=platformId(raw);
  if(platform!=='sph'&&raw.shortTitle)throw Error('该平台不使用视频号短标题');
  const input={platform,phone:String(raw.phone||'').trim(),video:path.resolve(raw.video||'.'),title:String(raw.title||'').trim(),description:String(raw.description||'').trim(),mode:raw.mode??'draft',visibility:raw.visibility??(platform==='dy'?'private':'unknown'),creativeStatement:raw.creativeStatement??'none',...(platform==='sph'?{shortTitle:String(raw.shortTitle||'').trim()}:{})};
  validatePlatformInput(input);
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
      const r=await runProcess('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(Math.min(3,duration/4)),'-i',video.path,'-frames:v','1','-vf','scale=900:1200:force_original_aspect_ratio=decrease,pad=900:1200:(ow-iw)/2:(oh-ih)/2:color=black','-q:v','2',coverPath]);
      if(r.code!==0) throw Error('自动提取封面失败');
      cover=await fingerprint(coverPath,'封面'); await probe(cover.path,'封面');
    }
    const files={video,cover},job={schemaVersion:1,id,createdAt:Date.now(),input,files,inputDigest:digest({input,files}),state:'prepared',moderation:'unknown'};
    await save(job,root); return job;
  }catch(e){await fs.rm(directory,{recursive:true,force:true});throw e;}
}

function unchangedRecord(job){
  if(digest({input:job.input,files:job.files})!==job.inputDigest) throw Error('任务内容发生变化，请重新准备');
}
async function unchanged(job){
  unchangedRecord(job);
  for(const label of ['video','cover']){
    const actual=await fingerprint(job.files[label].path,label==='video'?'视频':'封面');
    if(actual.sha256!==job.files[label].sha256) throw Error('视频或封面发生变化，请重新准备任务');
  }
}
async function verifyInside(job,engine,root){
  throwIfCancelled();
  if(job.input.mode==='draft') {
    if(engine.queryDraft){const reply=await engine.queryDraft(job);throwIfCancelled();job.verification=reply;job.state=draftConfirmed(job,reply)?'draft_confirmed':'unknown';job.checkedAt=Date.now();}
    else if(platformId(job.input)!=='dy'){job.state='unknown';job.verification={status:'unknown',reason:'缺少该平台的独立草稿核验，禁止重发'};}
    else job.verification={status:job.state==='draft_confirmed'?'confirmed':'unknown',reason:'草稿仅以引擎的恢复证据确认；不会重新执行'};
    await save(job,root);return job;
  }
  let list=await engine.query(job.input.phone,job.platformWorkId);
  throwIfCancelled();
  if(!job.platformWorkId){
    const candidate=matchDouyinWork({...list,baselineIds:job.baseline?.works?.map(w=>w.workId),baselineComplete:job.baseline?.complete===true,since:job.startedAt,title:job.input.title,description:job.input.description,now:Date.now()});
    if(candidate.status==='confirmed'){list=await engine.query(job.input.phone,candidate.work.workId);throwIfCancelled();}
  }
  const verification=matchDouyinWork({...list,workId:job.platformWorkId||undefined,baselineIds:job.baseline?.works?.map(w=>w.workId),baselineComplete:job.baseline?.complete===true,since:job.startedAt,title:job.input.title,description:job.input.description,visibility:job.input.visibility,now:Date.now()});
  job.verification=verification; job.checkedAt=Date.now();
  if(verification.status==='confirmed'){job.state='confirmed';job.platformWorkId=verification.work.workId;job.platformUrl=verification.work.url;}
  else job.state='unknown';
  await save(job,root);return job;
}
export async function runJob(id,{root=defaultRoot,engine}={}){
  if(!engine) throw Error('缺少执行引擎');
  return withEngineLock(root,async()=>{
    throwIfCancelled();
    const job=await readJob(id,{root});
    if(job.state!=='prepared') {if(job.state==='running'){job.state='unknown';job.message='上次运行中断，请先回查，禁止重发';await save(job,root);}return job;}
    await unchanged(job);
    assertPlatformExecution(job.input);
    throwIfCancelled();
    job.state='running';job.startedAt=Date.now();await save(job,root);
    try{
      throwIfCancelled();
      if(job.input.mode==='publish'){
        job.baseline=await engine.query(job.input.phone);await save(job,root);
        throwIfCancelled();
        if(!job.baseline.complete) throw Error('提交前作品列表不完整，已停止实际发布');
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
  return withEngineLock(root,async()=>{const job=await readJob(id,{root});if(!job.startedAt) throw Error('任务尚未执行');unchangedRecord(job);validatePlatformInput(job.input);try{return await verifyInside(job,engine,root);}catch(e){job.state='unknown';job.message=e.message;job.checkedAt=Date.now();await save(job,root);return job;}});
}
