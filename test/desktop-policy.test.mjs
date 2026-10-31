import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
test('media access requires issued capability tokens, never arbitrary paths',async t=>{
  const {createMediaRegistry}=require('../desktop/ipc-policy.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-media-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'视频 a.mov');await fs.writeFile(file,'fixture');const media=createMediaRegistry();
  const url=await media.issue(file);assert.equal(media.resolve(url),await fs.realpath(file));
  for(const value of ['file:///etc/passwd','app-media://asset/../../etc/passwd','app-media://asset/unknown/file.mov'])assert.equal(media.resolve(value),null);
});
test('publish execution requires fresh native approval bound to persisted digest',()=>{
  const {executionAllowed}=require('../desktop/ipc-policy.cjs');
  const job={id:'job-1',inputDigest:'abc',mode:'publish',state:'prepared'};
  assert.equal(executionAllowed(job,null),false);
  assert.equal(executionAllowed(job,{id:'job-1',digest:'old',confirmed:true}),false);
  assert.equal(executionAllowed(job,{id:'job-1',digest:'abc',confirmed:true}),true);
  assert.equal(executionAllowed({...job,state:'unknown'},{id:'job-1',digest:'abc',confirmed:true}),false);
  assert.equal(executionAllowed({...job,mode:'draft'},null),true);
});
test('editing a form invalidates a prepared or in-flight preparation snapshot',async()=>{
  const {createFormRevision}=await import('../desktop/ui/form-state.mjs');const state=createFormRevision();
  const first=state.begin();state.edit();assert.equal(state.commit(first,{id:'old'}),false);
  const second=state.begin();assert.equal(state.commit(second,{id:'current'}),true);assert.equal(state.job.id,'current');
  state.edit();assert.equal(state.job,null);
});
test('native media protocol supports the installed Electron file-protocol API',()=>{
  const {installMediaProtocol}=require('../desktop/ipc-policy.cjs');let handler;
  installMediaProtocol({registerFileProtocol:(_,value)=>{handler=value;return true;}},{resolve:url=>url==='app-media://asset/valid/file.mov'?'/tmp/file.mov':null});
  let result;handler({url:'app-media://asset/valid/file.mov'},r=>result=r);assert.equal(result.path,'/tmp/file.mov');
  handler({url:'app-media://asset/unknown/file.mov'},r=>result=r);assert.equal(result.error,-6);
});
test('platform links and native approval cannot enable unverified platform publishing',()=>{
  const {platformUrlAllowed,executionAllowed}=require('../desktop/ipc-policy.cjs');
  assert.equal(platformUrlAllowed('https://channels.weixin.qq.com/platform','sph'),true);
  assert.equal(platformUrlAllowed('https://creator.douyin.com/','sph'),false);
  assert.equal(platformUrlAllowed('https://channels.weixin.qq.com.evil.test/','sph'),false);
  const job={platform:'sph',id:'sph',inputDigest:'abc',mode:'publish',state:'prepared'};
  assert.equal(executionAllowed(job,{id:'sph',digest:'abc',confirmed:true}),false);
  assert.equal(executionAllowed({...job,mode:'draft',visibility:'unknown'},null),true);
  assert.equal(executionAllowed({...job,platform:'xhs',mode:'draft'},null),false);
});
