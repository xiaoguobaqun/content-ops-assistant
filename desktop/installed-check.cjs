const fs=require('node:fs/promises');const path=require('node:path');
function rendererReady(webContents,{timeoutMs=30000}={}){
  return webContents.executeJavaScript(`(async()=>{const until=Date.now()+${Number(timeoutMs)};while(Date.now()<until){if(document.querySelector('#choose-video')&&typeof window.contentOps?.invoke==='function'){try{const data=await window.contentOps.invoke('dashboard');if(data?.protocolVersion===1)return true;}catch{}}await new Promise(r=>setTimeout(r,25));}return false;})()`);
}
async function waitForStartup(worker,{timeoutMs=90000,pollMs=100}={}){
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){const data=await worker.request('dashboard');if(data.checkedAt!=null&&data.activity?.status!=='running')return data;await new Promise(r=>setTimeout(r,pollMs));}
  throw Error('首次运行环境检查未完成');
}
async function checkInstalledApp({window,worker,projectRoot,dataRoot,reportPath}){
  if(!path.isAbsolute(reportPath))throw Error('诊断报告路径无效');
  let result;
  try{
    if(window.webContents.isLoading())await new Promise((resolve,reject)=>{window.webContents.once('did-finish-load',resolve);window.webContents.once('did-fail-load',()=>reject(Error('界面载入失败')));});
    const renderer=await rendererReady(window.webContents);const dashboard=await waitForStartup(worker);
    const {health,engineHelp:help}=await worker.request('runtimeCheck');
    const checks={renderer,worker:dashboard.protocolVersion===1,engine:health.ok&&/publish|发布/.test(help),media:health.checks.filter(c=>['ffmpeg','ffprobe'].includes(c.name)).every(c=>c.ok)};
    result={ok:Object.values(checks).every(Boolean),checks,dataRoot,projectRoot};
  }catch{result={ok:false,checks:{},dataRoot,projectRoot};}
  await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(result,null,2));
  return result;
}
module.exports={checkInstalledApp,rendererReady,waitForStartup};
