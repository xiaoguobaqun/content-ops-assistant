const {spawn}=require('node:child_process');const readline=require('node:readline');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
function createWorkerClient({node,projectRoot,dataRoot=path.join(projectRoot,'.local'),engineUserData,runtimeBin,documentsPath,onEvent=()=>{},onExit=()=>{},stopGraceMs=15000}){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  env.PATH=[path.dirname(node),runtimeBin,...(process.platform==='win32'?[]:['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']),process.env.PATH||''].filter(Boolean).join(path.delimiter);
  env.CONTENT_OPS_DATA_ROOT=dataRoot;
  if(engineUserData)env.CONTENT_OPS_ENGINE_USER_DATA=engineUserData;
  if(documentsPath&&path.isAbsolute(documentsPath))env.CONTENT_OPS_DOCUMENTS=documentsPath;
  const child=spawn(node,[path.join(projectRoot,'desktop/service.mjs')],{cwd:os.tmpdir(),env,stdio:['pipe','pipe','pipe']});
  let sequence=0,closed=false,activity=null,stopPromise=null;const pending=new Map();
  const logDir=path.join(dataRoot,'desktop');fs.mkdirSync(logDir,{recursive:true,mode:0o700});const log=fs.createWriteStream(path.join(logDir,'service.log'),{flags:'a',mode:0o600});child.stderr.pipe(log);
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}
    if(message.event){if(message.event.activity)activity=message.event.activity;onEvent(message.event);return;}
    const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error)):request.resolve(message.result);
  });
  const failed=error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
  child.stdin.on('error',()=>{});
  child.on('error',error=>{if(closed)return;closed=true;failed(Error('后台服务无法启动：'+error.message));onExit();});
  child.on('close',()=>{log.end();if(closed)return;closed=true;failed(Error('后台服务已停止，未完成的任务请先回查'));onExit();});
  return {
    request(method,args={}){if(closed)return Promise.reject(Error('后台服务已停止，请重新打开应用'));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('这项操作暂时没有响应，请查看任务记录后再继续'));},180000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,args})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});},
    get busy(){return activity?.status==='running';},
    stop(){if(stopPromise)return stopPromise;stopPromise=(async()=>{if(!closed){const ended=new Promise(resolve=>child.once('close',resolve));child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),stopGraceMs);await ended;clearTimeout(timer);}if(process.platform==='win32'){const {withWindowsLock}=await import('../src/windows-host.mjs');await withWindowsLock(path.join(dataRoot,'engine.lock.guard'),async()=>{},{waitMs:15000});}})();return stopPromise;},
  };
}
module.exports={createWorkerClient};
