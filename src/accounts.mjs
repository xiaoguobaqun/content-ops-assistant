import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {withEngineLock} from './lock.mjs';
import {throwIfCancelled} from './cancellation.mjs';
import {buildAccountPartition,canonicalAccountPartition,accountSessionKey} from '../engine/MatrixMedia/src/shared/accountPartition.js';
import {getPlatform} from './platforms.mjs';

export function createAccountStore({root,documentsDir=process.env.CONTENT_OPS_DOCUMENTS||path.join(os.homedir(),'Documents')}={}){
  if(!path.isAbsolute(documentsDir))throw Error('本机文稿目录无效');
  const directory=path.join(documentsDir,'MatrixMedia/data/account');
  async function inspect(phone,platform='dy'){
    const p=getPlatform(platform),pt=p.engineName||p.name;if(!p.enabled&&!p.loginEnabled)throw Error('该平台暂未接入');
    if(typeof phone!=='string'||!phone.trim()||/[\0\r\n\/\\]/.test(phone)||!accountSessionKey(phone).trim())throw Error('账号名称无效，请使用以文字或数字开头的名称');
    let files=[];try{files=await fs.readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    const records=[];
    for(const file of files.filter(file=>file.endsWith('.json'))){
      let rows;try{rows=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));}catch{throw Error('已有账号记录无法读取，请先检查账号文件');}
      if(!Array.isArray(rows))throw Error('已有账号记录格式无效，请先检查账号文件');
      records.push(...rows);
    }
    const existing=records.find(row=>row?.pt===pt&&row.phone===phone);
    if(existing){if(pt==='小红书'&&existing.partition&&canonicalAccountPartition(existing.partition,pt)!==buildAccountPartition(phone,pt))throw Error('已有小红书账号记录的分区不一致，请使用新的本机账号名称连接');return existing;}
    const partition=buildAccountPartition(phone,pt);
    if(records.some(row=>row?.pt===pt&&(buildAccountPartition(row.phone,pt)===partition||row.partition===partition)))throw Error('这个名称会与已有账号共用登录状态，请换一个不同前缀的账号名称');
    return null;
  }
  return {
    checkName:inspect,
    async register(phone,platform='dy'){return withEngineLock(root,async()=>{
      throwIfCancelled();const existing=await inspect(phone,platform);if(existing)return existing;
      const p=getPlatform(platform),pt=p.engineName||p.name;
      const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
      await fs.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,date+'.json');let rows=[];
      try{rows=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!Array.isArray(rows))throw Error('已有账号记录格式无效');
      const record={id:randomUUID(),phone,pt,url:p.accountUrl,partition:buildAccountPartition(phone,pt),date,createTime:Date.now(),defaultPublishToDraft:true,useRealBrowser:false};
      const temporary=file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify([...rows,record],null,2)+'\n',{mode:0o600,flag:'wx'});throwIfCancelled();await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
      return record;
    });},
  };
}
