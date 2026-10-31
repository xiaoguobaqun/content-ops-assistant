const {app,BrowserWindow,Menu,ipcMain,dialog,shell,protocol,net}=require('electron');
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {createWorkerClient}=require('./worker-client.cjs');const {createMediaRegistry,executionAllowed,platformUrlAllowed,installMediaProtocol}=require('./ipc-policy.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setName('内容运营助手');app.setPath('userData',path.join(app.getPath('appData'),'content-ops-desktop'));
let config;try{config=JSON.parse(fs.readFileSync(path.join(__dirname,'../desktop-config.json'),'utf8'));}catch{config={projectRoot:path.resolve(__dirname,'..')};}
const projectRoot=config.projectRoot;
const node=config.node||path.join(projectRoot,'.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node');
const indexFile=path.join(__dirname,'ui/index.html'),indexUrl=pathToFileURL(indexFile).toString();
const media=createMediaRegistry(),selected=new Set();let window,worker,quitting=false,stopping=false,restartPromise=null,quitPromise=null;
const uiError=error=>({error:error.message||'操作未完成，请稍后重试'});
async function enrichJob(job){const view={...job};for(const [field,url]of[['videoPath','videoUrl'],['coverPath','coverUrl'],['screenshotPath','screenshotUrl']])if(view[field])try{view[url]=await media.issue(view[field]);}catch{}return view;}
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
  const client=createWorkerClient({node,projectRoot,documentsPath:app.getPath('documents'),onEvent:event=>{if(client===worker&&!quitting&&!stopping)send(event,client);},onExit:()=>{if(client===worker&&!quitting&&!stopping)send({type:'service-exit',message:'后台服务已停止，请重新打开应用。未完成的任务请先回查。'},client);}});
  worker=client;
}
function trusted(event){return window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===indexUrl;}
async function choose(kind){
  const video=kind==='video';const result=await dialog.showOpenDialog(window,{title:video?'选择要发布的视频':'选择封面图片',properties:['openFile'],filters:[{name:video?'视频文件':'封面图片',extensions:video?['mp4','mov','m4v','mkv','avi','webm']:['jpg','jpeg','png','webp']}]});
  if(result.canceled||!result.filePaths.length)return null;
  const file=await fsp.realpath(result.filePaths[0]);selected.add(file);const stat=await fsp.stat(file);return {path:file,name:path.basename(file),size:stat.size,url:await media.issue(file)};
}
ipcMain.handle('desktop:request',async(event,method,args={})=>{
  try{
    if(!trusted(event))throw Error('页面未获得操作权限');
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('操作参数无效');
    if(quitting||restartPromise&&method!=='stop')throw Error('正在停止后台操作，请稍候');
    if(method==='chooseVideo')return choose('video');if(method==='chooseCover')return choose('cover');
    if(method==='prepare'){
      if(!selected.has(args.input?.video)||args.input?.cover&&!selected.has(args.input.cover))throw Error('请通过文件选择器选择素材');
      return enrich(await worker.request(method,args));
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
    if(method==='showJob'){await worker.request('getJob',{id:args.id});shell.showItemInFolder(path.join(projectRoot,'.local/jobs',args.id,'job.json'));return {ok:true};}
    if(method==='showLogs'){const file=path.join(projectRoot,'.local/logs');await fsp.mkdir(file,{recursive:true});const error=await shell.openPath(file);if(error)throw Error(error);return {ok:true};}
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
    if(['dashboard','refresh','getJob','verify','login'].includes(method))return enrich(await worker.request(method,args));
    throw Error('不支持这项操作');
  }catch(error){return uiError(error);}
});
function createWindow(){
  window=new BrowserWindow({width:1380,height:940,minWidth:1000,minHeight:720,title:'内容运营助手',backgroundColor:'#F5F7F8',titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:19},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
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
  }).catch(error=>{dialog.showErrorBox('内容运营助手未能启动',error.message);app.exit(1);});
  app.on('before-quit',event=>{
    if(quitting)return;event.preventDefault();if(quitPromise)return;
    quitPromise=(async()=>{if(worker?.busy&&!stopping){const answer=await dialog.showMessageBox(window,{type:'question',message:'有操作正在执行，确定退出？',detail:'退出会停止当前操作。重开应用后请先回查任务结果。',buttons:['继续运行','退出'],defaultId:0,cancelId:0});if(answer.response!==1)return;}
      quitting=true;if(restartPromise)await restartPromise;await worker?.stop();app.exit(0);
    })().catch(error=>{quitting=false;dialog.showErrorBox('暂时无法退出',error.message);}).finally(()=>{quitPromise=null;});
  });
}
