import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const windows=process.platform==='win32';
const wrapperUrl=new URL('../src/windows-host.mjs',import.meta.url);
let api;
test('Windows native boundary can be loaded without launching a helper',async()=>{
  try{api=await import(wrapperUrl);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
  assert.equal(typeof api?.withWindowsLock,'function','native lock boundary is missing');
  assert.equal(typeof api?.runWindowsProcess,'function','native process boundary is missing');
});

test('missing native guardian fails closed without exposing command arguments',async t=>{
  const {runWindowsProcess}=await import(wrapperUrl);
  const previous=process.env.CONTENT_OPS_WINDOWS_HOST;
  process.env.CONTENT_OPS_WINDOWS_HOST=path.join(os.tmpdir(),`missing-ops-host-${process.pid}.exe`);
  t.after(()=>{if(previous===undefined)delete process.env.CONTENT_OPS_WINDOWS_HOST;else process.env.CONTENT_OPS_WINDOWS_HOST=previous;});
  await assert.rejects(runWindowsProcess('private-command',['secret=private-token']),error=>{
    assert.match(error.message,/不可用|结果未知/);
    assert.equal(error.message.includes('private-command'),false);
    assert.equal(error.message.includes('private-token'),false);
    return true;
  });
});

let nativeReady;
async function native(){
  if(!api)api=await import(wrapperUrl);
  nativeReady??=(async()=>{
    try{await fs.access(process.env.CONTENT_OPS_WINDOWS_HOST||fileURLToPath(new URL('../runtime/windows-host.exe',import.meta.url)));}
    catch{const {buildWindowsHost}=await import('../scripts/build-windows-host.mjs');await buildWindowsHost();}
  })();
  await nativeReady;
  return api;
}
async function temp(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ops-windows-中文 '));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  return dir;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readEventually(file,timeout=10000){
  const until=Date.now()+timeout;
  while(Date.now()<until){try{return await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}await delay(25);}
  throw Error('fixture process did not start');
}
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function stopped(pid){
  const until=Date.now()+10000;
  while(alive(pid)&&Date.now()<until)await delay(20);
  assert.equal(alive(pid),false,`descendant ${pid} is still running`);
}
function treeScript(natural=false){
  return `const fs=require('node:fs');const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(process.argv[1],String(p.pid));${natural?'p.unref();':'setInterval(()=>{},1000);'}`;
}

test('Windows preserves Unicode, quotes, trailing slashes and shell metacharacters as literal argv', {skip:!windows},async t=>{
  const {runWindowsProcess}=await native();const dir=await temp(t);
  const args=['中文 标题','a&b | c > d < e %PATH% !var!','$(touch nope);`text`','say "hello"','C:\\素材 文件夹\\','',String.raw`a\\\"b`];
  const result=await runWindowsProcess(process.execPath,['-e','process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.OPS_NATIVE_VALUE}))',...args],{cwd:dir,env:{...process.env,OPS_NATIVE_VALUE:'中文 & %PATH%'}});
  assert.equal(result.code,0);
  assert.deepEqual(JSON.parse(result.stdout),{args,cwd:dir,env:'中文 & %PATH%'});
});

test('Windows exclusive lock rejects contention and can be reacquired after release', {skip:!windows},async t=>{
  const {withWindowsLock}=await native();const file=path.join(await temp(t),'engine.lock.guard');
  await withWindowsLock(file,async()=>{
    await assert.rejects(withWindowsLock(file,()=>assert.fail('contender entered')),/已有任务|占用/);
  });
  let entered=false;await withWindowsLock(file,()=>{entered=true;});assert.equal(entered,true);
});

test('Windows lock waiter enters only after the current session exits', {skip:!windows},async t=>{
  const {withWindowsLock}=await native();const file=path.join(await temp(t),'wait.guard');
  let waiting;let entered=false;
  await withWindowsLock(file,async()=>{
    waiting=withWindowsLock(file,()=>{entered=true;return true;},{waitMs:Infinity});
    await delay(150);assert.equal(entered,false);
  });
  assert.equal(await waiting,true);
});

test('Windows unqueryable active or corrupt guard records never admit a new task', {skip:!windows},async t=>{
  const {withWindowsLock}=await native();const file=path.join(await temp(t),'uncertain.guard');
  await fs.writeFile(file,JSON.stringify({version:1,phase:'active',job:'Local\\ContentOps.00000000000000000000000000000000'}));
  await assert.rejects(withWindowsLock(file,()=>assert.fail('unqueryable old Job was treated as stopped')),/未知|回查/);
  await fs.writeFile(file,'{"version":1,"phase":"act');
  await assert.rejects(withWindowsLock(file,()=>assert.fail('corrupt old Job record was overwritten')),/未知|回查/);
  assert.equal(await fs.readFile(file,'utf8'),'{"version":1,"phase":"act');
});

test('Windows waits for orphan descendants after direct parent natural exit', {skip:!windows},async t=>{
  const {runWindowsProcess}=await native();const pidFile=path.join(await temp(t),'pid');
  const result=await runWindowsProcess(process.execPath,['-e',treeScript(true),pidFile],{timeoutMs:5000});
  assert.equal(result.code,0);await stopped(Number(await fs.readFile(pidFile,'utf8')));
});

test('Windows timeout rejects only after the full Job is empty', {skip:!windows},async t=>{
  const {runWindowsProcess}=await native();const pidFile=path.join(await temp(t),'pid');
  await assert.rejects(runWindowsProcess(process.execPath,['-e',treeScript(),pidFile],{timeoutMs:1000}),/超时/);
  await stopped(Number(await fs.readFile(pidFile,'utf8')));
});

test('Windows cancellation stops descendants before ownership becomes idle', {skip:!windows},async t=>{
  const {runWindowsProcess}=await native();const pidFile=path.join(await temp(t),'pid');
  const controller=new AbortController();let idle=false;let running;
  const execution=runWindowsProcess(process.execPath,['-e',treeScript(),pidFile],{
    signal:controller.signal,
    ownership:{launching(){},spawned(pid){running=pid;},stopped(){idle=true;}},
  });
  const rejection=assert.rejects(execution,/停止|中断/);
  const descendant=Number(await readEventually(pidFile));controller.abort();await rejection;
  assert.equal(idle,true);assert.ok(running);await stopped(descendant);await stopped(running);
});

test('Windows ownership and callback failure never leave a process running', {skip:!windows},async()=>{
  const {runWindowsProcess}=await native();let pid;let idle=false;
  await assert.rejects(runWindowsProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{
    onSpawn(value){pid=value;throw Error('callback failed');},
    ownership:{launching(){},spawned(){},stopped(){idle=true;}},
  }),/callback failed/);
  assert.equal(idle,true);await stopped(pid);
});

test('Windows output is bounded while preserving the final output', {skip:!windows},async()=>{
  const {runWindowsProcess}=await native();
  const result=await runWindowsProcess(process.execPath,['-e','process.stdout.write("x".repeat(3*1024*1024)+"final-output");process.stderr.write("e".repeat(3*1024*1024)+"final-error");']);
  assert.equal(result.code,0);assert.ok(Buffer.byteLength(result.stdout)<=2*1024*1024);assert.ok(Buffer.byteLength(result.stderr)<=2*1024*1024);
  assert.ok(result.stdout.endsWith('final-output'));assert.ok(result.stderr.endsWith('final-error'));
});

test('Windows abrupt Node parent death keeps guard until descendants are stopped', {skip:!windows},async t=>{
  const {withWindowsLock}=await native();const dir=await temp(t);const file=path.join(dir,'engine.lock.guard');const pidFile=path.join(dir,'pid');const ready=path.join(dir,'ready');
  const source=`import fs from 'node:fs';import {withWindowsLock} from ${JSON.stringify(wrapperUrl.href)};await withWindowsLock(${JSON.stringify(file)},async session=>{await session.run(process.execPath,['-e',${JSON.stringify(treeScript())},${JSON.stringify(pidFile)}],{onSpawn(){fs.writeFileSync(${JSON.stringify(ready)},'ready');},timeoutMs:30000});});`;
  const owner=spawn(process.execPath,['--input-type=module','-e',source],{stdio:'ignore'});
  t.after(()=>{try{owner.kill('SIGKILL');}catch{}});
  await readEventually(ready);const descendant=Number(await readEventually(pidFile));
  await assert.rejects(withWindowsLock(file,()=>assert.fail('lock entered while child running')),/已有任务|占用/);
  assert.ok(owner.pid>1&&owner.pid!==process.pid&&owner.pid!==process.ppid,'crash fixture must be a separate child process');
  const exited=new Promise(resolve=>owner.once('exit',resolve));owner.kill('SIGKILL');await exited;
  await withWindowsLock(file,async()=>{assert.equal(alive(descendant),false,'guard released before descendant stopped');},{waitMs:10000});
  await stopped(descendant);
});

test('Windows helper crash kills its Job and reports an unknown outcome', {skip:!windows},async t=>{
  const {runWindowsProcess,withWindowsLock}=await native();const dir=await temp(t);const pidFile=path.join(dir,'pid');const guard=path.join(dir,'crash.guard');let idle=false;
  const script=`const fs=require('node:fs');const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(process.argv[1],JSON.stringify({helper:process.ppid,descendant:p.pid}));setInterval(()=>{},1000);`;
  const execution=withWindowsLock(guard,session=>session.run(process.execPath,['-e',script,pidFile],{ownership:{launching(){},spawned(){},stopped(){idle=true;}}}));
  const rejection=assert.rejects(execution,/结果未知/);
  const pids=JSON.parse(await readEventually(pidFile));assert.ok(pids.helper>1&&pids.helper!==process.pid&&pids.helper!==process.ppid&&pids.helper!==pids.descendant,'guardian fixture must not target a test runner');process.kill(pids.helper,'SIGKILL');await rejection;
  assert.equal(idle,false,'an unverified guardian failure must leave ownership unknown');
  try{
    await withWindowsLock(guard,()=>{assert.equal(alive(pids.descendant),false,'hard guardian kill allowed overlap with a survivor');});
  }catch(error){assert.match(error.message,/占用|已有任务|未知|回查/);}
  await stopped(pids.descendant);
  await assert.rejects(runWindowsProcess(path.join(dir,'missing secret.exe'),['credential=private']),error=>!error.message.includes('credential=private')&&!error.message.includes('secret.exe'));
});

test('unbounded metadata lock wait is accepted and delegated to native protection',async t=>{
 const {withWindowsLock}=await import(wrapperUrl);const previous=process.env.CONTENT_OPS_WINDOWS_HOST;
 process.env.CONTENT_OPS_WINDOWS_HOST=path.join(os.tmpdir(),'missing-wait-guard.exe');t.after(()=>{if(previous===undefined)delete process.env.CONTENT_OPS_WINDOWS_HOST;else process.env.CONTENT_OPS_WINDOWS_HOST=previous;});
 await assert.rejects(withWindowsLock(null,()=>{}, {waitMs:Infinity}),e=>/不可用|结果未知/.test(e.message));
});
