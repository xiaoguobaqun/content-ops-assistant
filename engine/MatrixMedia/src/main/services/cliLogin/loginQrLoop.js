/** 首次立即抓取，未就绪时短间隔重试；等待上一轮结束后才安排下一轮。 */
export function startLoginQrLoop({capture,retryMs=1000,refreshMs=10000,setTimer=setTimeout,clearTimer=clearTimeout}){
  let stopped=false,timer;
  const run=async()=>{
    if(stopped)return;let ready=false;
    try{ready=await capture();}catch{}
    if(!stopped)timer=setTimer(run,ready?refreshMs:retryMs);
  };
  timer=setTimer(run,0);
  return ()=>{stopped=true;clearTimer(timer);};
}
/** 登录所需DOM就绪即可继续，不让统计/背景资源拖住二维码；关闭时释放监听。 */
export function loadLoginDocument(win,url,{reload=false}={}){
  return new Promise((resolve,reject)=>{
    let done=false;
    const cleanup=()=>{win.webContents.removeListener('dom-ready',ready);win.removeListener('closed',closed);};
    const ready=()=>{if(done)return;done=true;cleanup();resolve();};
    const failed=error=>{if(done)return;done=true;cleanup();reject(error);};
    const closed=()=>failed(Error('登录窗口已关闭'));
    win.webContents.once('dom-ready',ready);win.once('closed',closed);
    try{
      if(reload)win.webContents.reloadIgnoringCache();
      else Promise.resolve(win.loadURL(url)).then(ready,failed);
    }catch(error){failed(error);}
  });
}

/** 登录组件分包下载失败会留下空白卡片；仅在二维码出现前绕过资源缓存重载一次。 */
export function createLoginPageRecovery({reload,onFailure,isActive=()=>true}){
  let pending=false,retried=false,ready=false,reloading=false,failed=false;
  return {
    onConsoleMessage(message){
      if(isActive()&&!ready&&!reloading&&!failed&&/\bChunkLoadError\b|Loading (?:CSS )?chunk \S+ failed\b/i.test(String(message)))pending=true;
    },
    async afterCapture(hasQr){
      if(!isActive()||failed)return false;
      if(hasQr){ready=true;pending=false;return true;}
      if(ready||!pending||reloading)return false;
      pending=false;
      if(retried){failed=true;await onFailure();return false;}
      retried=true;reloading=true;
      try{await reload();}
      catch{if(isActive()){failed=true;await onFailure();}}
      finally{reloading=false;}
      return false;
    },
  };
}
