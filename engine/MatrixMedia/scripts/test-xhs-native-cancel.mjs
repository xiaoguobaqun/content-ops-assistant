import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {buildSync} from 'esbuild';

// 本机 Electron 终止经过 app.before-quit；单独 Node 信号测试不能代替此运行时契约。
test('native Electron cancellation completes QR cleanup before exiting for signals and app quit',async t=>{
  if(process.platform!=='darwin')return t.skip('本机桌面验收面向macOS');
  const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-native-stop-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const helper=path.join(dir,'cancellation.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/cliLogin/loginCancellation.js')],bundle:true,platform:'node',format:'cjs',outfile:helper});
  const electron=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  for(const stopSignal of ['SIGINT','SIGTERM','app-quit','programmatic-close']){
    const work=path.join(dir,stopSignal);await fs.mkdir(work);const qr=path.join(work,'qr.png'),ready=path.join(work,'ready'),cleaned=path.join(work,'cleaned'),entry=path.join(work,'main.cjs');
    await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const {withLoginCancellation}=require(${JSON.stringify(helper)});app.setPath('userData',${JSON.stringify(path.join(work,'profile'))});app.whenReady().then(async()=>{let win;const keepAlive=setInterval(()=>{},1000);try{await withLoginCancellation((signal,completing)=>new Promise((resolve,reject)=>{win=new BrowserWindow({show:false});fs.writeFileSync(${JSON.stringify(qr)},'fixture-qr');signal.addEventListener('abort',()=>{if(!win.isDestroyed())win.destroy();reject(signal.reason);},{once:true});fs.writeFileSync(${JSON.stringify(ready)},'ready');if(${JSON.stringify(stopSignal)}==='app-quit')setTimeout(()=>app.quit(),150);if(${JSON.stringify(stopSignal)}==='programmatic-close')setTimeout(()=>{if(completing)completing();win.destroy();app.quit();resolve(0);},150);}),()=>{fs.rmSync(${JSON.stringify(qr)},{force:true});fs.writeFileSync(${JSON.stringify(cleaned)},'done');},{app});app.exit(0);}catch(error){app.exit(error.code==='LOGIN_CANCELLED'?3:1);}finally{clearInterval(keepAlive);}});`);
    const child=spawn(electron,[entry],{env,detached:true,stdio:['ignore','pipe','pipe']});let sent=false,stderr='';child.stdout.resume();child.stderr.on('data',chunk=>stderr+=chunk);
    const ticker=setInterval(()=>{if(!sent&&sync.existsSync(ready)){sent=true;if(stopSignal.startsWith('SIG'))try{child.kill(stopSignal);}catch{}}},50);
    try{const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}reject(Error('Electron cleanup timed out'));},15000);child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});assert.equal(result.code,stopSignal==='programmatic-close'?0:3,stderr);assert.equal(sent,true);await assert.rejects(fs.access(qr));await fs.access(cleaned);}
    finally{clearInterval(ticker);try{process.kill(-child.pid,'SIGKILL');}catch{}}
  }
});
