import fs from 'fs';
import path from 'path';
import {createHash,randomUUID} from 'crypto';
import {execFileSync} from 'child_process';
import {session} from 'electron';
import {buildAccountPartition} from '../../shared/accountPartition.js';
import {isCreativeStatementNone} from '../../shared/creativeStatement.js';
import {withXhsPage,observeXhsAuth} from './xhsSession.js';
import {fillXhsDraftText,readXhsText,uploadXhsCustomCover,readXhsCoverIdentity,selectXhsVideo} from './upLoad/xhsEditor.js';
import {createXhsSaveAction} from './upLoad/xhsControls.js';
import {auditXhsStoredVideoDrafts} from './upLoad/xhsLocalDraft.js';
import {executeSafeXhsDraft,bindXhsLocalDraft} from './upLoad/xhsSafeDraft.js';
import {XHS_CREATE_URL,readXhsDraftBaseline,inspectXhsPage,inspectXhsDraftStorage} from './upLoad/xhsDraftPage.js';

export async function fingerprintXhsFile(file){
  const hash=createHash('sha256'),stat=fs.statSync(file);if(!stat.isFile())throw Error('素材文件无效');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return {path:file,size:stat.size,sha256:hash.digest('hex')};
}
export function writeXhsCheckpoint(file,data,initial=false){
  const target=initial?file:file+'.'+randomUUID()+'.tmp',fd=fs.openSync(target,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(!initial)fs.renameSync(target,file);
}
export function readXhsSourceMedia(file){
  const data=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration','-show_entries','format=size,duration','-of','json',file],{encoding:'utf8',timeout:15000}));
  const stream=data.streams?.[0],media={size:Number(data.format?.size),width:stream?.width,height:stream?.height,duration:Number(data.format?.duration)};
  if(!media.size||!media.width||!media.height||!Number.isFinite(media.duration)||media.duration<=0)throw Error('本机视频可信媒体信息不可读');return media;
}
export async function auditXhsPage(page,partition,expected){
  const cookies=await session.fromPartition(partition).cookies.get({url:'https://creator.xiaohongshu.com/'});
  const expectedUserId=cookies.find(c=>c.name==='x-user-id-creator.xiaohongshu.com')?.value||'';
  return page.evaluate(auditXhsStoredVideoDrafts,{title:expected.title,description:expected.description,expectedUserId});
}
const fingerprint=fingerprintXhsFile,writeCheckpoint=writeXhsCheckpoint;

/** 与旧发布处理器隔离；只使用标准Electron分区，永不启用Chrome或Cookie桥接。 */
export async function runManagedXhsDraft(v,{withPage=withXhsPage}={}){
  let checkpoint,page,win,coverEvidence;
  const partition=buildAccountPartition(v.phone,'小红书');
  const active=()=>{if(win?.isDestroyed())throw Error('小红书操作已停止，取消后续暂存');};
  const stage=name=>{active();checkpoint.stage=name;checkpoint.updatedAt=Date.now();writeCheckpoint(v.checkpointFile,checkpoint);};
  try{
    if(!v.clientTaskId||!v.phone||v.partition!==partition||!v.draft||v.publish||v.dir||v.publishAt||!path.isAbsolute(v.checkpointFile||'')||!path.isAbsolute(v.file||'')||!path.isAbsolute(v.cover||'')||v.shortTitle||v.tags||String(v.bq||'').trim()||!isCreativeStatementNone(v.creativeStatement)||![...String(v.title||'').trim()].length||[...v.title.trim()].length>20||String(v.description||'').length>1000)throw Error('受保护小红书草稿参数不符合本机任务约束');
    if(fs.existsSync(v.checkpointFile))throw Error('任务检查点已存在，请回查原任务，禁止重复上传');
    const files={video:await fingerprint(v.file),cover:await fingerprint(v.cover)};
    checkpoint={schemaVersion:1,platform:'xhs',scope:'browser-local',clientTaskId:v.clientTaskId,partition,title:v.title.trim(),description:v.description||'',files,stage:'preflight',createdAt:Date.now()};
    writeCheckpoint(v.checkpointFile,checkpoint,true);
    return await withPage(partition,async(p,w)=>{
      page=p;win=w;const auth=await observeXhsAuth(page,partition);
      try{
        checkpoint.sourceMedia=readXhsSourceMedia(v.file);stage('source-probed');
        await page.goto(XHS_CREATE_URL,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForSelector('input.upload-input[type=file]',{timeout:20000});
        await page.waitForNetworkIdle({idleTime:500,timeout:8000}).catch(()=>{});
        const authenticated=await auth.read();if(authenticated.ok!==true||authenticated.loggedIn!==true)throw Error('小红书本人账号鉴权尚未通过，停止上传');
        await executeSafeXhsDraft({
          checkCancelled:active,
          baseline:async()=>{const baseline=await readXhsDraftBaseline(page);checkpoint.baseline=baseline;stage('baseline-checked');return baseline;},
          upload:async()=>{
            await page.goto(XHS_CREATE_URL,{waitUntil:'domcontentloaded',timeout:30000});const input=await page.waitForSelector('input.upload-input[type=file]',{timeout:15000});
            const fresh=await page.evaluate(()=>document.querySelectorAll('input.upload-input[type=file]').length===1&&!document.querySelector('xhs-publish-btn')&&![...document.querySelectorAll('video')].some(e=>e.currentSrc||e.src));if(!fresh)throw Error('小红书创作页含已有内容，停止上传');
            if((await fingerprint(v.file)).sha256!==files.video.sha256||(await fingerprint(v.cover)).sha256!==files.cover.sha256)throw Error('素材发生变化，停止上传');
            stage('upload-started');active();checkpoint.uploadSelectionSha=await selectXhsVideo(page,v.file);if(checkpoint.uploadSelectionSha!==files.video.sha256)throw Error('实际上传选择与视频指纹不匹配');stage('upload-selected');
            await page.waitForFunction(()=>!!document.querySelector('xhs-publish-btn')||!!document.querySelector('input[placeholder*="标题"]'),{timeout:180000});
            await page.waitForNetworkIdle({idleTime:700,timeout:15000}).catch(()=>{});
          },
          text:async()=>{stage('text-started');await fillXhsDraftText(page,checkpoint);stage('text-checked');},
          processing:async()=>{
            await page.waitForFunction(()=>[...document.querySelectorAll('.video-plugin-title-action')].some(e=>(e.textContent||'').includes('重新上传')),{timeout:180000});stage('processing-checked');
            const until=Date.now()+15000;let local;do{active();local=await auditXhsPage(page,partition,checkpoint);if(local.count)break;await page.waitForTimeout(300);}while(Date.now()<until);
            const record=bindXhsLocalDraft(checkpoint,local);checkpoint.targetDraft={keyHash:record.keyHash,media:record.media};stage('automatic-draft-bound');
          },
          cover:async()=>{stage('cover-started');coverEvidence=await uploadXhsCustomCover(page,v.cover);if(coverEvidence.sourceCoverSha!==files.cover.sha256)throw Error('自选封面指纹变化');stage('cover-checked');},
          inspect:async()=>{const text=await page.evaluate(readXhsText),coverIdentity=await readXhsCoverIdentity(page);return {ok:text.title===checkpoint.title&&text.description===checkpoint.description&&coverIdentity===coverEvidence.coverIdentity,videoIdentity:checkpoint.targetDraft.media.fileIdHash,coverIdentity,sourceCoverSha:coverEvidence.sourceCoverSha};},
          checkpoint:async evidence=>{checkpoint={...checkpoint,...evidence};stage('saving');},
          save:async()=>{
            const save=createXhsSaveAction(page,{checkCancelled:active,beforeClick:async()=>{
              const storage=await page.evaluate(inspectXhsDraftStorage),stores=storage.databases.find(d=>d.name==='draft-database-v1')?.stores;
              if(stores?.length!==4||stores.some(s=>s.count!==(s.name==='video-draft'?1:0))||storage.localDrafts.length)throw Error('暂存前发现其他草稿或状态未知，停止以免覆盖');
              bindXhsLocalDraft(checkpoint,await auditXhsPage(page,partition,checkpoint));
              const text=await page.evaluate(readXhsText);if(text.title!==checkpoint.title||text.description!==checkpoint.description||await readXhsCoverIdentity(page)!==checkpoint.coverIdentity||(await fingerprint(v.file)).sha256!==files.video.sha256||(await fingerprint(v.cover)).sha256!==files.cover.sha256)throw Error('暂存前内容或素材发生变化');
              const own=await auth.read();if(own.ok!==true||own.loggedIn!==true)throw Error('暂存前本人鉴权未知');stage('save-click-started');
            }});await save();
            const until=Date.now()+20000;let local,record;do{active();local=await auditXhsPage(page,partition,checkpoint);try{record=bindXhsLocalDraft(checkpoint,local,{requireContent:true});break;}catch{}await page.waitForTimeout(300);}while(Date.now()<until);
            if(!record)throw Error('暂存后本机草稿内容尚未完整匹配，不自动再次点击');checkpoint.localDraft=local;checkpoint.targetDraft={keyHash:record.keyHash,media:record.media,cover:record.cover,materialHash:record.materialHash};stage('saved-local-unverified');
          },
        });
        return {exitCode:4,status:'abnormal',outcome:'draft_unverified',message:'小红书本机草稿待独立恢复核验'};
      }catch(error){
        const dir=path.dirname(v.checkpointFile);await page.screenshot({path:path.join(dir,'xhs-diagnostic.png'),fullPage:true}).catch(()=>{});
        const diagnostic=await page.evaluate(inspectXhsPage).catch(()=>null);
        if(diagnostic)diagnostic.structure=await page.evaluate(()=>{const parents=e=>{const a=[];for(let n=e;n&&a.length<5;n=n.parentElement)a.push({tag:n.tagName,cls:String(n.className||'')});return a;};return {labels:[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&['设置封面','本地上传','上传封面','上传图片','确定','完成','确认'].includes((e.textContent||'').trim())).map(e=>({text:e.textContent,parents:parents(e)})),backgrounds:[...document.querySelectorAll('*')].filter(e=>/url\(/.test(getComputedStyle(e).backgroundImage)&&e.getBoundingClientRect().width>50).map(e=>({tag:e.tagName,cls:String(e.className||''),parents:parents(e)}))};}).catch(()=>null);
        if(diagnostic){diagnostic.responses=auth.diagnostic;const client=await page.target().createCDPSession();try{await client.send('DOM.enable');const {nodes}=await client.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});diagnostic.closedControls=nodes.filter(n=>['BUTTON','XHS-PUBLISH-BTN'].includes(n.nodeName)).map(n=>{const attrs={};for(let i=0;i<(n.attributes||[]).length;i+=2)if(['class','type','disabled','role','aria-label','save-text','submit-text','save-disabled','submit-disabled'].includes(n.attributes[i]))attrs[n.attributes[i]]=n.attributes[i+1];return {tag:n.nodeName,attrs,text:(n.children||[]).filter(x=>x.nodeType===3).map(x=>x.nodeValue).join('')};});}finally{await client.detach();}fs.writeFileSync(path.join(dir,'xhs-diagnostic.json'),JSON.stringify(diagnostic,null,2),{mode:0o600});}
        throw error;
      }finally{await auth.dispose();}
    },{show:true,title:'小红书测试素材草稿'});
  }catch(error){
    if(page&&!page.isClosed()){
      const dir=path.dirname(v.checkpointFile);await page.screenshot({path:path.join(dir,'xhs-diagnostic.png'),fullPage:true}).catch(()=>{});
      const diagnostic=await page.evaluate(inspectXhsPage).catch(()=>null);if(diagnostic)fs.writeFileSync(path.join(dir,'xhs-diagnostic.json'),JSON.stringify(diagnostic,null,2),{mode:0o600});
    }
    return {exitCode:4,status:'abnormal',outcome:'draft_unknown',message:error.message};
  }
}
