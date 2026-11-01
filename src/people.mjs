import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,withLocalLock,localId,contentDigest,processAlive} from './local-store.mjs';
import {getPlatform,accountPlatform} from './platforms.mjs';
export const accountKey=(platform,phone)=>JSON.stringify([platform,phone]);
export function accountMatches(account,platform,phone){try{return accountPlatform(account)===platform&&account.phone===phone;}catch{return false;}}
function bindingsOf(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('账号绑定格式无效');
 const bindings={};for(const platform of ['dy','sph','xhs'])if(value[platform]){const row=value[platform];
  if(typeof row!=='object'||Array.isArray(row)||row.platform!==platform||typeof row.phone!=='string'||!row.phone.trim()||row.phone!==row.phone.trim()||row.phone.length>80||/[\x00-\x1f\/\\]/.test(row.phone))throw Error('账号绑定无效');
  bindings[platform]={platform,phone:row.phone};
 }for(const key of Object.keys(value))getPlatform(key);return bindings;
}
export function createPeopleStore({root}){
 const file=path.join(root,'people.json');
 async function load(){
  let data;try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {schemaVersion:1,people:[]};throw Error('人员记录无法读取，请先检查原文件');}
  if(data.schemaVersion!==1||!Array.isArray(data.people))throw Error('人员记录格式无效');
  const ids=new Set(),names=new Set(),keys=new Set();for(const p of data.people){
   localId(p.id);if(typeof p.name!=='string'||!p.name.trim()||p.name!==p.name.trim()||p.name.length>60||/[\x00-\x1f\x7f]/.test(p.name)||!Number.isInteger(p.revision)||p.revision<1||ids.has(p.id)||names.has(p.name))throw Error('人员记录内容无效');
   ids.add(p.id);names.add(p.name);const bindings=bindingsOf(p.bindings);for(const b of Object.values(bindings)){const key=accountKey(b.platform,b.phone);if(keys.has(key))throw Error('人员记录存在重复账号绑定');keys.add(key);}
  }return data;
 }
 async function get(id){localId(id);const person=(await load()).people.find(p=>p.id===id);if(!person)throw Error('人员不存在，请重新选择');return person;}
 return {list:async()=>(await load()).people,get,
  async assertSnapshot(snapshot){const actual=await get(snapshot.id);if(actual.revision!==snapshot.revision||actual.name!==snapshot.name||contentDigest(actual.bindings)!==contentDigest(snapshot.bindings))throw Error('人员或账号绑定发生变化，请重新准备');return actual;},
  async save(input,{accounts=[]}={}){return withLocalLock(root,async()=>{
   let dirs=[];try{dirs=await fs.readdir(path.join(root,'batches'));}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const id of dirs){let batch;try{batch=JSON.parse(await fs.readFile(path.join(root,'batches',id,'batch.json'),'utf8'));}catch{continue;}if(['preparing','running'].includes(batch.phase)&&processAlive(batch.ownerPid))throw Error('已有批量任务正在处理，暂不可修改人员绑定');}
   const data=await load(),name=typeof input?.name==='string'?input.name.trim():'';
   if(!name||name.length>60||/[\x00-\x1f\x7f]/.test(name))throw Error('人员名称需为 1～60 个字且不能包含控制字符');
   const previous=input.id?await get(input.id):null;
   if(previous&&input.expectedRevision!==previous.revision)throw Error('人员记录发生变化，请刷新后重新修改');
   if(data.people.some(p=>p.id!==previous?.id&&p.name===name))throw Error('已有同名人员，请使用不同名称');
   const bindings=bindingsOf(input.bindings||{});
   for(const b of Object.values(bindings)){
    if(!accounts.some(a=>accountMatches(a,b.platform,b.phone)))throw Error('绑定账号不存在，请先刷新或连接账号');
    const owner=data.people.find(p=>p.id!==previous?.id&&Object.values(p.bindings).some(other=>accountKey(other.platform,other.phone)===accountKey(b.platform,b.phone)));
    if(owner)throw Error(`该账号已归属“${owner.name}”，请先解除原绑定`);
   }
   const person={id:previous?.id||randomUUID(),name,revision:(previous?.revision||0)+1,bindings,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now()};
   data.people=previous?data.people.map(p=>p.id===person.id?person:p):[...data.people,person];await atomicJson(file,data);return person;
  })},
 };
}
