import test from 'node:test';
import assert from 'node:assert/strict';

test('managed sph tasks are single-attempt and do not broaden other platforms',async()=>{
  const {getPublishAttemptLimit}=await import('../src/shared/xhsPublishPolicy.js');
  assert.equal(getPublishAttemptLimit({pt:'视频号',clientTaskId:'task'}),1);
  assert.equal(getPublishAttemptLimit({pt:'快手'}),5);
});
test('safe draft submission stops on every failed prerequisite and never repeats saving',async()=>{
  const {executeSafeSphDraft}=await import('../src/main/services/upLoad/sphSafeDraft.js');
  const stages=['baseline','upload','text','processing','cover','inspect','checkpoint','save'];
  for(const failed of ['baseline','upload','text','processing','cover','inspect','checkpoint','save']){
    const calls=[];const steps=Object.fromEntries(stages.map(key=>[key,async()=>{calls.push(key);if(key===failed)throw Error('fixture '+key);return key==='baseline'?{empty:true}:key==='inspect'?{ok:true,mediaId:'media',coverSrc:'cover'}:undefined;}]));
    await assert.rejects(executeSafeSphDraft(steps),/fixture/);
    assert.deepEqual(calls,stages.slice(0,stages.indexOf(failed)+1));
  }
  let saved=0;const steps=Object.fromEntries(stages.map(key=>[key,async()=>{if(key==='save')saved++;return key==='baseline'?{empty:false}:undefined;}]));
  await assert.rejects(executeSafeSphDraft(steps),/草稿|占用/);assert.equal(saved,0);
});
test('uncertain baseline and mismatched content never reach save',async()=>{
  const {executeSafeSphDraft}=await import('../src/main/services/upLoad/sphSafeDraft.js');
  const unexpected=()=>assert.fail('must not run');
  await assert.rejects(executeSafeSphDraft({baseline:async()=>({empty:null}),upload:unexpected}),/草稿|核实/);
  const steps={baseline:async()=>({empty:true}),upload:async()=>{},text:async()=>{},processing:async()=>{},cover:async()=>{},inspect:async()=>({ok:false}),checkpoint:unexpected,save:unexpected};
  await assert.rejects(executeSafeSphDraft(steps),/内容|核实/);
});
test('QR candidates need a decoded WeChat URL, never an avatar or a foreign QR',async()=>{
  const {pickSphQrCapture}=await import('../src/main/services/cliLogin/sphQrCapture.js');
  const a={buf:Buffer.from('avatar')},b={buf:Buffer.from('actual')},c={buf:Buffer.from('foreign')};
  const decode=buf=>buf.toString()==='actual'?'http://weixin.qq.com/x/fixture':buf.toString()==='foreign'?'https://evil.test/qr':null;
  assert.equal(pickSphQrCapture(a,decode),null);assert.equal(pickSphQrCapture(c,decode),null);assert.equal(pickSphQrCapture(b,decode),b);
});
test('sph unknown auth probe remains unknown even when session cookies exist',async()=>{
  const {resolveSphAccountLogin}=await import('../src/shared/loginState.js');
  const cookie={loggedIn:true,reason:'',expireMs:123};assert.equal(resolveSphAccountLogin(cookie,{ok:false,reason:'offline'}).loggedIn,null);
  assert.equal(resolveSphAccountLogin(cookie,{ok:true,loggedIn:true}).loggedIn,true);assert.equal(resolveSphAccountLogin(cookie,{ok:true,loggedIn:false}).loggedIn,false);
});
test('managed sph CLI requires a checkpoint file and explicit draft, never accepts scheduled or publish modes',async()=>{
  const {parsePublishArgs}=await import('../src/main/cli/parsePublishArgs.js');const args=['-p','sph','--phone','测试','-f','/tmp/v.mp4','-t','标题','--task-id','task'];
  assert.equal(parsePublishArgs([...args,'--draft']).ok,false);
  assert.equal(parsePublishArgs([...args,'--draft','--checkpoint-file','/tmp/evidence.json']).ok,true);
  assert.equal(parsePublishArgs([...args,'--publish','--checkpoint-file','/tmp/evidence.json']).ok,false);
});
