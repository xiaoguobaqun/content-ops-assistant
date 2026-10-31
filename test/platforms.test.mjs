import test from 'node:test';
import assert from 'node:assert/strict';
test('platform validation preserves legacy dy but fails closed for explicit unknown platforms and scopes',async()=>{
  const {platformId,validatePlatformInput,getPlatform}=await import('../src/platforms.mjs');
  assert.equal(platformId({}),'dy');assert.throws(()=>platformId({platform:''}),/平台/);assert.throws(()=>getPlatform('unknown'),/平台/);
  const sph={platform:'sph',mode:'draft',visibility:'unknown',creativeStatement:'none',title:'测试',description:''};assert.equal(validatePlatformInput(sph).id,'sph');
  for(const fields of [{mode:'publish'},{visibility:'private'},{shortTitle:'x'.repeat(17)},{shortTitle:'太短'},{shortTitle:'短标题，带标点'}])assert.throws(()=>validatePlatformInput({...sph,...fields}),/草稿|范围|平台|暂未|短标题/);
});

test('xhs confirmation needs preserved local scope, matching task, media identities and original source fingerprints',async()=>{
  const {draftConfirmed}=await import('../src/platforms.mjs');const video='a'.repeat(64),cover='b'.repeat(64),hash='sha256:'+'c'.repeat(64);const job={id:'xhs-task',input:{platform:'xhs'},files:{video:{sha256:video},cover:{sha256:cover}}};const e={ok:true,preserved:true,platform:'xhs',scope:'browser-local',clientTaskId:'xhs-task',draftKeyHash:hash,videoIdentity:hash,coverIdentity:hash,materialHash:hash,sourceVideoSha:video,sourceCoverSha:cover};assert.equal(draftConfirmed(job,{ok:true,evidence:e}),true);
  for(const fields of [{scope:'cloud'},{clientTaskId:'other'},{preserved:false},{videoIdentity:''},{materialHash:''},{sourceCoverSha:video},{draftKeyHash:undefined}])assert.equal(draftConfirmed(job,{ok:true,evidence:{...e,...fields}}),false);
});
