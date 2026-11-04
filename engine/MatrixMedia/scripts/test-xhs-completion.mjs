import test from 'node:test';import assert from 'node:assert/strict';
const videoSha='a'.repeat(64),coverSha='b'.repeat(64);
function fixture(){return {cp:{platform:'xhs',scope:'browser-local',partition:'persist:验收小红书',clientTaskId:'task',title:'标题',description:'正文',stage:'text-started',createdAt:1000,updatedAt:2000,baseline:{empty:true},uploadSelectionSha:videoSha,sourceMedia:{size:99,width:1920,height:1080,duration:29.7},files:{video:{path:'/tmp/video.mov',sha256:videoSha},cover:{path:'/tmp/cover.jpg',sha256:coverSha}}},expected:{action:'complete-existing-draft',platform:'xhs',clientTaskId:'task',title:'标题',description:'正文',checkpointPath:'/tmp/checkpoint.json',sourceVideoSha:videoSha,sourceCoverSha:coverSha}};}
test('completion requires explicit matching task, original selected file proof and a pre-save stage',async()=>{
 const m=await import('../src/main/services/upLoad/xhsCompletionCore.js');const {cp,expected}=fixture();assert.equal(m.validateXhsCompletionCheckpoint(cp,expected,'persist:验收小红书'),cp);
 for(const change of [{stage:'editor-audited'},{stage:'saving'},{stage:'save-click-started'},{stage:'saved-local-unverified'},{stage:'verified-local'},{baseline:{empty:false}},{uploadSelectionSha:'c'.repeat(64)},{partition:'persist:其他小红书'},{clientTaskId:'other'},{sourceMedia:{...cp.sourceMedia,duration:NaN}}])assert.throws(()=>m.validateXhsCompletionCheckpoint({...cp,...change},expected,'persist:验收小红书'));
 for(const change of [{action:'verify'},{sourceVideoSha:'c'.repeat(64)},{sourceCoverSha:'c'.repeat(64)},{description:'其他正文'}])assert.throws(()=>m.validateXhsCompletionCheckpoint(cp,{...expected,...change},'persist:验收小红书'));
 const invalid=structuredClone(cp);invalid.files.video.sha256=videoSha+'a';invalid.uploadSelectionSha=invalid.files.video.sha256;assert.throws(()=>m.validateXhsCompletionCheckpoint(invalid,{...expected,sourceVideoSha:invalid.files.video.sha256},'persist:验收小红书'));
});
test('completion pipeline has no video upload or publication step and stops at each failed prerequisite',async()=>{
 const m=await import('../src/main/services/upLoad/xhsCompletionCore.js'),stages=['bind','open','text','cover','inspect','checkpoint','save'];
 for(const failed of [null,...stages]){const calls=[];const steps=Object.fromEntries(stages.map(key=>[key,async()=>{calls.push(key);if(key===failed)throw Error('failed '+key);return key==='inspect'?{ok:true,videoIdentity:'video',coverIdentity:'cover'}:undefined;}]));steps.upload=()=>assert.fail('must never reupload');steps.publish=()=>assert.fail('must never publish');
  if(failed)await assert.rejects(m.executeSafeXhsCompletion(steps),/failed/);else await m.executeSafeXhsCompletion(steps);assert.deepEqual(calls,failed?stages.slice(0,stages.indexOf(failed)+1):stages);
 }
 let saved=0,cancelled=false;const steps=Object.fromEntries(stages.map(key=>[key,async()=>key==='inspect'?{ok:true,videoIdentity:'video'}:undefined]));steps.save=async()=>saved++;await assert.rejects(m.executeSafeXhsCompletion(steps),/核实/);assert.equal(saved,0);
 steps.inspect=async()=>({ok:true,videoIdentity:'video',coverIdentity:'cover'});steps.checkpoint=async()=>{cancelled=true;};steps.checkCancelled=()=>{if(cancelled)throw Error('cancelled');};await assert.rejects(m.executeSafeXhsCompletion(steps),/cancelled/);assert.equal(saved,0);
});
test('completion CLI accepts only an explicit expected file and never exposes upload or publish flags',async()=>{
 const {parseXhsCompletionArgs}=await import('../src/main/cli/parseXhsCompletionArgs.js');const base=['--phone','验收','--expected-file','/tmp/expected.json'];assert.equal(parseXhsCompletionArgs(base).ok,true);
 for(const extra of [['--publish'],['--draft'],['--file','/tmp/video.mov'],['--inspect'],['--force']])assert.equal(parseXhsCompletionArgs([...base,...extra]).ok,false);
 assert.equal(parseXhsCompletionArgs(['--phone','验收','--expected-file','relative.json']).ok,false);
 for(const phone of [' ','有\n换行','../other'])assert.equal(parseXhsCompletionArgs(['--phone',phone,'--expected-file','/tmp/expected.json']).ok,false);
});

test('completion service claims and rereads the checkpoint before a page, rejects changed files and post-save states',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildSync}=await import('esbuild'),{createRequire}=await import('node:module'),{createHash}=await import('node:crypto'),{spawnSync}=await import('node:child_process');
 const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-complete-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 const compiled=path.join(dir,'completion.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsCompletion.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:compiled});const {completeXhsDraft}=createRequire(import.meta.url)(compiled);
 const video=path.join(dir,'video.mp4'),cover=path.join(dir,'cover.jpg');assert.equal(spawnSync('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);await fs.writeFile(cover,'cover bytes');
 const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),{cp,expected}=fixture();cp.files={video:{path:video,sha256:await hash(video)},cover:{path:cover,sha256:await hash(cover)}};cp.sourceMedia={size:(await fs.stat(video)).size,width:160,height:90,duration:0.2};cp.uploadSelectionSha=cp.files.video.sha256;expected.sourceVideoSha=cp.files.video.sha256;expected.sourceCoverSha=cp.files.cover.sha256;expected.checkpointPath=path.join(dir,'checkpoint.json');
 await fs.writeFile(expected.checkpointPath,JSON.stringify(cp));let opened=0;const withPage=async()=>{opened++;throw Error('fixture page unavailable');};
 const first=await completeXhsDraft({phone:'验收',expected},{withPage});assert.equal(first.message,'fixture page unavailable');assert.equal(opened,1);await assert.rejects(fs.access(expected.checkpointPath+'.completion.lock'));
 await fs.writeFile(expected.checkpointPath,JSON.stringify({...cp,stage:'save-click-started'}));assert.match((await completeXhsDraft({phone:'验收',expected},{withPage})).message,/阶段|回查/);assert.equal(opened,1);
 await fs.writeFile(expected.checkpointPath,JSON.stringify(cp));await fs.appendFile(video,'change');assert.match((await completeXhsDraft({phone:'验收',expected},{withPage})).message,/变化/);assert.equal(opened,1);
 const lock=expected.checkpointPath+'.completion.lock';await fs.writeFile(lock,'another-owner');assert.match((await completeXhsDraft({phone:'验收',expected},{withPage})).message,/占用/);assert.equal(await fs.readFile(lock,'utf8'),'another-owner');
});

test('post-save interruption can bootstrap evidence only from a strongly matching readonly draft, never by saving again',async()=>{
 const m=await import('../src/main/services/upLoad/xhsSafeDraft.js');assert.equal(typeof m.reconcileXhsSavedDraft,'function');const {cp}=fixture();
 cp.stage='save-click-started';cp.coverIdentity='sha256:'+'f'.repeat(64);cp.sourceCoverSha=coverSha;cp.videoIdentity='sha256:'+'d'.repeat(64);
 const media={...cp.sourceMedia,fileIdHash:cp.videoIdentity,videoIdHash:'sha256:'+'e'.repeat(64)};cp.targetDraft={keyHash:'sha256:'+'c'.repeat(64),media};
 const record={keyHash:cp.targetDraft.keyHash,ownerMatched:true,media,materialHash:'sha256:'+'1'.repeat(64),titlePaths:['content.draftStore.title'],descriptionPaths:['content.draftStore.desc'],cover:{fileIdHash:'sha256:'+'2'.repeat(64),isUpload:true,isUserSelect:true}};
 const local={scope:'browser-local',count:1,records:[record]},original=structuredClone(cp);assert.equal(m.canReconcileXhsCheckpoint(cp),true);const reconciled=m.reconcileXhsSavedDraft(cp,local);assert.equal(reconciled.targetDraft.materialHash,record.materialHash);assert.deepEqual(cp,original);
 for(const change of [{stage:'text-started'},{coverIdentity:null},{sourceCoverSha:'c'.repeat(64)},{uploadSelectionSha:null},{videoIdentity:'other'}])assert.throws(()=>m.reconcileXhsSavedDraft({...cp,...change},local));
 for(const change of [{ownerMatched:false},{titlePaths:[]},{cover:{...record.cover,isUpload:false}},{media:{...media,videoIdHash:'different'}}])assert.throws(()=>m.reconcileXhsSavedDraft(cp,{...local,records:[{...record,...change}]}));
 assert.throws(()=>m.reconcileXhsSavedDraft(cp,{...local,count:2}));
});

test('readonly recovery may inspect a dead completion owner without removing its lock or enabling another save',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildSync}=await import('esbuild'),{createRequire}=await import('node:module');
 const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-stale-query-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');const compiled=path.join(dir,'query.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsDraft.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:compiled});const {queryXhsDraft}=createRequire(import.meta.url)(compiled);
 const {cp,expected}=fixture();cp.stage='saved-local-unverified';cp.coverIdentity='cover';cp.targetDraft={keyHash:'key',materialHash:'material'};expected.checkpointPath=path.join(dir,'checkpoint.json');await fs.writeFile(expected.checkpointPath,JSON.stringify(cp));const lock=expected.checkpointPath+'.completion.lock';let opened=0;
 const withPage=async()=>{opened++;throw Error('readonly fixture reached');};
 await fs.writeFile(lock,JSON.stringify({pid:process.pid}));assert.match((await queryXhsDraft({phone:'验收',expected},{withPage})).message,/补全/);assert.equal(opened,0);
 const stale=JSON.stringify({pid:99999999});await fs.writeFile(lock,stale);assert.equal((await queryXhsDraft({phone:'验收',expected},{withPage})).message,'readonly fixture reached');assert.equal(opened,1);assert.equal(await fs.readFile(lock,'utf8'),stale);
});

test('native completion cancellation cleans its claim before returning for signals and app quit',async t=>{
 const fs=await import('node:fs/promises'),sync=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildSync}=await import('esbuild'),{createHash}=await import('node:crypto'),{spawnSync,spawn}=await import('node:child_process');
 const root=fileURLToPath(new URL('../',import.meta.url)),dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-completion-stop-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');const compiled=path.join(dir,'completion.cjs');buildSync({entryPoints:[path.join(root,'src/main/services/xhsCompletion.js')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:compiled});
 const video=path.join(dir,'v.mp4'),cover=path.join(dir,'c.jpg');assert.equal(spawnSync('/opt/homebrew/bin/ffmpeg',['-v','error','-f','lavfi','-i','color=blue:s=160x90:d=0.2','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);await fs.writeFile(cover,'cover bytes');const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 for(const signal of ['SIGINT','SIGTERM','app-quit']){
  const work=path.join(dir,signal);await fs.mkdir(work);const {cp,expected}=fixture();cp.files={video:{path:video,sha256:await sha(video)},cover:{path:cover,sha256:await sha(cover)}};cp.uploadSelectionSha=cp.files.video.sha256;cp.sourceMedia={size:(await fs.stat(video)).size,width:160,height:90,duration:0.2};expected.sourceVideoSha=cp.files.video.sha256;expected.sourceCoverSha=cp.files.cover.sha256;expected.checkpointPath=path.join(work,'checkpoint.json');await fs.writeFile(expected.checkpointPath,JSON.stringify(cp));
  const ready=path.join(work,'ready'),resultFile=path.join(work,'result.json'),entry=path.join(work,'main.cjs');
  await fs.writeFile(entry,`const {app}=require('electron'),fs=require('node:fs');const {completeXhsDraft}=require(${JSON.stringify(compiled)});app.setPath('userData',${JSON.stringify(path.join(work,'profile'))});app.whenReady().then(async()=>{const keep=setInterval(()=>{},1000);const reply=await completeXhsDraft({phone:'验收',expected:${JSON.stringify(expected)}},{withPage:async(_p,_read,options)=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');if(${JSON.stringify(signal)}==='app-quit')setTimeout(()=>app.quit(),80);return new Promise((resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}});fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify(reply));clearInterval(keep);app.exit(reply.ok?0:4);});`);
  const child=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[entry],{env,detached:true,stdio:['ignore','pipe','pipe']});child.stdout.resume();let stderr='',sent=false;child.stderr.on('data',b=>stderr+=b);const ticker=setInterval(()=>{if(!sent&&sync.existsSync(ready)){sent=true;if(signal!=='app-quit')child.kill(signal);}},30);
  try{const code=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}reject(Error('completion cancellation timed out'));},10000);child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);resolve(code);});});assert.equal(code,4,stderr);assert.equal(sent,true);assert.equal(JSON.parse(await fs.readFile(resultFile)).ok,false);await assert.rejects(fs.access(expected.checkpointPath+'.completion.lock'));}
  finally{clearInterval(ticker);try{process.kill(-child.pid,'SIGKILL');}catch{}}
 }
});
