import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,withLocalLock,localId} from './local-store.mjs';

async function load(root){
  let data;try{data=JSON.parse(await fs.readFile(path.join(root,'task-history.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {schemaVersion:1,deleted:{}};throw Error('任务回收站记录无法读取，请先检查本机记录');}
  if(data?.schemaVersion!==1||!data.deleted||typeof data.deleted!=='object'||Array.isArray(data.deleted))throw Error('任务回收站记录格式无效');
  for(const [id,time]of Object.entries(data.deleted)){localId(id);if(!Number.isFinite(time)||time<=0)throw Error('任务回收站记录内容无效');}return data;
}
export async function taskTrashedAt(root,id){localId(id);return (await load(root)).deleted[id]||null;}
export async function setTaskTrashed(root,id,deleted){
  localId(id);if(typeof deleted!=='boolean')throw Error('回收站操作无效');
  return withLocalLock(root,async()=>{const data=await load(root);if(deleted)data.deleted[id]=data.deleted[id]||Date.now();else delete data.deleted[id];await atomicJson(path.join(root,'task-history.json'),data);return {id,trashedAt:data.deleted[id]||null};});
}
export async function assertTaskActive(root,job){
  const data=await load(root);localId(job.id);if(data.deleted[job.id]||job.input?.batchId&&data.deleted[localId(job.input.batchId)])throw Error('任务已移到回收站，请先恢复记录；已执行的任务仍不可重复提交');
}
