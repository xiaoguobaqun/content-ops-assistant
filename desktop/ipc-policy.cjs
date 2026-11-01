const fs=require('node:fs/promises');const {randomUUID}=require('node:crypto');const path=require('node:path');
function createMediaRegistry(){
  const files=new Map(),tokens=new Map();
  return {
    async issue(file){if(typeof file!=='string'||!path.isAbsolute(file))throw Error('媒体路径无效');const real=await fs.realpath(file);const st=await fs.stat(real);if(!st.isFile())throw Error('媒体文件不可用');let token=tokens.get(real);if(!token){token=randomUUID();tokens.set(real,token);files.set(token,real);}return `app-media://asset/${token}/${encodeURIComponent(path.basename(real))}`;},
    resolve(value){try{const url=new URL(value);if(url.protocol!=='app-media:'||url.hostname!=='asset')return null;const parts=url.pathname.split('/').filter(Boolean);if(parts.length!==2)return null;return files.get(parts[0])||null;}catch{return null;}},
  };
}
function executionAllowed(job,approval){
  if(job.batchId)return false;
  if(job.state!=='prepared')return false;
  const platform=job.platform===undefined?'dy':job.platform;
  if(platform==='sph')return job.mode==='draft'&&job.visibility==='unknown';
  if(platform!=='dy')return false;
  if(job.mode==='draft')return true;
  return job.mode==='publish'&&approval?.confirmed===true&&approval.id===job.id&&approval.digest===job.inputDigest;
}
function batchExecutionAllowed(batch,approval){
  return batch?.kind==='batch'&&batch.mode==='draft'&&batch.canExecute===true&&!batch.needsVerification&&approval?.confirmed===true&&approval.id===batch.id&&approval.digest===batch.digest&&approval.attempt===batch.attempt&&Array.isArray(batch.targetIds)&&batch.targetIds.length>0&&JSON.stringify(batch.targetIds)===JSON.stringify(approval.targetIds)&&(!batch.requiresUnknownConfirmation||approval.allowUnknown===true);
}
function platformUrlAllowed(value,platform='dy'){try{const url=new URL(value),hosts={dy:['creator.douyin.com','www.douyin.com','douyin.com'],sph:['channels.weixin.qq.com'],xhs:['creator.xiaohongshu.com']};return url.protocol==='https:'&&!!hosts[platform]?.includes(url.hostname)&&!url.username&&!url.password;}catch{return false;}}
function installMediaProtocol(protocol,registry){
  const installed=protocol.registerFileProtocol('app-media',(request,callback)=>{const file=registry.resolve(request.url);callback(file?{path:file}:{error:-6});});
  if(!installed)throw Error('无法启用本机媒体预览');
}
module.exports={createMediaRegistry,executionAllowed,batchExecutionAllowed,platformUrlAllowed,installMediaProtocol};
