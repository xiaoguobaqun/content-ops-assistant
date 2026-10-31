import fs from 'fs';
import path from 'path';
import {randomUUID} from 'crypto';
import {app,BrowserWindow} from 'electron';
import pie from 'puppeteer-in-electron';
import puppeteer from 'puppeteer-core';
import {buildAccountPartition} from '../../shared/accountPartition.js';
import {readSphDraftBaseline,recoverAndPreserveSphDraft,SPH_CREATE_URL,SPH_LIST_URL} from './upLoad/sphDraftPage.js';
import ptConfig from '../config/ptConfig.js';

export async function querySphDraft({phone,expected,screenshot,inspect=false,inspectCreate=false,inspectWorks=false}){
  const partition=buildAccountPartition(phone,'视频号');
  let checkpoint;
  if(!inspect){
    if(!expected?.clientTaskId||!path.isAbsolute(expected.checkpointPath||''))throw Error('缺少视频号任务检查点');
    try{checkpoint=JSON.parse(fs.readFileSync(expected.checkpointPath,'utf8'));}catch{throw Error('尚未取得本次任务的上传检查点，无法独立恢复；请查看执行原因，不要重新上传');}
    if(checkpoint.clientTaskId!==expected.clientTaskId||checkpoint.partition!==partition||checkpoint.platform!=='sph'||checkpoint.description!==expected.description||checkpoint.shortTitle!==expected.shortTitle||checkpoint.title!==expected.title)throw Error('检查点与目标账号或任务内容不匹配');
  }
  const browser=await pie.connect(app,puppeteer);
  const win=new BrowserWindow({show:false,width:1300,height:900,webPreferences:{partition,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true}});
  let page;const network=[],pendingNetwork=[];
  try{
    page=await pie.getPage(browser,win);
    await page.setUserAgent(ptConfig['视频号'].useragent);
    if(!inspect)page.on('response',response=>{try{const u=new URL(response.url());if(u.hostname!=='channels.weixin.qq.com'||!u.pathname.includes('/post/')||!['xhr','fetch'].includes(response.request().resourceType()))return;pendingNetwork.push(response.json().then(j=>network.push({path:u.pathname,status:response.status(),errCode:j?.errCode??j?.errcode,keys:Object.keys(j||{}),dataKeys:Object.keys(j?.data||{})})).catch(()=>{}));}catch{}});
    if(inspect){
      const requests=[],pending=[];
      const listener=response=>{try{const u=new URL(response.url());if(u.hostname!=='channels.weixin.qq.com'||!['xhr','fetch'].includes(response.request().resourceType())||!/post|draft/.test(u.pathname))return;pending.push(response.json().then(j=>{const data=j?.data||{};requests.push({path:u.pathname,status:response.status(),keys:Object.keys(j||{}),errCode:j?.errCode??j?.errcode,dataKeys:Object.keys(data),arrays:Object.fromEntries(Object.entries(data).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),itemKeys:Array.isArray(data.list)?Object.keys(data.list[0]||{}):[],counts:Object.fromEntries(Object.entries(data).filter(([k,v])=>/count|total|continue|hasmore|offset/i.test(k)&&['string','number','boolean'].includes(typeof v)))});}).catch(()=>{requests.push({path:u.pathname,status:response.status(),json:false});}));}catch{}};
      page.on('response',listener);
      const diagnostic=await readSphDraftBaseline(page);
      if(expected?.title){
        await page.waitForFunction(title=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);return roots.some(r=>(r.textContent||'').includes(title));},{timeout:15000},expected.title);
        diagnostic.target=await page.evaluate(async title=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);const all=sel=>roots.flatMap(r=>[...r.querySelectorAll(sel)]);const parents=e=>{const a=[];for(let n=e;n&&a.length<8;n=n.parentElement)a.push({tag:n.tagName,cls:String(n.className||''),role:n.getAttribute('role')});return a;};return {nodes:all('*').filter(e=>!['SCRIPT','STYLE'].includes(e.tagName)&&((e.textContent||'').includes(title)||/^(编辑|删除)$/.test((e.textContent||'').trim()))&&e.childElementCount<2).sort((a,b)=>a.textContent.length-b.textContent.length).map(e=>({text:e.textContent.slice(0,300),parents:parents(e)})).slice(0,15),images:await Promise.all(all('img').filter(e=>e.src.startsWith('https:')).map(async e=>{let u;try{u=new URL(e.src);}catch{return {cls:e.className};}const key=u.searchParams.get('encfilekey'),identity=key?u.origin+u.pathname+'?encfilekey='+encodeURIComponent(key):u.href,hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));return {cls:e.className,path:u.origin+u.pathname,queryKeys:[...u.searchParams.keys()],id:'sha256:'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),parents:parents(e)};}))};},expected.title);
      }
      await Promise.allSettled(pending);page.off('response',listener);diagnostic.requests=requests;
      if(inspectWorks){await page.goto(SPH_LIST_URL,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);return roots.flatMap(r=>[...r.querySelectorAll('img')]).some(e=>e.getBoundingClientRect().width>0&&e.src.startsWith('https://finder.video.qq.com/'));},{timeout:20000});diagnostic.workImages=await page.evaluate(()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);return roots.flatMap(r=>[...r.querySelectorAll('img')]).filter(e=>e.src.startsWith('https:')).map(e=>{const u=new URL(e.src);return {cls:e.className,path:u.origin+u.pathname,queryKeys:[...u.searchParams.keys()]};}).slice(0,15);});}
      if(inspectCreate){
        await page.goto(SPH_CREATE_URL,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);return roots.some(r=>(r.textContent||'').includes('视频描述'));},{timeout:20000});
        diagnostic.create=await page.evaluate(()=>{
          const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
          const all=selector=>roots.flatMap(r=>[...r.querySelectorAll(selector)]);
          return {rootCount:roots.length,hosts:all('wujie-app').map(e=>e.className),text:roots.map(r=>r.textContent).join(' ').slice(-14000),buttons:all('button,[role="button"]').map(e=>({text:e.textContent,disabled:e.disabled,cls:e.className})),editors:all('[contenteditable],input[type=text],textarea').map(e=>({text:e.textContent,value:e.value,placeholder:e.getAttribute('placeholder'),cls:e.className})),files:all('input[type=file]').map(e=>({accept:e.accept,cls:e.className})),videos:all('video').map(e=>({src:e.currentSrc||e.src})),draftElements:all('*').filter(e=>/草稿|恢复|继续编辑/.test(e.textContent||'')&&e.childElementCount<2).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,200)})).slice(0,25)};
        });
      }
      if(screenshot)await page.screenshot({path:screenshot,fullPage:true});return {ok:true,inspection:true,diagnostic,screenshot};
    }
    const evidence=await recoverAndPreserveSphDraft(page,checkpoint,{withListPage:async read=>{
      const listWindow=new BrowserWindow({show:false,width:1300,height:900,webPreferences:{partition,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true}});
      try{const listPage=await pie.getPage(browser,listWindow);await listPage.setUserAgent(ptConfig['视频号'].useragent);return await read(listPage);}finally{if(!listWindow.isDestroyed())listWindow.destroy();}
    },capture:screenshot?()=>page.screenshot({path:screenshot,fullPage:true}):undefined,onStage:async stage=>{
      checkpoint.stage=stage;const tmp=expected.checkpointPath+'.'+randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(checkpoint));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,expected.checkpointPath);
    }});
    return {ok:true,evidence,screenshot,message:'视频号草稿已独立恢复核验并原样保留'};
  }catch(error){
    if(screenshot&&page)await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
    return {ok:false,evidence:error.evidence||null,message:error.message,screenshot};
  }finally{await Promise.allSettled(pendingNetwork);if(!inspect&&expected?.checkpointPath)try{fs.writeFileSync(path.join(path.dirname(expected.checkpointPath),'sph-query-network.json'),JSON.stringify(network,null,2),{mode:0o600});}catch{}if(!win.isDestroyed())win.destroy();}
}
