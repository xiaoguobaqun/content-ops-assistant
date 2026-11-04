import fs from 'fs';import path from 'path';
import {app} from 'electron';
import {withLoginCancellation} from './cliLogin/loginCancellation.js';
import {buildAccountPartition} from '../../shared/accountPartition.js';
import {withXhsPage,observeXhsAuth} from './xhsSession.js';
import {auditXhsPage,writeXhsCheckpoint,fingerprintXhsFile,readXhsSourceMedia} from './xhsManagedDraft.js';
import {XHS_CREATE_URL,openXhsDraftBox,inspectXhsDraftStorage,inspectXhsPage} from './upLoad/xhsDraftPage.js';
import {validateXhsCompletionCheckpoint,executeSafeXhsCompletion} from './upLoad/xhsCompletionCore.js';
import {bindXhsLocalDraft} from './upLoad/xhsSafeDraft.js';
import {openXhsStoredEditor} from './upLoad/xhsRecovery.js';
import {fillMissingXhsDraftText,readXhsText,readXhsCoverIdentity,uploadXhsCustomCover} from './upLoad/xhsEditor.js';
import {createXhsSaveAction} from './upLoad/xhsControls.js';

export async function completeXhsDraft({phone,expected,screenshot},{withPage=withXhsPage}={}){
 let cp,claim,claimFile,page;const partition=buildAccountPartition(phone,'小红书');
 return withLoginCancellation(async(signal,onBeforeClose)=>{
 try{
  if(!path.isAbsolute(expected?.checkpointPath||''))throw Error('缺少绝对路径的原任务检查点');
  claimFile=expected.checkpointPath+'.completion.lock';claim=fs.openSync(claimFile,'wx',0o600);fs.writeFileSync(claim,JSON.stringify({pid:process.pid,startedAt:Date.now()}));fs.fsyncSync(claim);
  // 必须在取得独占权后重新读取，不能让两个先读过旧阶段的进程重复保存。
  cp=validateXhsCompletionCheckpoint(JSON.parse(fs.readFileSync(expected.checkpointPath,'utf8')),expected,partition);
  const unchanged=async()=>{for(const kind of ['video','cover'])if((await fingerprintXhsFile(cp.files[kind].path)).sha256!==cp.files[kind].sha256)throw Error('本机素材发生变化，停止补全');};
  await unchanged();const source=readXhsSourceMedia(cp.files.video.path);if(['size','width','height'].some(k=>source[k]!==cp.sourceMedia[k])||Math.abs(source.duration-cp.sourceMedia.duration)>0.05)throw Error('原视频媒体信息发生变化');
  return await withPage(partition,async(p,win)=>{
   page=p;const auth=await observeXhsAuth(page,partition),active=()=>{if(win.isDestroyed()||page.isClosed())throw Error('小红书补全已取消，停止后续保存');};
   const stage=name=>{active();cp.stage=name;cp.updatedAt=Date.now();writeXhsCheckpoint(expected.checkpointPath,cp);};
   const audit=()=>auditXhsPage(page,partition,cp);
   const unique=async()=>{const storage=await page.evaluate(inspectXhsDraftStorage),stores=storage.databases.find(d=>d.name==='draft-database-v1'&&d.version===10)?.stores;
    if(stores?.length!==4||!['article-draft','audio-draft','image-draft','video-draft'].every(name=>stores.some(s=>s.name===name&&s.count===(name==='video-draft'?1:0)))||storage.localDrafts.length)throw Error('发现其他草稿或存储结构未知，停止补全');
    return bindXhsLocalDraft(cp,await audit());
   };
   let coverEvidence;
   try{
    await page.goto(XHS_CREATE_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForSelector('input.upload-input[type=file]',{timeout:20000});await page.waitForNetworkIdle({idleTime:500,timeout:8000}).catch(()=>{});
    const own=await auth.read();if(own.ok!==true||own.loggedIn!==true)throw Error('小红书本人鉴权未知，停止补全');await openXhsDraftBox(page);
    await executeSafeXhsCompletion({
     checkCancelled:active,
     bind:async()=>{const record=await unique();if(!cp.targetDraft)cp.targetDraft={keyHash:record.keyHash,media:record.media};stage('completion-bound');},
     open:async()=>{await unique();await openXhsStoredEditor(page,cp,{requireTitle:false});await unique();stage('completion-editor-opened');},
     text:async()=>{await fillMissingXhsDraftText(page,cp);stage('completion-text-checked');},
     cover:async()=>{const record=await unique();if(record.cover?.isUpload===true||record.cover?.isUserSelect===true||record.editorCover?.isUpload===true||record.editorArchive){const identity=await readXhsCoverIdentity(page);if(!cp.coverIdentity||identity!==cp.coverIdentity)throw Error('已有自选封面来源未核实，不自动覆盖');coverEvidence={coverIdentity:identity,sourceCoverSha:cp.files.cover.sha256};}
      else{stage('completion-cover-started');coverEvidence=await uploadXhsCustomCover(page,cp.files.cover.path);}
      if(coverEvidence.sourceCoverSha!==cp.files.cover.sha256)throw Error('封面选择与任务素材不匹配');cp.coverIdentity=coverEvidence.coverIdentity;cp.sourceCoverSha=coverEvidence.sourceCoverSha;stage('completion-cover-checked');},
     inspect:async()=>{const text=await page.evaluate(readXhsText),coverIdentity=await readXhsCoverIdentity(page),record=await unique();return {ok:text.title===cp.title&&text.description===cp.description&&coverIdentity===coverEvidence.coverIdentity,videoIdentity:record.media.fileIdHash,coverIdentity};},
     checkpoint:async evidence=>{await unchanged();Object.assign(cp,evidence);stage('completion-save-ready');},
     save:async()=>{const save=createXhsSaveAction(page,{checkCancelled:active,beforeClick:async()=>{
       await unique();await unchanged();const text=await page.evaluate(readXhsText);if(text.title!==cp.title||text.description!==cp.description||await readXhsCoverIdentity(page)!==cp.coverIdentity)throw Error('保存前文案或封面发生变化');const own=await auth.read();if(own.ok!==true||own.loggedIn!==true)throw Error('保存前本人鉴权未知');stage('save-click-started');
      }});await save();
      const until=Date.now()+20000;let retained;do{active();try{retained=bindXhsLocalDraft(cp,await audit(),{requireContent:true});break;}catch{}await page.waitForTimeout(300);}while(Date.now()<until);
      if(!retained)throw Error('保存后草稿文案与封面尚未确认，禁止再次保存');cp.targetDraft={keyHash:retained.keyHash,media:retained.media,cover:retained.cover,materialHash:retained.materialHash};stage('saved-local-unverified');
     },
    });
    return {ok:true,saved:true,requiresVerification:true,clientTaskId:cp.clientTaskId,message:'本次原草稿已补全并暂存，待独立恢复和保留核验'};
   }catch(error){
    if(screenshot&&!page.isClosed())await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
    const diagnostic=await page.evaluate(inspectXhsPage).catch(()=>null);if(diagnostic)fs.writeFileSync(path.join(path.dirname(expected.checkpointPath),'xhs-completion-diagnostic.json'),JSON.stringify(diagnostic,null,2),{mode:0o600});throw error;
   }finally{await auth.dispose();}
  },{show:true,title:'小红书测试草稿补全',signal,onBeforeClose});
 }catch(error){if(screenshot&&page&&!page.isClosed())await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});return {ok:false,saved:null,requiresVerification:true,message:error.code==='EEXIST'?'草稿补全检查点正被占用，请先检查原进程':error.message};}
 },()=>{if(claim!==undefined){fs.closeSync(claim);if(fs.existsSync(claimFile))fs.unlinkSync(claimFile);}},{app})
 .catch(error=>({ok:false,saved:null,requiresVerification:true,message:error.code==='LOGIN_CANCELLED'?'小红书草稿补全已停止，请先独立回查':error.message}));
}
