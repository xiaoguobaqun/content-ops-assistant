import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileSampleArgs } from '../src/main/cli/parseProfileSampleArgs.js';
import { profileSampleCapabilities, sampleProfile } from '../src/main/services/profileSample.js';

test('严格限制平台、账号、数量和重复参数', () => {
  for (const args of [[], ['--platform','ks','--phone','a'], ['--platform','dy','--phone',' '], ['--platform','dy','--phone','a','--limit','21'], ['--platform','dy','--phone','a','--limit','0'], ['--platform','dy','--phone','a','--limit','1.5'], ['--platform','dy','--phone','a','--phone','b'], ['--platform','dy','--phone','a','--bad']]) assert.equal(parseProfileSampleArgs(args).ok, false);
  assert.deepEqual(parseProfileSampleArgs(['--platform','dy','--phone','a','--limit','20']).value, {platform:'dy',phone:'a',limit:20});
  assert.equal(parseProfileSampleArgs(['--capabilities']).value.capabilities,true);
});

test('平台能力明确关闭：没有归属证据时不返回样本', async () => {
  const capabilities = profileSampleCapabilities();
  for (const platform of ['dy','sph','xhs']) {
    assert.equal(capabilities.platforms[platform].available,false);
    assert.ok(capabilities.platforms[platform].reason);
    const r = await sampleProfile({platform,phone:'合成账号',limit:20});
    assert.equal(r.channel,'profile-sample');
    assert.equal(r.ok,false);
    assert.equal(r.identity.verified,false);
    assert.equal(r.identity.ownerHash,null);
    assert.deepEqual(r.works,[]);
    assert.equal(r.coverage.complete,false);
    assert.ok(r.coverage.reason);
    assert.equal(r.coverage.returned,0);
  }
});

test('已取消请求立即终止且无采集副作用', async () => {
  const controller = new AbortController(); controller.abort();
  const r = await sampleProfile({platform:'dy',phone:'合成账号',limit:20,signal:controller.signal});
  assert.equal(r.ok,false);
  assert.equal(r.coverage.reason,'cancelled');
  assert.deepEqual(r.works,[]);
});

test('小红书离线分页要求本人鉴权和每页归属一致，并保留未知数据', async () => {
  const {collectXhsProfilePages} = await import('../src/main/services/profileSampleXhs.js');
  const auth = {url:'https://creator.xiaohongshu.com/api/galaxy/user/info',status:200,payload:{code:0,success:true,data:{userId:'owner'}},expectedUserId:'owner'};
  const makePage = (ownerId='owner') => ({ownerId,notes:[{id:'1',display_title:'标题',likes:0}],nextPage:-1});
  const ok = await collectXhsProfilePages({auth,fetchPage:async()=>makePage(),limit:20});
  assert.equal(ok.ok,true);
  assert.equal(ok.identity.verified,true);
  assert.match(ok.identity.ownerHash,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(ok.works[0].metrics,{play:null,like:0,comment:null,share:null,favorite:null});
  assert.equal(ok.works[0].description,null);
  assert.equal(ok.coverage.complete,true);
  for (const changed of [{auth:{...auth,expectedUserId:'other'}},{fetchPage:async()=>makePage('other')},{fetchPage:async()=>makePage('')}]) {
    const r=await collectXhsProfilePages({auth,fetchPage:async()=>makePage(),limit:20,...changed});
    assert.equal(r.ok,false); assert.deepEqual(r.works,[]);
  }
});

test('小红书分页上限及中途取消不泄露部分样本', async () => {
  const {collectXhsProfilePages}=await import('../src/main/services/profileSampleXhs.js');
  const auth={url:'https://creator.xiaohongshu.com/api/galaxy/user/info',status:200,payload:{code:0,success:true,data:{userId:'owner'}},expectedUserId:'owner'};
  let calls=0;
  const r=await collectXhsProfilePages({auth,limit:20,fetchPage:async()=>({ownerId:'owner',notes:Array.from({length:12},(_,i)=>({id:String(++calls),display_title:String(i)})),nextPage:1})});
  assert.equal(r.works.length,20); assert.equal(r.coverage.complete,false); assert.equal(r.coverage.reason,'limit');
  const controller=new AbortController(); let requests=0;
  const cancelled=await collectXhsProfilePages({auth,limit:20,signal:controller.signal,fetchPage:async()=>{requests++;controller.abort();return {ownerId:'owner',notes:[],nextPage:1};}});
  assert.equal(cancelled.ok,false);assert.equal(cancelled.coverage.reason,'cancelled');assert.equal(requests,1);assert.deepEqual(cancelled.works,[]);
});

test('终页恰好达到上限才可标记完整，超出上限明确截断', async () => {
  const {collectXhsProfilePages}=await import('../src/main/services/profileSampleXhs.js');
  const auth={url:'https://creator.xiaohongshu.com/api/galaxy/user/info',status:200,payload:{code:0,success:true,data:{userId:'owner'}},expectedUserId:'owner'};
  const run=n=>collectXhsProfilePages({auth,limit:2,fetchPage:async()=>({ownerId:'owner',notes:Array.from({length:n},(_,i)=>({id:String(i)})),nextPage:-1})});
  assert.equal((await run(2)).coverage.complete,true);
  const truncated=await run(3);assert.equal(truncated.coverage.complete,false);assert.equal(truncated.coverage.reason,'limit');assert.equal(truncated.works.length,2);
});
