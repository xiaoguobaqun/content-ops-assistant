const {app,BrowserWindow,Menu,ipcMain,dialog,shell,protocol,net,safeStorage}=require('electron');
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {createWorkerClient}=require('./worker-client.cjs');const {createMediaRegistry,executionAllowed,batchExecutionAllowed,platformUrlAllowed,installMediaProtocol}=require('./ipc-policy.cjs');
const {createAiSettingsStore}=require('./ai-settings.cjs');const {profileAnalysisArgs}=require('./profile-ipc.cjs');
const {createAccountRemovalHandler}=require('./account-removal.cjs');
const {selectVideo}=require('./video-selection.cjs');
const {desktopRuntime}=require('./runtime-config.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setName('内容运营助手');
const userDataPath=process.env.CONTENT_OPS_DATA_ROOT?path.join(process.env.CONTENT_OPS_DATA_ROOT,'ui-profile'):path.join(app.getPath('appData'),'content-ops-desktop');
fs.mkdirSync(userDataPath,{recursive:true,mode:0o700});app.setPath('userData',userDataPath);
let config;try{config=JSON.parse(fs.readFileSync(path.join(__dirname,'../desktop-config.json'),'utf8'));}catch{config={projectRoot:path.resolve(__dirname,'..')};}
const runtime=desktopRuntime({config,appRoot:path.resolve(__dirname,'..'),userDataPath:app.getPath('userData'),documentsPath:app.getPath('documents')});
const {projectRoot,dataRoot,node}=runtime;
process.env.CONTENT_OPS_DATA_ROOT=dataRoot;
if(runtime.engineUserData)process.env.CONTENT_OPS_ENGINE_USER_DATA=runtime.engineUserData;
if(runtime.documentsPath)process.env.CONTENT_OPS_DOCUMENTS=runtime.documentsPath;
const aiSettings=createAiSettingsStore({filePath:path.join(dataRoot,'ai-providers.json'),safeStorage});
const indexFile=path.join(__dirname,'ui/index.html'),indexUrl=pathToFileURL(indexFile).toString();
const media=createMediaRegistry(),selected=new Set();let window,worker,quitting=false,stopping=false,restartPromise=null,quitPromise=null,unsavedChanges=false;
const uiError=error=>({error:error.message||'操作未完成，请稍后重试'});
const removeAccount=createAccountRemovalHandler({request:(method,args)=>worker.request(method,args),confirm:async preview=>{
  const platformName={dy:'抖音',sph:'微信视频号',xhs:'小红书'}[preview.platform];
  const answer=await dialog.showMessageBox(window,{type:'warning',title:'移除账号并退出登录',message:'移除这个账号并退出此应用的登录？',detail:`平台：${platformName}\n账号：${preview.phone}\n\n尚未执行的旧任务将作废，重新连接后需重新准备。\n历史记录、人员画像、素材和草稿存储保留。\n不影响手机或日常浏览器的登录状态。`,buttons:['取消','移除并退出登录'],defaultId:0,cancelId:0,noLink:true});
  return answer.response===1;
}});
async function enrichJob(job){const view={...job};if(Array.isArray(view.jobs))view.jobs=await Promise.all(view.jobs.map(enrichJob));for(const [field,url]of[['videoPath','videoUrl'],['coverPath','coverUrl'],['screenshotPath','screenshotUrl']])if(view[field])try{view[url]=await media.issue(view[field]);}catch{}return view;}
async function enrich(data){
  if(!data||typeof data!=='object')return data;const value={...data};
  if(Array.isArray(value.jobs))value.jobs=await Promise.all(value.jobs.map(enrichJob));
  if(value.job)value.job=await enrichJob(value.job);
  if(value.id&&value.videoPath)Object.assign(value,await enrichJob(value));
  if(value.activity?.qrPath){try{value.activity={...value.activity,qrUrl:await media.issue(value.activity.qrPath)};}catch{}}
  if(value.data)value.data=await enrich(value.data);return value;
}
async function send(event,source=worker){const data=await enrich(event);if(source===worker&&!quitting&&!stopping&&window&&!window.isDestroyed())window.webContents.send('desktop:update',data);}
function startWorker(){
  if(quitting)return;
  const client=createWorkerClient({...runtime,node,projectRoot,onEvent:event=>{if(client===worker&&!quitting&&!stopping)send(event,client);},onExit:()=>{if(client===worker&&!quitting&&!stopping)send({type:'service-exit',message:'后台服务已停止，请重新打开应用。未完成的任务请先回查。'},client);}});
  worker=client;
}
function trusted(event){return window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===indexUrl;}
async function choose(kind){
  const video=kind==='video';const result=await dialog.showOpenDialog(window,{title:video?'选择要发布的视频':'选择封面图片',properties:['openFile'],filters:[{name:video?'视频文件':'封面图片',extensions:video?['mp4','mov','m4v','mkv','avi','webm']:['jpg','jpeg','png','webp']}]});
  if(result.canceled||!result.filePaths.length)return null;
  if(video)return selectVideo(result.filePaths,{selected,media});
  const file=await fsp.realpath(result.filePaths[0]);selected.add(file);const stat=await fsp.stat(file);return {path:file,name:path.basename(file),size:stat.size,url:await media.issue(file)};
}
ipcMain.handle('desktop:drop-video',async(event,args)=>{
  if(!trusted(event)||quitting||stopping)return {error:'页面未获得素材操作权限'};
  try{const video=await selectVideo(args?.paths,{selected,media});if(window&&!window.isDestroyed())window.webContents.send('desktop:update',{type:'videoSelected',video});return {ok:true};}
  catch(error){const result=uiError(error);if(window&&!window.isDestroyed())window.webContents.send('desktop:update',{type:'videoDropError',message:result.error});return result;}
});
ipcMain.handle('desktop:request',async(event,method,args={})=>{
  try{
    if(!trusted(event))throw Error('页面未获得操作权限');
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('操作参数无效');
    if(quitting||restartPromise&&method!=='stop')throw Error('正在停止后台操作，请稍候');
    if(method==='setUnsaved'){if(typeof args.hasChanges!=='boolean')throw Error('未保存状态无效');unsavedChanges=args.hasChanges;return {ok:true};}
    if(method==='removeAccount')return await removeAccount(args);
    if(method==='trashTask'){
      const record=await worker.request(args.kind==='batch'?'getBatch':'getJob',{id:args.id});
      const answer=await dialog.showMessageBox(window,{type:'question',title:'移到回收站',message:'将这条本机任务记录移到回收站？',detail:`任务：${record.title}\n\n可在任务记录的回收站恢复。不会删除视频、平台作品或草稿，执行证据保留。`,buttons:['取消','移到回收站'],defaultId:0,cancelId:0,noLink:true});
      return answer.response===1?worker.request('trashTask',{id:record.id}):{canceled:true};
    }
    if(method==='aiSettingsGet')return aiSettings.list();
    if(method==='aiSettingsSave'){if(worker?.busy)throw Error('已有操作正在执行，请等待完成');return aiSettings.save({id:args.id,baseURL:args.baseURL,model:args.model,apiKey:args.apiKey});}
    if(method==='profileAnalyze')return worker.request(method,profileAnalysisArgs(args,aiSettings));
    if(method==='chooseVideo')return choose('video');if(method==='chooseCover')return choose('cover');
    if(method==='prepare'||method==='prepareBatch'){
      if(!selected.has(args.input?.video)||args.input?.cover&&!selected.has(args.input.cover))throw Error('请通过文件选择器选择素材');
      return enrich(await worker.request(method,args));
    }
    if(method==='executeBatch'){
      const batch=await worker.request('getBatch',{id:args.id});
      if(!batch.canExecute)throw Error('该批次没有可执行的未开始任务');if(batch.needsVerification)throw Error('请先回查待核实的平台，再继续其他未开始平台');
      const rows=batch.jobs.map(job=>`${job.platformName} / ${job.phone}：${batch.targetIds.includes(job.id)?'本次保存草稿':job.blockedReason||job.statusLabel}`).join('\n');
      const answer=await dialog.showMessageBox(window,{type:'question',title:'确认多平台草稿',message:batch.attempt?'继续尚未开始的平台？':'确认保存多平台草稿？',detail:`人员：${batch.person.name}\n标题：${batch.title}\n\n${rows}\n\n本次执行 ${batch.targetIds.length} 个平台，依次保存草稿，不发表作品。${batch.requiresUnknownConfirmation?'原待核实结果继续保留，不会重新上传。':''}`,buttons:['取消','确认保存草稿'],defaultId:0,cancelId:0,noLink:true});
      if(answer.response!==1)return {canceled:true};const approval={id:batch.id,digest:batch.digest,attempt:batch.attempt,targetIds:batch.targetIds,confirmed:true,allowUnknown:batch.requiresUnknownConfirmation};
      if(!batchExecutionAllowed(batch,approval))throw Error('批次确认信息无效，请重新查看');
      return worker.request('executeBatch',{id:batch.id,expectedDigest:batch.digest,expectedAttempt:batch.attempt,targetIds:batch.targetIds,allowUnknown:approval.allowUnknown});
    }
    if(method==='execute'){
      const job=await worker.request('getJob',{id:args.id});let approval=null;
      const {getPlatform}=await import('../src/platforms.mjs');const p=getPlatform(job.platform??'dy');
      if(job.mode==='publish'){
        if(!p.publish)throw Error('该平台暂时只开放草稿');
        const visibility={private:'仅自己可见',friends:'好友可见',public:'公开'}[job.visibility];if(!visibility)throw Error('可见范围无效，请重新准备任务');
        const answer=await dialog.showMessageBox(window,{type:'question',title:'确认发布到抖音',message:'确认将这条内容发布到抖音？',detail:`账号：${job.phone}\n标题：${job.title}\n可见范围：${visibility}\n\n执行后会创建平台作品，结果会保存在任务记录中。`,buttons:['取消','确认发布'],defaultId:0,cancelId:0,noLink:true});
        if(answer.response!==1)return {canceled:true};approval={id:job.id,digest:job.inputDigest,confirmed:true};
      }
      if(!executionAllowed(job,approval))throw Error('任务已执行或确认信息已变化，请查看任务记录');
      return worker.request('execute',{id:job.id,expectedDigest:job.inputDigest});
    }
    if(method==='showJob'){await worker.request('getJob',{id:args.id});shell.showItemInFolder(path.join(dataRoot,'jobs',args.id,'job.json'));return {ok:true};}
    if(method==='showLogs'){const file=path.join(dataRoot,'logs');await fsp.mkdir(file,{recursive:true});const error=await shell.openPath(file);if(error)throw Error(error);return {ok:true};}
    if(method==='openPlatform'){
      const job=args.id?await worker.request('getJob',{id:args.id}):null;const {getPlatform}=await import('../src/platforms.mjs');const platform=job?.platform??'dy',url=job?.platformUrl||getPlatform(platform).home;if(!platformUrlAllowed(url,platform))throw Error('平台链接无效');await shell.openExternal(url);return {ok:true};
    }
    if(method==='stop'){
      if(!restartPromise)restartPromise=(async()=>{
        const answer=await dialog.showMessageBox(window,{type:'question',message:'停止当前操作？',detail:'正在执行的任务将保留为待核实。停止后请先回查，避免重复提交。',buttons:['继续等待','停止操作'],defaultId:0,cancelId:0});
        if(answer.response!==1)return {canceled:true};stopping=true;
        try{await worker.stop();if(!quitting)startWorker();return {ok:true};}finally{stopping=false;}
      })().finally(()=>{restartPromise=null;});
      return await restartPromise;
    }
    if(['dashboard','refresh','getJob','getBatch','restoreTask','peopleSave','verify','login','profileGet','profileSave','profilePreview','profileCapabilities','profileCollect','profileConfirm'].includes(method))return enrich(await worker.request(method,args));
    throw Error('不支持这项操作');
  }catch(error){return uiError(error);}
});
function createWindow(){
  window=new BrowserWindow({width:1380,height:940,minWidth:1000,minHeight:720,title:'内容运营助手',backgroundColor:'#F5F7F8',...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:19}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==indexUrl)event.preventDefault();});
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
  window.loadFile(indexFile);window.once('ready-to-show',()=>window.show());
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(window){window.show();window.focus();}});
  app.whenReady().then(async()=>{
    if(!fs.existsSync(node)||!fs.existsSync(path.join(projectRoot,'desktop/service.mjs'))){dialog.showErrorBox('无法启动内容运营助手','找不到本机运行文件，请保留项目目录并重新生成桌面应用。');app.exit(1);return;}
    installMediaProtocol(protocol,media);
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'内容运营助手',submenu:[{role:'about',label:'关于内容运营助手'},{type:'separator'},{role:'hide',label:'隐藏内容运营助手'},{role:'hideOthers',label:'隐藏其他应用'},{type:'separator'},{role:'quit',label:'退出内容运营助手'}]},{label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},{label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放'},{role:'front',label:'显示窗口'}]}]));
    startWorker();createWindow();app.on('activate',()=>{if(window)window.show();});
    if(process.env.CONTENT_OPS_SMOKE_REPORT){
      const timer=setTimeout(()=>app.exit(2),120000);
      try{await require('./installed-check.cjs').checkInstalledApp({window,worker,projectRoot,dataRoot,reportPath:process.env.CONTENT_OPS_SMOKE_REPORT});}
      finally{clearTimeout(timer);await worker.stop();quitting=true;app.exit(0);}
    }
  }).catch(error=>{dialog.showErrorBox('内容运营助手未能启动',error.message);app.exit(1);});
  app.on('before-quit',event=>{
    if(quitting)return;event.preventDefault();if(quitPromise)return;
    quitPromise=(async()=>{if(worker?.busy&&!stopping||unsavedChanges){const answer=await dialog.showMessageBox(window,{type:'question',message:unsavedChanges?'有内容尚未保存，确定退出？':'有操作正在执行，确定退出？',detail:`${unsavedChanges?'未保存的编辑将丢失。':''}退出会停止当前操作，画像分析不会自动重试；未完成的发布任务请先回查。`,buttons:['继续使用','退出'],defaultId:0,cancelId:0});if(answer.response!==1)return;}
      quitting=true;if(restartPromise)await restartPromise;await worker?.stop();app.exit(0);
    })().catch(error=>{quitting=false;dialog.showErrorBox('暂时无法退出',error.message);}).finally(()=>{quitPromise=null;});
  });
}
