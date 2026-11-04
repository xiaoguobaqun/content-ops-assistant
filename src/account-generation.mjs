import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJson} from './local-store.mjs';
const key=input=>createHash('sha256').update(JSON.stringify([input.platform??'dy',input.phone])).digest('hex');
async function load(root){
  let data;try{data=JSON.parse(await fs.readFile(path.join(root,'account-generations.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {schemaVersion:1,generations:{}};throw Error('账号版本记录无法读取，未继续操作');}
  if(data?.schemaVersion!==1||!data.generations||typeof data.generations!=='object'||Array.isArray(data.generations)||Object.entries(data.generations).some(([k,v])=>!/^[a-f0-9]{64}$/.test(k)||!Number.isSafeInteger(v)||v<1))throw Error('账号版本记录损坏，未继续操作');
  return data;
}
export async function accountGeneration(root,input){return (await load(root)).generations[key(input)]||0;}
// 调用方须持本机记录锁；先推进版本，再作废任务和退出登录，崩溃也不能重放旧授权。
export async function advanceAccountGeneration(root,input){const data=await load(root),id=key(input);const next=(data.generations[id]||0)+1;if(!Number.isSafeInteger(next))throw Error('账号版本已超限');data.generations[id]=next;await atomicJson(path.join(root,'account-generations.json'),data);return next;}
