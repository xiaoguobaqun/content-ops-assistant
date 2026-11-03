import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {atomicJson,localId} from './local-store.mjs';
const directory=(root,id)=>path.join(root,'jobs',localId(id),'verification-reports');
export async function writeVerificationReport(root,job,{error,preflight=false}={}){
  const draft=job.input?.mode==='draft',v=job.verification||{},known=job.state==='draft_confirmed'||job.state==='confirmed',queryFailed=!!error||v.query?.status==='failed'||v.ok===false;
  const checks=draft?[
    {key:'draft',label:'草稿内容',status:!error&&job.state==='draft_confirmed'?'confirmed':'unknown',detail:!error&&job.state==='draft_confirmed'?'已取得符合本任务的草稿核验证据':'未取得完整的草稿内容核验证据'},
    {key:'preservation',label:'草稿保留',status:!error&&v.evidence?.preserved===true?'confirmed':'unknown',detail:!error&&v.evidence?.preserved===true?'已独立确认草稿保留':'平台草稿是否保留仍需核对'},
    {key:'visibility',label:'对外可见范围',status:'unknown',detail:'本任务只保存草稿，不据此判断已对外发布'},
  ]:[
    {key:'creation',label:'作品创建',status:v.creation?.status==='confirmed'?'confirmed':'unknown',detail:v.creation?.status==='confirmed'?'已确认匹配本任务的作品编号':'未取得唯一匹配本任务的作品证据'},
    {key:'visibility',label:'可见范围',status:!error&&v.visibility?.status==='confirmed'?'confirmed':'unknown',detail:!error&&v.visibility?.status==='confirmed'?'已核实符合本次选择的可见范围':'尚未核实符合本次选择的可见范围'},
  ];
  checks.push({key:'moderation',label:'平台审核',status:job.moderation==='approved'?'confirmed':job.moderation==='rejected'?'failed':'unknown',detail:job.moderation==='approved'?'已有审核通过证据':job.moderation==='rejected'?'平台审核未通过':'未取得独立审核证据，请以平台显示为准'});
  if(queryFailed)checks.unshift({key:'query',label:'本次回查',status:'failed',detail:preflight?'任务内容或关联授权无法核对，本次未操作平台':v.query?.reason==='work_list_http'?'平台作品查询请求失败，请检查网络或平台连接':/超时|timeout/i.test(error?.message||'')?'平台回查超时，未获得完整结果':'本次回查未完成，请检查平台连接与本机记录'});
  const report={schemaVersion:1,id:randomUUID(),taskId:localId(job.id),checkedAt:Date.now(),outcome:!queryFailed&&known?'confirmed':'unknown',summary:queryFailed?'本次回查未完成，结果仍待核实':known?draft?'已核实草稿；对外发布及审核不由本报告推断':'已核实作品与所选范围；审核请单独查看':'部分证据不足，结果仍待核实',checks,nextSteps:!queryFailed&&known?['可打开平台核对实际展示及审核状态。']:['打开对应平台，核对本账号的作品或草稿。','网络或验证恢复后，可再次回查。','请勿重复提交或重新上传本任务。']};
  await atomicJson(path.join(directory(root,job.id),report.id+'.json'),report);return report;
}
export async function readVerificationReports(root,id){
  const dir=directory(root,id);let files;try{files=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];for(const file of files.filter(f=>/^[a-f\d-]{36}\.json$/.test(f))){const r=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));if(r.schemaVersion!==1||r.taskId!==id||!Array.isArray(r.checks)||!Number.isFinite(r.checkedAt))throw Error('回查报告记录无效');result.push(r);}return result.sort((a,b)=>b.checkedAt-a.checkedAt||b.id.localeCompare(a.id));
}
