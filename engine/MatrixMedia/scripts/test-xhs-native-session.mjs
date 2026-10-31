import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {buildSync} from 'esbuild';

test('xhs account probing closes its window without quitting before the next account or output write',async t=>{
  if(process.platform!=='darwin')return t.skip('本机Electron运行时');
  const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-native-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  const helper=path.join(dir,'session.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsSession.js')],bundle:true,packages:'external',platform:'node',format:'cjs',outfile:helper});
  const marker=path.join(dir,'finished'),entry=path.join(dir,'main.cjs');
  await fs.writeFile(entry,`const {app}=require('electron');const pie=require('puppeteer-in-electron');const fs=require('node:fs');const {withXhsPage}=require(${JSON.stringify(helper)});app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});(async()=>{console.log('initializing');await pie.initialize(app);console.log('ready-wait');await app.whenReady();console.log('ready');const original=app.listenerCount('window-all-closed');for(let i=0;i<2;i++){console.log('page-start',i);await withXhsPage('persist:fixture小红书',async page=>{console.log('page-open');await page.setContent('<p>只读测试</p>');return page.title();});await new Promise(r=>setTimeout(r,200));}fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({listeners:app.listenerCount('window-all-closed'),original}));app.exit(0);})().catch(e=>{console.error(e);app.exit(1);});`);
  const env={...process.env,NODE_PATH:path.join(root,'node_modules')};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[entry],{env,detached:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stdout.on('data',b=>stderr+=b);child.stderr.on('data',b=>stderr+=b);
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}reject(Error('native session fixture timed out: '+stderr));},15000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(result,0,stderr);let saved;try{saved=JSON.parse(await fs.readFile(marker,'utf8'));}catch{}assert.ok(saved,'account output must be written after both windows close');assert.equal(saved.listeners,saved.original,'temporary lifecycle listener must be removed');
});
