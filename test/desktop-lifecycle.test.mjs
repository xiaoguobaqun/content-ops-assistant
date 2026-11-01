import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter,once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function nativeFixture(){
  const app=new EventEmitter();Object.assign(app,{setName(){},setPath(){},getPath:()=>os.tmpdir(),requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){},exit(){app.exited=true;}});
  const protocol={registerSchemesAsPrivileged(){},registerFileProtocol:()=>true};let handler,window;const workers=[],messages=[];
  class Window extends EventEmitter{constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{url:pathToFileURL(path.join(root,'desktop/ui/index.html')).href},setWindowOpenHandler(){},send:(_channel,event)=>messages.push(event)});}isDestroyed(){return false;}loadFile(){}show(){}focus(){}hide(){}}
  let release;const stopped=new Promise(resolve=>release=resolve);
  const electron={app,BrowserWindow:Window,protocol,Menu:{setApplicationMenu(){},buildFromTemplate:()=>[]},ipcMain:{handle:(_channel,callback)=>handler=callback},dialog:{showMessageBox:async()=>({response:1})},shell:{}};
  const workerModule={createWorkerClient:options=>{const worker={options,busy:false,stops:0,request:async()=>({}),stop(){this.stops++;return workers.indexOf(this)===0?stopped:Promise.resolve();}};workers.push(worker);return worker;}};
  const source=await fs.readFile(path.join(root,'desktop/main.cjs'),'utf8');
  vm.runInNewContext(source,{require:name=>name==='electron'?electron:name==='./worker-client.cjs'?workerModule:name==='./ipc-policy.cjs'?require('../desktop/ipc-policy.cjs'):require(name),__dirname:path.join(root,'desktop'),process,console});
  await tick();const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};return {app,workers,messages,release,request:(method,args)=>handler(event,method,args)};
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
  }finally{clearTimeout(timer);try{child.kill('SIGKILL');}catch{}if(descendant)try{process.kill(-descendant,'SIGKILL');}catch{}lines.close();}
});
