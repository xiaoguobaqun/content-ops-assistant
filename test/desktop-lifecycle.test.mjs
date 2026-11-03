import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter,once} from 'node:events';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
const require=createRequire(import.meta.url),desktopRequire=createRequire(new URL('../desktop/main.cjs',import.meta.url)),root=fileURLToPath(new URL('../',import.meta.url));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const appDirectories=[];test.after(async()=>{for(const directory of appDirectories)await fs.rm(directory,{recursive:true,force:true});});
async function nativeFixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-first-start-'));appDirectories.push(directory);
  const app=new EventEmitter();Object.assign(app,{setName(){},setPath(_name,value){assert.ok(existsSync(value),'native path override must exist before first startup');},getPath:()=>directory,requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){},exit(){app.exited=true;}});
  const protocol={registerSchemesAsPrivileged(){},registerFileProtocol:()=>true};const handlers=new Map();let handler,window;const workers=[],messages=[];
  class Window extends EventEmitter{constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:pathToFileURL(path.join(root,'desktop/ui/index.html')).href},setWindowOpenHandler(){},send:(_channel,event)=>messages.push(event)});}isDestroyed(){return false;}loadFile(){}show(){}focus(){}hide(){}}
  let release;const stopped=new Promise(resolve=>release=resolve);
  const startupErrors=[];const electron={app,BrowserWindow:Window,protocol,Menu:{setApplicationMenu(){},buildFromTemplate:()=>[]},ipcMain:{handle:(channel,callback)=>{handlers.set(channel,callback);if(channel==='desktop:request')handler=callback;}},dialog:{showMessageBox:async()=>({response:1}),showErrorBox:(_title,message)=>startupErrors.push(message)},shell:{}};
  const workerModule={createWorkerClient:options=>{const worker={options,busy:false,stops:0,request:async()=>({}),stop(){this.stops++;return workers.indexOf(this)===0?stopped:Promise.resolve();}};workers.push(worker);return worker;}};
  const source=await fs.readFile(path.join(root,'desktop/main.cjs'),'utf8');
  vm.runInNewContext(source,{require:name=>name==='electron'?electron:name==='./worker-client.cjs'?workerModule:name==='./ai-settings.cjs'?{createAiSettingsStore:()=>({list:()=>[],save:()=>({}),resolve:()=>{throw Error('未配置');}})}:desktopRequire(name),__dirname:path.join(root,'desktop'),process:{...process,env:{...process.env,CONTENT_OPS_NODE:process.execPath,CONTENT_OPS_DATA_ROOT:directory}},console});
  await tick();assert.deepEqual(startupErrors,[],'native startup must use the explicitly configured fixture runtime');const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};return {app,workers,messages,release,request:(method,args)=>handler(event,method,args),drop:args=>{assert.ok(handlers.has('desktop:drop-video'));return handlers.get('desktop:drop-video')(event,args);}};
}
test('concurrent stop requests share one restart and ignore events from the retired worker',async()=>{
  const f=await nativeFixture();const first=f.request('stop'),second=f.request('stop');await tick();f.release();await Promise.all([first,second]);
  assert.equal(f.workers.length,2);assert.equal(f.workers[0].stops,1);
  f.workers[0].options.onEvent({type:'retired'});f.workers[0].options.onExit();await tick();assert.equal(f.messages.length,0);
});
test('quitting during a pending stop cannot restart a new worker',async()=>{
  const f=await nativeFixture();const pending=f.request('stop');await tick();f.app.emit('before-quit',{preventDefault(){}});await tick();f.release();await pending;await tick();
  assert.equal(f.workers.length,1);assert.equal(f.app.exited,true);
});
test('native batch confirmation names the person and all targets and ignores renderer-supplied scope',async()=>{
 const f=await nativeFixture(),calls=[];const batch={kind:'batch',id:'batch',person:{name:'人员示例'},title:'合成内容',mode:'draft',canExecute:true,attempt:0,digest:'stored',targetIds:['dy-child'],jobs:[{id:'dy-child',platformName:'抖音',phone:'抖音示例',statusLabel:'待执行'},{id:'xhs-child',platformName:'小红书',phone:'小红书示例',blockedReason:'待验收，本次不会执行'}]};
 f.workers[0].request=async(method,args)=>{calls.push({method,args});return method==='getBatch'?batch:{activity:{status:'running'}};};
 const result=await f.request('executeBatch',{id:'batch',targetIds:['xhs-child'],expectedDigest:'forged'});assert.equal(result.activity.status,'running');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)),{id:'batch',expectedDigest:'stored',expectedAttempt:0,targetIds:['dy-child']});
});
test('native account removal cannot be called without confirmation or enlarge the approved scope',async()=>{
 const f=await nativeFixture(),calls=[];const digest='sha256:'+'a'.repeat(64);
 f.workers[0].request=async(method,args)=>{calls.push({method,args});return method==='accountRemovalPreview'?{ok:true,platform:'dy',phone:'合成账号',digest}:{activity:{status:'running'}};};
 assert.match((await f.request('accountRemovalPreview',{platform:'dy',phone:'合成账号'})).error,/不支持/);assert.equal(calls.length,0);
 const result=await f.request('removeAccount',{platform:'dy',phone:'合成账号',expectedDigest:'forged'});assert.equal(result.activity.status,'running');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{method:'accountRemovalPreview',args:{platform:'dy',phone:'合成账号'}},{method:'removeAccount',args:{platform:'dy',phone:'合成账号',expectedDigest:digest}}]);
});
test('stdin EOF cancels an active service child instead of waiting for it to publish',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ops-eof-'));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const processUrl=pathToFileURL(path.join(root,'src/process.mjs')).href,cancellationUrl=pathToFileURL(path.join(root,'src/cancellation.mjs')).href;
  const core=path.join(temporary,'core.mjs');
  await fs.writeFile(core,`import {runProcess} from ${JSON.stringify(processUrl)};import {withCancellation} from ${JSON.stringify(cancellationUrl)};export function createDesktopService({signal}){let pending;return {handle:async()=>{let spawned;const ready=new Promise(resolve=>spawned=resolve);pending=withCancellation(signal,()=>runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{onSpawn:pid=>spawned({pid})})).catch(()=>{});return ready;},waitForIdle:()=>pending};}`);
  const entry=path.join(temporary,'service.mjs');const source=await fs.readFile(path.join(root,'desktop/service.mjs'),'utf8');await fs.writeFile(entry,source.replace("import('./service-core.mjs')",`import(${JSON.stringify(pathToFileURL(core).href)})`));
  const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});let descendant;const closed=once(child,'close');const lines=readline.createInterface({input:child.stdout});
  let result;const ready=new Promise(resolve=>result=resolve);lines.on('line',line=>{const message=JSON.parse(line);if(message.result)result(message.result);});
  const timer=setTimeout(()=>result(null),2000);try{
    child.stdin.write(JSON.stringify({id:1,method:'execute'})+'\n');const response=await ready;assert.ok(response,'service fixture must start a real child');descendant=response.pid;child.stdin.end();
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},1500);await closed;clearTimeout(timeout);assert.equal(timedOut,false,'EOF must actively cancel the child');assert.throws(()=>process.kill(descendant,0),{code:'ESRCH'});
  }finally{clearTimeout(timer);try{child.kill('SIGKILL');}catch{}if(descendant)try{process.kill(process.platform==='win32'?descendant:-descendant,'SIGKILL');}catch{}lines.close();}
});
test('only dedicated native drop can authorize a path; ordinary renderer requests cannot',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-drop-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'synthetic.mp4');await fs.writeFile(file,'fixture');const f=await nativeFixture();
 assert.match((await f.request('dropVideo',{paths:[file]})).error,/不支持/);assert.match((await f.request('prepare',{input:{video:file}})).error,/选择/);
 const real=await fs.realpath(file);await f.drop({paths:[file]});assert.ok(f.messages.some(e=>e.type==='videoSelected'&&e.video.path===real));const result=await f.request('prepare',{input:{video:real}});assert.equal(result.error,undefined);
});
