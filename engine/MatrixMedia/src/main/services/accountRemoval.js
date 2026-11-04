import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {buildAccountPartition} from '../../shared/accountPartition.js';

const names={dy:'抖音',sph:'视频号',xhs:'小红书'};
export function createAccountRemoval({accountsDir,backupDir,profileRoot,sessionForPartition}){
  async function inspect({platform,phone}){
    const pt=names[platform];
    if(!pt||typeof phone!=='string'||phone!==phone.trim()||!phone||phone.length>80||/[\x00-\x1f\x7f/\\]/.test(phone)||!phone.split('-')[0].trim())throw Error('平台或账号名称无效');
    const partition=buildAccountPartition(phone,pt);let files=[];
    try{files=(await fs.readdir(accountsDir)).filter(f=>f.endsWith('.json')).sort();}catch(e){if(e.code!=='ENOENT')throw Error('账号记录无法读取');}
    const snapshots=[];
    for(const file of files){
      let raw,rows;
      try{const info=await fs.lstat(path.join(accountsDir,file));if(!info.isFile()||info.isSymbolicLink())throw Error();raw=await fs.readFile(path.join(accountsDir,file),'utf8');rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.some(r=>!r||typeof r.phone!=='string'||typeof r.pt!=='string'))throw Error();}catch{throw Error('账号记录损坏或无法读取，未移除');}
      snapshots.push({file,raw,rows});
    }
    const records=snapshots.flatMap(s=>s.rows),targets=records.filter(r=>r.phone===phone&&r.pt===pt);
    if(!targets.length)throw Error('账号不存在，请刷新列表');
    if(targets.some(r=>r.useRealBrowser===true))throw Error('该账号使用独立浏览器，请先在对应浏览器退出登录；本次未移除');
    if(profileRoot&&['sph','xhs'].includes(platform)){
      const profile=platform==='sph'?path.join(profileRoot,'chrome-sph-login',createHash('sha256').update(partition).digest('hex')):path.join(profileRoot,'chrome-xhs-profile');
      try{await fs.lstat(profile);throw Error('发现独立浏览器登录目录，请先在对应浏览器处理登录；本次未移除');}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    if(targets.some(r=>r.partition&&r.partition!==partition))throw Error('账号登录分区不一致，未移除');
    if(records.some(r=>!(r.phone===phone&&r.pt===pt)&&(r.partition===partition||buildAccountPartition(r.phone,r.pt)===partition)))throw Error('该账号与其他登记共用登录位置，未移除');
    const digest='sha256:'+createHash('sha256').update(JSON.stringify({platform,phone,snapshots:snapshots.map(({file,raw})=>({file,raw}))})).digest('hex');
    return {platform,phone,pt,partition,digest,snapshots};
  }
  async function preview(selection){const {platform,phone,digest}=await inspect(selection);return {ok:true,platform,phone,digest,phase:'preview'};}
  async function remove(selection){
    const checked=await inspect(selection);
    if(selection.expectedDigest!==checked.digest)throw Error('账号记录已变化，请重新确认');
    const {platform,phone,pt,partition}=checked;
    if(platform==='sph'){
      const base=encodeURIComponent(partition)+'.json';
      try{let files=[];try{files=await fs.readdir(backupDir);}catch(e){if(e.code!=='ENOENT')throw e;}for(const file of files)if(file===base||file.startsWith(base+'.tmp'))await fs.rm(path.join(backupDir,file),{force:true});}catch{throw Error('登录恢复备份无法清理，未退出登录或移除登记');}
    }
    try{
      const session=sessionForPartition(partition);
      // 仅清认证，不删除 localStorage/IndexedDB；小红书本机草稿保留在原分区。
      await session.clearStorageData({storages:['cookies']});await session.clearAuthCache();await session.cookies.flushStore();
      if((await session.cookies.get({})).length)throw Error('credentials_remain');
    }catch{throw Error('退出登录未完成，账号登记已保留，请刷新后重试');}
    const current=await inspect(selection);if(current.digest!==checked.digest)throw Error('已退出登录，但账号记录发生变化，请刷新后重新确认移除');
    for(const snapshot of current.snapshots){
      const rows=snapshot.rows.filter(r=>!(r.phone===phone&&r.pt===pt));if(rows.length===snapshot.rows.length)continue;
      const file=path.join(accountsDir,snapshot.file),temporary=file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,file);}catch{throw Error('已退出登录，但账号登记尚未完整移除，请刷新后重试');}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
    }
    return {ok:true,platform,phone,phase:'removed',loggedOut:true};
  }
  return {preview,remove};
}
