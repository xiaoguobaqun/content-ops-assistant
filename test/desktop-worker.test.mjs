import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {createWorkerClient}=require('../desktop/worker-client.cjs');
test('worker stop waits for exit and a replacement worker accepts new requests',async t=>{
  const projectRoot=await fs.mkdtemp(path.join(os.tmpdir(),'ops-worker-'));t.after(()=>fs.rm(projectRoot,{recursive:true,force:true}));await fs.mkdir(path.join(projectRoot,'desktop'));
  await fs.writeFile(path.join(projectRoot,'desktop/service.mjs'),`import readline from 'node:readline';process.on('SIGTERM',()=>{});readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,result:{pid:process.pid}})+'\\n');});`);
  let exits=0;const client=createWorkerClient({node:process.execPath,projectRoot,onExit:()=>exits++,stopGraceMs:50});const result=await client.request('dashboard');
  await client.stop();assert.equal(exits,1);assert.throws(()=>process.kill(result.pid,0),{code:'ESRCH'});await assert.rejects(client.request('dashboard'),/停止/);
  const replacement=createWorkerClient({node:process.execPath,projectRoot,stopGraceMs:50});try{assert.ok((await replacement.request('dashboard')).pid);}finally{await replacement.stop();}
});
