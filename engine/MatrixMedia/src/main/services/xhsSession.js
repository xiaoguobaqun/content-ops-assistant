import {app,BrowserWindow} from 'electron';
import pie from 'puppeteer-in-electron';
import puppeteer from 'puppeteer-core';
import ptConfig from '../config/ptConfig.js';

/** 独立窗口复用引擎标准分区，无会话导出/迁移。 */
export async function withXhsPage(partition,read,{show=false,title='小红书账号验证',signal,onBeforeClose}={}){
  if(signal?.aborted)throw signal.reason;
  const browser=await pie.connect(app,puppeteer);if(signal?.aborted)throw signal.reason;
  // 独立CLI会在最后一个探测窗口关闭时默认退出；保留进程直到调用方写完回执。
  const keepCliAlive=()=>{};app.on('window-all-closed',keepCliAlive);
  const win=new BrowserWindow({title,show,width:1200,height:860,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  const stop=()=>{if(!win.isDestroyed())win.destroy();};signal?.addEventListener('abort',stop,{once:true});
  try{const page=await pie.getPage(browser,win);await page.setUserAgent(ptConfig['小红书'].useragent);await page.setCacheEnabled(false);if(signal?.aborted)throw signal.reason;return await read(page,win);}
  finally{onBeforeClose?.();signal?.removeEventListener('abort',stop);if(!win.isDestroyed())win.destroy();app.removeListener('window-all-closed',keepCliAlive);}
}

/** 响应正文和会话ID只在进程内比较；对外仅保留布尔证据、字段名及无参数路径。 */
export async function observeXhsAuth(page,partition){
  const {session}=await import('electron');
  const {classifyXhsAuthResponse}=await import('../../shared/xhsAuth.js');
  let verdict=null;const diagnostic=[],pending=[];
  const listener=response=>{
    try{const u=new URL(response.url());if(u.origin!=='https://creator.xiaohongshu.com'||!['xhr','fetch'].includes(response.request().resourceType()))return;
      const task=(async()=>{let j;try{j=await response.json();}catch{return;}
        const cookies=await session.fromPartition(partition).cookies.get({url:ptConfig['小红书'].index});
        const own=cookies.find(c=>c.name==='x-user-id-creator.xiaohongshu.com')?.value||'';
        const probe=classifyXhsAuthResponse({url:response.url(),status:response.status(),payload:j,expectedUserId:own,fromCache:response.fromCache(),fromServiceWorker:response.fromServiceWorker()});
        diagnostic.push({path:u.pathname,status:response.status(),code:typeof j?.code==='number'?j.code:undefined,success:typeof j?.success==='boolean'?j.success:undefined,keys:Object.keys(j||{}),dataKeys:Object.keys(j?.data||{}),dataFields:Object.fromEntries(Object.entries(j?.data||{}).slice(0,20).map(([k,v])=>[k,v&&typeof v==='object'?Object.keys(v).slice(0,20):typeof v])),identityCookiePresent:!!own,fromCache:response.fromCache(),fromServiceWorker:response.fromServiceWorker(),ownAccountMatched:probe.ok&&probe.loggedIn===true});
        if(probe.ok)verdict=probe;
      })().catch(()=>{});pending.push(task);
    }catch{}
  };
  page.on('response',listener);
  return {
    async read(){
      let u;try{u=new URL(page.url());}catch{return {ok:false,reason:'小红书页面状态未知'};}
      if(u.origin!=='https://creator.xiaohongshu.com')return {ok:false,reason:'小红书页面地址未知'};
      if(u.pathname==='/login')return {ok:true,loggedIn:false,reason:'请完成小红书本人登录'};
      if(verdict?.ok&&(/^\/new\//.test(u.pathname)||u.pathname==='/publish/publish'))return verdict;
      return {ok:false,reason:'尚未取得小红书本人信息的有效鉴权响应'};
    },
    diagnostic,
    async dispose(){page.off('response',listener);await Promise.allSettled(pending);},
  };
}

export async function probeXhsSession(partition,timeoutMs=12000){
  try{return await withXhsPage(partition,async page=>{const observer=await observeXhsAuth(page,partition);try{
    await page.goto(ptConfig['小红书'].index,{waitUntil:'domcontentloaded',timeout:timeoutMs});const deadline=Date.now()+timeoutMs;
    do{const probe=await observer.read();if(probe.ok)return probe;await page.waitForTimeout(300);}while(Date.now()<deadline);
    return {ok:false,reason:'小红书登录状态尚未核实'};
  }finally{await observer.dispose();}});}catch{return {ok:false,reason:'小红书鉴权页面暂时无法读取'};}
}
