import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('process boundary preserves metacharacters as arguments', async()=>{
  const {runProcess}=await import('../src/process.mjs');
  const args=['素材 a; $(touch /tmp/should-never-run)','`text`','中文标题'];
  const r=await runProcess(process.execPath,['-e','console.log(JSON.stringify(process.argv.slice(1)))',...args]);
  assert.deepEqual(JSON.parse(r.stdout),args);
});
test('timeout waits for child termination before rejecting', async()=>{
  const {runProcess}=await import('../src/process.mjs');
  let childPid;
  await assert.rejects(runProcess(process.execPath,['-e','process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'],{timeoutMs:150,killGraceMs:100,onSpawn:pid=>{childPid=pid;}}), /超时/);
  assert.throws(()=>process.kill(childPid,0),{code:'ESRCH'});
});
test('timeout stops a grandchild even after its parent exits on SIGTERM',async t=>{
  const {runProcess}=await import('../src/process.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ops-descendant-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const pidFile=path.join(root,'pid');
  const script=`const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
  let group;
  try{
    await assert.rejects(runProcess(process.execPath,['-e',script,pidFile],{timeoutMs:250,killGraceMs:100,onSpawn:pid=>group=pid}),/超时/);
    const pid=Number(await fs.readFile(pidFile,'utf8'));
    if(process.platform==='win32')assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    else{const state=spawnSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).stdout.trim();assert.ok(!state||state.startsWith('Z'),`grandchild still running: ${state}`);}
  }finally{try{process.kill(process.platform==='win32'?group:-group,'SIGKILL');}catch{}}
});
