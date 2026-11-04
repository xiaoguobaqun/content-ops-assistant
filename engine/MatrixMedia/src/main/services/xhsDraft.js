import fs from 'fs';import path from 'path';
import {buildAccountPartition} from '../../shared/accountPartition.js';
import {withXhsPage,observeXhsAuth} from './xhsSession.js';
import {inspectXhsPage,openXhsDraftBox,inspectXhsDraftStorage,XHS_CREATE_URL} from './upLoad/xhsDraftPage.js';
import {auditXhsPage,writeXhsCheckpoint} from './xhsManagedDraft.js';
import {bindXhsLocalDraft,canReconcileXhsCheckpoint,reconcileXhsSavedDraft} from './upLoad/xhsSafeDraft.js';
import {recoverXhsDraftContent} from './upLoad/xhsRecovery.js';
import ptConfig from '../config/ptConfig.js';

function hasActiveCompletion(file){
 let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw Error('补全占用记录无法读取，保留原状态');}
 if(!Number.isInteger(owner?.pid)||owner.pid<2)throw Error('补全占用进程未知，保留原状态');
 try{process.kill(owner.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw Error('无法核实补全进程状态，保留原状态');}
}

export function validateXhsCheckpoint(checkpoint,expected,partition){
  if(!expected?.clientTaskId||!path.isAbsolute(expected.checkpointPath||'')||checkpoint?.platform!=='xhs'||checkpoint.scope!=='browser-local'||checkpoint.partition!==partition||checkpoint.clientTaskId!==expected.clientTaskId||checkpoint.title!==expected.title||checkpoint.description!==expected.description)throw Error('小红书检查点与目标账号或任务内容不匹配');
  if(!checkpoint.targetDraft?.keyHash||!checkpoint.targetDraft?.materialHash&&!canReconcileXhsCheckpoint(checkpoint)||!checkpoint.sourceMedia||!checkpoint.coverIdentity||!checkpoint.files?.video?.sha256||!checkpoint.files?.cover?.sha256)throw Error('小红书原任务尚未完成文案和自选封面，自动草稿保留待核实；不会重新上传或覆盖');
  return checkpoint;
}
async function withAuthenticatedDraftPage(partition,work,{withPage,screenshot}={}){
  return withPage(partition,async(page,win)=>{
    const auth=await observeXhsAuth(page,partition),checkCancelled=()=>{if(win.isDestroyed()||page.isClosed())throw Error('小红书核验已停止');};
    try{
      await page.goto(XHS_CREATE_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForSelector('input.upload-input[type=file]',{timeout:20000});await page.waitForNetworkIdle({idleTime:500,timeout:8000}).catch(()=>{});
      const own=await auth.read();if(own.ok!==true||own.loggedIn!==true)throw Error('小红书本人鉴权尚未通过，停止核验');
      await openXhsDraftBox(page);await page.waitForFunction(()=>document.body.innerText.includes('草稿存储于当前使用的浏览器本地'),{timeout:10000});checkCancelled();return await work(page,checkCancelled);
    }catch(error){if(screenshot&&!page.isClosed())await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});throw error;}
    finally{await auth.dispose();}
  });
}

export async function queryXhsDraft({phone,inspect,inspectCreate=false,inspectDrafts=false,screenshot,expected},{withPage=withXhsPage}={}){
  const partition=buildAccountPartition(phone,'小红书');
  if(!inspect){
    try{
      if(!path.isAbsolute(expected?.checkpointPath||''))throw Error('缺少小红书任务检查点');
      if(hasActiveCompletion(expected.checkpointPath+'.completion.lock'))throw Error('小红书草稿正在补全，请等待结束后再独立核验');
      let checkpoint=validateXhsCheckpoint(JSON.parse(fs.readFileSync(expected.checkpointPath,'utf8')),expected,partition);
      const recovered=await withAuthenticatedDraftPage(partition,async(page,checkCancelled)=>{
        if(!checkpoint.targetDraft.materialHash){checkCancelled();checkpoint=reconcileXhsSavedDraft(checkpoint,await auditXhsPage(page,partition,checkpoint));}
        return recoverXhsDraftContent(page,checkpoint,{audit:()=>auditXhsPage(page,partition,checkpoint),checkCancelled,capture:screenshot?()=>page.screenshot({path:screenshot,fullPage:true}):undefined,onStage:async()=>writeXhsCheckpoint(expected.checkpointPath,checkpoint)});
      },{withPage,screenshot});
      // 恢复窗口关闭后，再以独立只读窗口证明草稿仍在，禁止把编辑页快照当保留结果。
      const retained=await withAuthenticatedDraftPage(partition,async(page,checkCancelled)=>{checkCancelled();const record=bindXhsLocalDraft(checkpoint,await auditXhsPage(page,partition,checkpoint),{requireContent:true});if(record.keyHash!==recovered.keyHash||record.materialHash!==recovered.materialHash)throw Error('关闭恢复页后本机草稿原样保留尚未核实');return record;},{withPage});
      checkpoint.stage='verified-local';checkpoint.verifiedAt=Date.now();writeXhsCheckpoint(expected.checkpointPath,checkpoint);
      return {ok:true,evidence:{ok:true,preserved:true,platform:'xhs',scope:'browser-local',clientTaskId:checkpoint.clientTaskId,draftKeyHash:retained.keyHash,videoIdentity:retained.media.fileIdHash,coverIdentity:retained.cover.fileIdHash,materialHash:retained.materialHash,sourceVideoSha:checkpoint.files.video.sha256,sourceCoverSha:checkpoint.files.cover.sha256},screenshot,message:'小红书本机草稿已独立恢复核验，并确认关闭恢复页后仍原样保留；清除浏览器数据会删除草稿'};
    }catch(error){return {ok:false,evidence:null,message:error.message,screenshot};}
  }
  return withPage(partition,async page=>{
    const responses=[],pending=[];
    page.on('response',r=>{try{const u=new URL(r.url());if(u.hostname!=='creator.xiaohongshu.com'||!['xhr','fetch'].includes(r.request().resourceType()))return;pending.push(r.json().then(j=>responses.push({path:u.pathname,status:r.status(),keys:Object.keys(j||{}),dataKeys:Object.keys(j?.data||{}),code:typeof j?.code==='number'?j.code:undefined,success:typeof j?.success==='boolean'?j.success:undefined})).catch(()=>{}));}catch{}});
    await page.goto(inspectCreate?ptConfig['小红书'].upload:ptConfig['小红书'].listIndex,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.body&&document.body.innerText.trim().length>20,{timeout:15000}).catch(()=>{});await page.waitForNetworkIdle({idleTime:500,timeout:8000}).catch(()=>{});
    let draftEntryAtOpen;
    if(inspectDrafts){await openXhsDraftBox(page);draftEntryAtOpen=(await page.evaluate(inspectXhsPage)).editControls;await page.waitForNetworkIdle({idleTime:500,timeout:8000}).catch(()=>{});}
    const diagnostic=await page.evaluate(inspectXhsPage);if(inspectDrafts){diagnostic.draftEntryAtOpen=draftEntryAtOpen;diagnostic.storage=await page.evaluate(inspectXhsDraftStorage);diagnostic.localVideo=await auditXhsPage(page,partition,expected||{});}await Promise.allSettled(pending);diagnostic.responses=responses;
    if(screenshot)await page.screenshot({path:screenshot,fullPage:true});return {ok:true,inspection:true,diagnostic,screenshot};
  });
}
