import test from 'node:test';import assert from 'node:assert/strict';

test('managed xhs drafts require a local checkpoint and exact supported content before any upload',async()=>{
  const {parsePublishArgs}=await import('../src/main/cli/parsePublishArgs.js');const base=['-p','xhs','--phone','测试','-f','/tmp/v.mov','--cover','/tmp/c.jpg','-t','测试标题','--task-id','fixture'];
  assert.equal(parsePublishArgs([...base,'--draft','--checkpoint-file','/tmp/xhs.json']).ok,true);assert.equal(parsePublishArgs([...base,'--draft','--checkpoint-file','/tmp/xhs.json','--tags','测试话题']).ok,false,'unsupported topics must be rejected instead of silently dropped');
  for(const extra of [['--draft'],['--publish','--checkpoint-file','/tmp/xhs.json'],['--draft','--checkpoint-file','relative.json'],['--draft','--checkpoint-file','/tmp/xhs.json','--short-title','别的标题'],['--draft','--checkpoint-file','/tmp/xhs.json','-t','一二三四五六七八九十一二三四五六七八九十一']])assert.equal(parsePublishArgs([...base,...extra]).ok,false,extra.join(' '));
});
test('xhs safe draft stops on unknown baseline and every failed prerequisite without a second save',async()=>{
  const mod=await import('../src/main/services/upLoad/xhsSafeDraft.js').catch(()=>({}));assert.equal(typeof mod.executeSafeXhsDraft,'function','safe draft pipeline is missing');const stages=['baseline','upload','text','processing','cover','inspect','checkpoint','save'];
  for(const failed of stages){const calls=[];const steps=Object.fromEntries(stages.map(key=>[key,async()=>{calls.push(key);if(key===failed)throw Error('failed '+key);return key==='baseline'?{empty:true,scope:'browser-local'}:key==='inspect'?{ok:true,videoIdentity:'video',coverIdentity:'cover'}:undefined;}]));await assert.rejects(mod.executeSafeXhsDraft(steps),/failed/);assert.deepEqual(calls,stages.slice(0,stages.indexOf(failed)+1));}
  for(const empty of [false,null,undefined]){let uploads=0;await assert.rejects(mod.executeSafeXhsDraft({baseline:async()=>({empty}),upload:async()=>uploads++}),/草稿/);assert.equal(uploads,0);}
});
test('xhs safe draft cannot save weak media evidence or proceed after cancellation',async()=>{
  const mod=await import('../src/main/services/upLoad/xhsSafeDraft.js').catch(()=>({}));assert.equal(typeof mod.executeSafeXhsDraft,'function');let saved=0,cancelled=false;
  const steps={baseline:async()=>({empty:true}),upload:async()=>{},text:async()=>{},processing:async()=>{},cover:async()=>{},inspect:async()=>({ok:true,videoIdentity:'v'}),checkpoint:async()=>{},save:async()=>saved++};await assert.rejects(mod.executeSafeXhsDraft(steps),/核实/);assert.equal(saved,0);
  steps.inspect=async()=>({ok:true,videoIdentity:'v',coverIdentity:'c'});steps.checkpoint=async()=>{cancelled=true;};steps.checkCancelled=()=>{if(cancelled)throw Error('cancelled');};await assert.rejects(mod.executeSafeXhsDraft(steps),/cancelled/);assert.equal(saved,0);
});

test('xhs managed execution claims a durable fingerprint before opening a page and refuses the same checkpoint twice',async t=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildSync}=await import('esbuild'),{createRequire}=await import('node:module');
  const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-claim-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');const compiled=path.join(dir,'managed.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsManagedDraft.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:compiled});const {runManagedXhsDraft}=createRequire(import.meta.url)(compiled);
  const file=path.join(dir,'v.mov'),cover=path.join(dir,'c.jpg'),checkpointFile=path.join(dir,'checkpoint.json');await fs.writeFile(file,'video bytes');await fs.writeFile(cover,'cover bytes');
  const v={platform:'小红书',phone:'测试',partition:'persist:测试小红书',file,cover,checkpointFile,clientTaskId:'fixture',title:'标题',description:'简介',draft:true};let opened=0;
  const first=await runManagedXhsDraft(v,{withPage:async()=>{opened++;throw Error('browser intentionally unavailable');}});assert.equal(first.message,'browser intentionally unavailable');assert.equal(opened,1);const saved=JSON.parse(await fs.readFile(checkpointFile,'utf8'));assert.equal(saved.stage,'preflight');assert.equal(saved.files.video.sha256,'96b050b919f3fca2fc8b6923537136a197ad13c583beb1438d1a12ccbc999c42');
  const second=await runManagedXhsDraft(v,{withPage:async()=>assert.fail('duplicate must not open a page')});assert.match(second.message,/检查点已存在/);assert.equal(await fs.readFile(checkpointFile,'utf8'),JSON.stringify(saved));
});

test('automatic local drafts bind only to the owned unique media created during this task, and verification needs exact content',async()=>{
  const m=await import('../src/main/services/upLoad/xhsSafeDraft.js');assert.equal(typeof m.bindXhsLocalDraft,'function','automatic draft binding is missing');
  const cp={createdAt:1000,updatedAt:4000,baseline:{empty:true},sourceMedia:{size:99,width:1920,height:1080,duration:29.7}};
  const record={keyHash:'draft-1',timeStamp:2000,ownerMatched:true,media:{fileIdHash:'asset-1',videoIdHash:'video-1',size:99,width:1920,height:1080,duration:29.7},titlePaths:['content.draftStore.title'],descriptionPaths:['content.draftStore.desc'],cover:{isUpload:true,isUserSelect:true,fileIdHash:'cover-1'}};
  const local={scope:'browser-local',count:1,records:[record]};assert.equal(m.bindXhsLocalDraft(cp,local).keyHash,'draft-1');
  for(const change of [{ownerMatched:false},{timeStamp:500},{media:{...record.media,fileIdHash:null}},{media:{...record.media,size:98}},{media:{...record.media,duration:30.9}},...([undefined,NaN,Infinity,'29.7',0,-1].map(duration=>({media:{...record.media,duration}})))])assert.throws(()=>m.bindXhsLocalDraft(cp,{...local,records:[{...record,...change}]}));
  assert.throws(()=>m.bindXhsLocalDraft({...cp,targetDraft:{keyHash:'other',media:record.media}},local));assert.throws(()=>m.bindXhsLocalDraft(cp,{...local,count:2}));
  assert.throws(()=>m.bindXhsLocalDraft(cp,{...local,records:[{...record,titlePaths:[]}]},{requireContent:true}));assert.equal(m.bindXhsLocalDraft(cp,local,{requireContent:true}).cover.fileIdHash,'cover-1');
});

test('an incomplete or mismatched xhs checkpoint cannot open a recovery window',async t=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildSync}=await import('esbuild'),{createRequire}=await import('node:module');const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-query-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');const compiled=path.join(dir,'query.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsDraft.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:compiled});const {queryXhsDraft}=createRequire(import.meta.url)(compiled);
  const checkpointPath=path.join(dir,'checkpoint.json'),expected={clientTaskId:'task',title:'标题',description:'简介',checkpointPath};const cp={platform:'xhs',scope:'browser-local',partition:'persist:测试小红书',clientTaskId:'task',title:'标题',description:'简介'};
  for(const fields of [{},{clientTaskId:'other'},{partition:'persist:其他小红书'},{title:'不同'}]){await fs.writeFile(checkpointPath,JSON.stringify({...cp,...fields}));const reply=await queryXhsDraft({phone:'测试',expected},{withPage:()=>assert.fail('unproved target must never recover')});assert.equal(reply.ok,false);assert.match(reply.message,/未完成|不匹配/);}
});
