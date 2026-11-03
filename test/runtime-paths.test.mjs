import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);

test('portable installation resolves program and writable data separately in Unicode Windows paths',async()=>{
  const {desktopRuntime}=require('../desktop/runtime-config.cjs');
  const runtime=desktopRuntime({config:{portable:true,projectRoot:'C:\\old-source'},appRoot:'C:\\程序 空间\\resources\\app',userDataPath:'C:\\Users\\甲\\AppData\\Roaming\\content-ops-desktop',platform:'win32',env:{}});
  assert.equal(runtime.projectRoot,'C:\\程序 空间\\resources\\app');
  assert.equal(runtime.node,'C:\\程序 空间\\resources\\app\\runtime\\node.exe');
  assert.equal(runtime.dataRoot,'C:\\Users\\甲\\AppData\\Roaming\\content-ops-desktop\\workspace');
  assert.equal(runtime.documentsPath,runtime.dataRoot+'\\documents');
  assert.equal(runtime.engineUserData,runtime.dataRoot+'\\engine-profile');
});
test('Mac in-place runtime retains the existing source, runtime and documents locations',async()=>{
  const {desktopRuntime}=require('../desktop/runtime-config.cjs');
  const runtime=desktopRuntime({config:{projectRoot:'/original/project',node:'/original/node'},appRoot:'/packaged/app',userDataPath:'/user/ui',documentsPath:'/user/Documents',platform:'darwin',env:{}});
  assert.equal(runtime.projectRoot,'/original/project');assert.equal(runtime.dataRoot,'/original/project/.local');
  assert.equal(runtime.node,'/original/node');assert.equal(runtime.documentsPath,'/user/Documents');assert.equal(runtime.engineUserData,undefined);
});
test('runtime configuration rejects relative data roots before any service writes',async()=>{
  const {desktopRuntime}=require('../desktop/runtime-config.cjs');
  assert.throws(()=>desktopRuntime({config:{portable:true},appRoot:'C:\\Program Files\\app',userDataPath:'C:\\User',platform:'win32',env:{CONTENT_OPS_DATA_ROOT:'relative'}}),/绝对路径/);
});
test('installed worker persists only under its explicitly isolated data directory and stops through stdin EOF',async t=>{
  const {createWorkerClient}=require('../desktop/worker-client.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ops-portable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'program'),data=path.join(root,'data');await fs.mkdir(path.join(project,'desktop'),{recursive:true});
  await fs.writeFile(path.join(project,'desktop/service.mjs'),`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,result:{data:process.env.CONTENT_OPS_DATA_ROOT,engine:process.env.CONTENT_OPS_ENGINE_USER_DATA}})+'\\n');}).on('close',()=>process.exit(0));`);
  const client=createWorkerClient({node:process.execPath,projectRoot:project,dataRoot:data,engineUserData:path.join(data,'engine'),stopGraceMs:2000});
  try{assert.deepEqual(await client.request('dashboard'),{data,engine:path.join(data,'engine')});await fs.access(path.join(data,'desktop/service.log'));await assert.rejects(fs.access(path.join(project,'.local')));}
  finally{await client.stop();}
});
test('configured data root is shared by job storage and engine-generated evidence paths',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ops-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const jobs=new URL('../src/jobs.mjs',import.meta.url).href,engine=new URL('../src/engine.mjs',import.meta.url).href;
  const script=`import {defaultRoot} from ${JSON.stringify(jobs)};import {draftQuerySpec} from ${JSON.stringify(engine)};console.log(JSON.stringify({defaultRoot,file:draftQuerySpec({id:'task',input:{platform:'dy'},files:{}}).expectedFile}));`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,CONTENT_OPS_DATA_ROOT:root},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);const code=await new Promise(r=>child.on('close',r));assert.equal(code,0,errors);
  assert.deepEqual(JSON.parse(output),{defaultRoot:root,file:path.join(root,'jobs/task/draft-expected.json')});
});
