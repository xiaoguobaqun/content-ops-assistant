import fs from 'node:fs/promises';
import path from 'node:path';
import {contentDigest,localId} from './local-store.mjs';
export const batchFile=(root,id)=>path.join(root,'batches',localId(id),'batch.json');
export const batchDigest=batch=>contentDigest({schemaVersion:batch.schemaVersion,id:batch.id,person:batch.person,input:batch.input,targets:batch.targets});
export function checkBatchRecord(batch,id){
 if(batch.id!==id||batch.schemaVersion!==1||!Array.isArray(batch.targets)||!batch.person||!Number.isInteger(batch.attempt)||batch.attempt<0)throw Error('批次记录无效');
 if(!['preparing','preparation_failed'].includes(batch.phase)&&batch.digest!==batchDigest(batch))throw Error('批次内容发生变化，请检查记录');
 const ids=new Set(),platforms=new Set();for(const t of batch.targets){localId(t.jobId);if(ids.has(t.jobId)||platforms.has(t.platform))throw Error('批次子任务重复');ids.add(t.jobId);platforms.add(t.platform);}
 return batch;
}
export async function readBatchRecord(root,id){try{return checkBatchRecord(JSON.parse(await fs.readFile(batchFile(root,id),'utf8')),id);}catch(e){throw Error('批次记录无法核对：'+e.message);}}
export function checkBatchChild(batch,job){
 const target=batch.targets.find(t=>t.jobId===job.id);
 if(job.input?.batchId!==batch.id||!target||target.digest!==job.inputDigest||target.platform!==job.input.platform||target.phone!==job.input.phone||job.input.mode!=='draft')throw Error('批次与子任务内容不一致，禁止执行');
 return target;
}
export async function assertBatchChild(job,{root,authorization,verification=false}){
 if(!job.input?.batchId)return;
 const batch=await readBatchRecord(root,job.input.batchId),target=checkBatchChild(batch,job);
 if(verification)return;
 if(!authorization||batch.phase!=='running'||batch.activeJobId!==job.id||authorization.batchId!==batch.id||authorization.attempt!==batch.attempt||authorization.token!==batch.token||target.eligible!==true)throw Error('批次子任务请从所属批次执行，不能单独或重复上传');
}
