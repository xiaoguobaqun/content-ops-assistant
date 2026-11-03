import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccountRemoval} from '../src/main/services/accountRemoval.js';
import {parseAccountRemoveArgs} from '../src/main/cli/parseAccountRemoveArgs.js';

async function fixture(t,extra=[]){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'account-removal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const accountsDir=path.join(root,'accounts'),backupDir=path.join(root,'backup');await fs.mkdir(accountsDir);await fs.mkdir(backupDir);
  const target={phone:'测试甲',pt:'抖音',partition:'persist:测试甲抖音'},other={phone:'测试甲',pt:'视频号',partition:'persist:测试甲视频号'};
  await fs.writeFile(path.join(accountsDir,'a.json'),JSON.stringify([target,other,...extra]));await fs.writeFile(path.join(accountsDir,'b.json'),JSON.stringify([target]));
  let cookies=[{name:'sessionid',value:'synthetic-secret'}];const calls=[];
  const session={clearStorageData:async options=>{calls.push(options);cookies=[];},clearAuthCache:async()=>calls.push('auth'),cookies:{flushStore:async()=>{},get:async()=>cookies}};
  const service=createAccountRemoval({accountsDir,backupDir,profileRoot:root,sessionForPartition:p=>{calls.push(p);return session;}});
  return {root,accountsDir,backupDir,target,other,service,calls,session};
}
test('参数严格绑定平台账号与预览或摘要确认',()=>{
  for(const args of [[],['--platform','dy','--phone','a'],['--platform','other','--phone','a','--preview'],['--platform','dy','--phone','a','--preview','--phone','b'],['--platform','dy','--phone','../a','--preview'],['--platform','dy','--phone','a','--expected-digest','bad']])assert.equal(parseAccountRemoveArgs(args).ok,false);
  assert.equal(parseAccountRemoveArgs(['--platform','dy','--phone','测试甲','--preview']).value.preview,true);
});
test('预览无副作用，执行退出唯一分区并删除重复登记，保留其他平台与草稿存储',async t=>{
  const f=await fixture(t),selection={platform:'dy',phone:'测试甲'};
  const preview=await f.service.preview(selection);assert.match(preview.digest,/^sha256:[a-f0-9]{64}$/);assert.equal(f.calls.length,0);
  const result=await f.service.remove({...selection,expectedDigest:preview.digest});assert.equal(result.ok,true);assert.equal(result.loggedOut,true);
  assert.deepEqual(f.calls,['persist:测试甲抖音',{storages:['cookies']},'auth']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.accountsDir,'a.json'),'utf8')),[f.other]);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.accountsDir,'b.json'),'utf8')),[]);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});
test('过期摘要、共享或异常分区、外部浏览器与损坏登记在清理前拒绝',async t=>{
  for(const extra of [[{phone:'测试甲-别名',pt:'抖音',partition:'persist:测试甲抖音'}],[{phone:'测试甲',pt:'抖音',partition:'persist:错误抖音'}],[{phone:'测试甲',pt:'抖音',useRealBrowser:true}]]){
    const f=await fixture(t,extra);await assert.rejects(f.service.preview({platform:'dy',phone:'测试甲'}));assert.equal(f.calls.length,0);
  }
  const f=await fixture(t),selection={platform:'dy',phone:'测试甲'},preview=await f.service.preview(selection);
  await fs.writeFile(path.join(f.accountsDir,'b.json'),'[]');await assert.rejects(f.service.remove({...selection,expectedDigest:preview.digest}),/变化/);assert.equal(f.calls.length,0);
  await fs.writeFile(path.join(f.accountsDir,'broken.json'),'not-json');await assert.rejects(f.service.preview(selection),/记录/);assert.equal(f.calls.length,0);
});
test('认证清理失败或 Cookie 残留时保留登记且不回显原始异常',async t=>{
  for(const mode of ['throw','remain']){
    const f=await fixture(t),selection={platform:'dy',phone:'测试甲'},preview=await f.service.preview(selection);
    if(mode==='throw')f.session.clearStorageData=async()=>{throw Error('Cookie=synthetic-secret');};else f.session.cookies.get=async()=>[{name:'sessionid',value:'synthetic-secret'}];
    await assert.rejects(f.service.remove({...selection,expectedDigest:preview.digest}),e=>/退出登录/.test(e.message)&&!e.message.includes('synthetic-secret'));
    assert.equal(JSON.parse(await fs.readFile(path.join(f.accountsDir,'a.json'),'utf8')).length,2);
  }
});
test('视频号移除中断登录备份和临时文件，其他分区备份保留',async t=>{
  const f=await fixture(t),partition='persist:测试甲视频号',base=encodeURIComponent(partition)+'.json';
  for(const file of [base,base+'.tmp-123','other.json'])await fs.writeFile(path.join(f.backupDir,file),'synthetic-backup');
  const selection={platform:'sph',phone:'测试甲'},preview=await f.service.preview(selection);await f.service.remove({...selection,expectedDigest:preview.digest});
  assert.deepEqual(await fs.readdir(f.backupDir),['other.json']);assert.equal(f.calls[0],partition);
});
test('即使登记未标注真实浏览器，也拦截遗留的独立Chrome登录目录',async t=>{
  const {createHash}=await import('node:crypto');
  for(const platform of ['sph','xhs']){
    const f=await fixture(t),partition=platform==='sph'?'persist:测试甲视频号':'persist:测试甲小红书';
    if(platform==='xhs')await fs.writeFile(path.join(f.accountsDir,'xhs.json'),JSON.stringify([{phone:'测试甲',pt:'小红书',partition}]));
    const profile=platform==='sph'?path.join(f.root,'chrome-sph-login',createHash('sha256').update(partition).digest('hex')):path.join(f.root,'chrome-xhs-profile');await fs.mkdir(profile,{recursive:true});
    await assert.rejects(f.service.preview({platform,phone:'测试甲'}),/独立浏览器/);assert.equal(f.calls.length,0);
  }
});
