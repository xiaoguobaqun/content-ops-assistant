import {mediaTool} from '../src/runtime-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync,spawn } from 'node:child_process';

let fixture;
test.before(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'content-ops-fixture-'));
  const r = spawnSync(mediaTool('ffmpeg'), ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=0.3','-c:v','libx264','-pix_fmt','yuv420p',path.join(fixture,'素材 $a; `b`.mp4')]);
  assert.equal(r.status, 0, r.stderr?.toString());
});
test.after(async () => { await fs.rm(fixture,{recursive:true,force:true}); });
async function context(t, extras={}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'content-ops-job-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  return {root,input:{phone:'测试账号',video:path.join(fixture,'素材 $a; `b`.mp4'),title:'测试 $a; `b`',description:'仅用于私密测试',...extras}};
}
const api = () => import('../src/jobs.mjs');

test('prepare validates local media, defaults private and extracts a real 3:4 cover', async t => {
  const {prepareJob} = await api(); const {root,input} = await context(t);
  const job = await prepareJob(input,{root});
  assert.equal(job.input.visibility,'private'); assert.equal(job.state,'prepared');
  const r = spawnSync(mediaTool('ffprobe'),['-v','error','-show_entries','stream=width,height','-of','json',job.files.cover.path]);
  const cover = JSON.parse(r.stdout).streams[0]; assert.equal(cover.width/cover.height, 3/4);
  await assert.rejects(prepareJob({...input,video:'/missing/video.mov'},{root}), /视频|不存在|ENOENT/);
  await assert.rejects(prepareJob({...input,visibility:'typo'},{root}), /可见范围/);
  await assert.rejects(prepareJob({...input,cover:'/missing/cover.jpg'},{root}), /封面|ENOENT/);
});
test('a confirmed draft cannot be run twice and needs recovery evidence', async t => {
  const {prepareJob,runJob} = await api(); const {root,input} = await context(t);
  const job = await prepareJob(input,{root}); let calls=0;
  const engine = {publish:async()=>{calls++;return {resultStatus:'draft',draftEvidence:{ok:true}};}};
  assert.equal((await runJob(job.id,{root,engine})).state,'draft_confirmed');
  assert.equal((await runJob(job.id,{root,engine})).state,'draft_confirmed'); assert.equal(calls,1);
  const weak = await prepareJob(input,{root});
  assert.equal((await runJob(weak.id,{root,engine:{publish:async()=>({resultStatus:'draft'})}})).state,'unknown');
});
test('interrupted submission stays unknown and cannot replay', async t => {
  const {prepareJob,runJob,readJob} = await api(); const {root,input} = await context(t);
  const job = await prepareJob(input,{root}); let calls=0;
  const engine = {publish:async()=>{calls++; assert.equal((await readJob(job.id,{root})).state,'running'); throw Error('connection lost');}};
  assert.equal((await runJob(job.id,{root,engine})).state,'unknown');
  await runJob(job.id,{root,engine}); assert.equal(calls,1);
});
test('changed cover or video is rejected before engine invocation', async t => {
  const {prepareJob,runJob} = await api(); const {root,input} = await context(t);
  const job = await prepareJob(input,{root}); await fs.appendFile(job.files.cover.path,'changed');
  await assert.rejects(runJob(job.id,{root,engine:{publish:()=>assert.fail('must not submit')}}), /变化|重新准备/);
});
test('account lock blocks simultaneous execution across different jobs', async t => {
  const {prepareJob,runJob} = await api(); const {root,input} = await context(t);
  const a=await prepareJob(input,{root}), b=await prepareJob(input,{root});
  let unblock, began; const started=new Promise(r=>began=r); const gate=new Promise(r=>unblock=r);
  const first=runJob(a.id,{root,engine:{publish:async()=>{began();await gate;return {};}}});
  await started;
  try { await assert.rejects(runJob(b.id,{root,engine:{publish:()=>assert.fail()}}),/正在|锁/); }
  finally {unblock(); await first;}
});
test('publish is confirmed only by fresh matching content and visibility; verify never publishes', async t => {
  const {prepareJob,runJob,verifyJob} = await api(); const {root,input} = await context(t,{mode:'publish'});
  const job=await prepareJob(input,{root}); let queries=0, publishes=0;
  const old={workId:'7702023091953618216',title:input.title,description:input.description,publishTime:1,visibility:'private'};
  const engine={publish:async()=>{publishes++;return {outcome:'submission_unknown'};},query:async()=>({complete:true,works:++queries===1?[old]:[old,{...old,workId:'7702023091953618217',publishTime:Date.now()}]})};
  const result=await runJob(job.id,{root,engine}); assert.equal(result.state,'confirmed'); assert.equal(result.platformWorkId,'7702023091953618217');
  await verifyJob(job.id,{root,engine}); assert.equal(publishes,1);
});
test('failed baseline prevents actual submit and unsafe job paths are rejected', async t => {
  const {prepareJob,runJob,readJob} = await api(); const {root,input} = await context(t,{mode:'publish'});
  const job=await prepareJob(input,{root});
  const result=await runJob(job.id,{root,engine:{query:async()=>({complete:false,works:[]}),publish:()=>assert.fail('incomplete baseline must stop')}});
  assert.equal(result.state,'unknown');
  await assert.rejects(readJob('../../secrets',{root}), /编号/);
});
test('a newly created work keeps its identity while privacy is unknown and later verifies without reupload',async t=>{
  const {prepareJob,runJob,verifyJob,readJob}=await api();const {root,input}=await context(t,{mode:'publish',visibility:'public'});
  const job=await prepareJob(input,{root});let queries=0,publishes=0,visibility=null;
  const work={workId:'7702023091953618217',title:input.title,description:input.description,publishTime:Date.now(),visibility};
  const engine={publish:async()=>{publishes++;return {outcome:'submission_unknown'};},query:async()=>({complete:true,works:++queries===1?[]:[{...work,publishTime:Date.now(),visibility}]})};
  const result=await runJob(job.id,{root,engine});
  assert.equal(result.state,'unknown');assert.equal(result.platformWorkId,work.workId);
  assert.equal(result.verification.creation.status,'confirmed');assert.equal(result.verification.visibility.status,'unknown');assert.equal(result.moderation,'unknown');
  assert.match(result.message,/已创建/);assert.match(result.message,/公开/);assert.match(result.message,/核实/);
  assert.equal((await readJob(job.id,{root})).platformWorkId,work.workId);
  await runJob(job.id,{root,engine});assert.equal(publishes,1);
  visibility='private';const mismatch=await verifyJob(job.id,{root,engine});assert.equal(mismatch.state,'unknown');assert.equal(mismatch.verification.visibility.status,'unknown');assert.equal(mismatch.verification.creation.status,'confirmed');
  visibility='public';const checked=await verifyJob(job.id,{root,engine});
  assert.equal(checked.state,'confirmed');assert.equal(checked.verification.visibility.status,'confirmed');assert.equal(checked.moderation,'unknown');assert.equal(checked.message,undefined);assert.equal(publishes,1);
});
test('work creation is persisted before the separate identity lookup can fail',async t=>{
  const {prepareJob,runJob,readJob}=await api();const {root,input}=await context(t,{mode:'publish'});const job=await prepareJob(input,{root});let queries=0,publishes=0;
  const engine={publish:async()=>{publishes++;return {outcome:'submission_unknown'};},query:async(phone,workId)=>{
    if(++queries===1)return {complete:true,works:[]};
    if(queries===2)return {complete:true,works:[{workId:'7702023091953618217',title:input.title,description:input.description,publishTime:Date.now(),visibility:null}]};
    const persisted=await readJob(job.id,{root});assert.equal(workId,'7702023091953618217');assert.equal(persisted.platformWorkId,workId);assert.equal(persisted.verification.creation.status,'confirmed');
    throw Error('platform exception: Cookie=private-review-value');
  }};
  const result=await runJob(job.id,{root,engine});assert.equal(result.state,'unknown');assert.equal(result.platformWorkId,'7702023091953618217');assert.match(result.message,/已创建/);assert.match(result.message,/回查未完成/);assert.doesNotMatch(result.message,/Cookie|private-review-value/);
  await runJob(job.id,{root,engine});assert.equal(publishes,1);
});
test('a failed result query shows its safe cause while preserving creation and preventing replay',async t=>{
  const {prepareJob,runJob,verifyJob}=await api();const {root,input}=await context(t,{mode:'publish'});const job=await prepareJob(input,{root});let queries=0,publishes=0;
  const engine={publish:async()=>{publishes++;return {outcome:'submission_unknown'};},query:async()=>{
    if(++queries===1)return {complete:true,works:[]};
    if(queries===2)return {complete:true,works:[{workId:'7702023091953618217',title:input.title,description:input.description,publishTime:Date.now(),visibility:null}]};
    return {complete:false,works:[],reason:'work_list_http',message:'Cookie=private-review-value'};
  }};
  const result=await runJob(job.id,{root,engine});assert.equal(result.state,'unknown');assert.equal(result.platformWorkId,'7702023091953618217');assert.match(result.message,/已创建/);assert.match(result.message,/接口请求失败/);assert.doesNotMatch(result.message,/Cookie|private-review-value/);
  const checked=await verifyJob(job.id,{root,engine});assert.equal(checked.verification.creation.status,'confirmed');assert.match(checked.message,/接口请求失败/);
  await runJob(job.id,{root,engine});assert.equal(publishes,1);
});
test('ambiguous new works and same-content old works never acquire a created-work identity',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t,{mode:'publish'});
  const work={workId:'7702023091953618217',title:input.title,description:input.description,visibility:'private'};
  for(const scenario of ['old','ambiguous']){
    const job=await prepareJob(input,{root});let queries=0;
    const engine={publish:async()=>({outcome:'submission_unknown'}),query:async()=>({complete:true,works:++queries===1?(scenario==='old'?[{...work,publishTime:1}]:[]):scenario==='old'?[{...work,publishTime:1}]:[{...work,publishTime:Date.now()},{...work,workId:'7702023091953618218',publishTime:Date.now()}]})};
    const result=await runJob(job.id,{root,engine});assert.equal(result.state,'unknown');assert.equal(result.platformWorkId,undefined);assert.equal(result.verification.creation.status,'unknown');
  }
});
test('baseline failures show a safe actionable cause while keeping submission blocked',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t,{mode:'publish'});
  for(const [failure,expected] of [[{reason:'work_list_http'},/接口请求失败/],[{reason:'missing_cursor'},/分页/],[{message:'登录态失效，请先登录'},/登录/],[{reason:'Cookie: private-value',message:'secret private-value'},/原因尚未识别/]]){
    const job=await prepareJob(input,{root});let calls=0;const engine={query:async()=>({complete:false,works:[],...failure}),publish:async()=>{calls++;}};
    const result=await runJob(job.id,{root,engine});assert.equal(result.state,'unknown');assert.match(result.message,expected);assert.match(result.message,/停止/);assert.doesNotMatch(result.message,/private-value/);
    await runJob(job.id,{root,engine});assert.equal(calls,0);
  }
});
test('an interrupted legacy guard cannot permanently block acquisition',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t);
  const job=await prepareJob(input,{root});await fs.mkdir(path.join(root,process.platform==='win32'?'engine.lock.legacy-guard':'engine.lock.guard'));
  const result=await runJob(job.id,{root,engine:{publish:async()=>({resultStatus:'draft',draftEvidence:{ok:true}})}});
  assert.equal(result.state,'draft_confirmed');
});
test('dead wrapper ownership cannot be reclaimed while its engine group remains alive',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t);const job=await prepareJob(input,{root});
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  await new Promise(r=>child.once('spawn',r));
  try{
    await fs.writeFile(path.join(root,'engine.lock'),JSON.stringify({pid:99999999,phase:'running',pgid:child.pid}));
    await assert.rejects(runJob(job.id,{root,engine:{publish:()=>assert.fail('orphan engine still owns account')}}),/进程|引擎|运行/);
  }finally{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM');await new Promise(r=>child.once('close',r));}
});
test('verification mismatch retains unknown and never runs publish again',async t=>{
  const {prepareJob,runJob,verifyJob}=await api();const {root,input}=await context(t);const job=await prepareJob(input,{root});
  const engine={publish:async()=>({resultStatus:'draft',draftEvidence:{ok:true}}),queryDraft:async()=>({ok:false,evidence:{ok:false},preserved:true})};
  await runJob(job.id,{root,engine});const result=await verifyJob(job.id,{root,engine});assert.equal(result.state,'unknown');assert.equal(result.verification.preserved,true);
});
test('kernel releases account ownership when the wrapper dies during acquisition',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t);const job=await prepareJob(input,{root});
  const moduleUrl=new URL('../src/lock.mjs',import.meta.url).href;
  const script=`import {withEngineLock} from ${JSON.stringify(moduleUrl)};await withEngineLock(process.argv[1],async()=>process.exit(7));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,root],{encoding:'utf8'});
  assert.equal(child.status,7,child.stderr);
  const result=await runJob(job.id,{root,engine:{publish:async()=>({resultStatus:'draft',draftEvidence:{ok:true}})}});
  assert.equal(result.state,'draft_confirmed');
});
test('cancellation between baseline lookup and submission never calls the publisher',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t,{mode:'publish'});const job=await prepareJob(input,{root});
  const {createDesktopService}=await import('../desktop/service-core.mjs');const controller=new AbortController();let entered,release,calls=0;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const service=createDesktopService({root,signal:controller.signal,engine:{query:async()=>{entered();await gate;return {complete:true,works:[]};},publish:async()=>{calls++;return {};}}});
  await service.handle('execute',{id:job.id,expectedDigest:job.inputDigest});await started;controller.abort(Error('操作已停止，请先回查'));release();await service.waitForIdle();
  const {readJob}=await api();const result=await readJob(job.id,{root});assert.equal(calls,0);assert.equal(result.state,'unknown');assert.match(result.message,/停止/);
});
test('sph tasks bind platform and require independent identity-matched preservation evidence',async t=>{
  const {prepareJob,runJob,verifyJob,readJob}=await api();const {root,input}=await context(t,{platform:'sph',shortTitle:'本次测试短标题'});
  const job=await prepareJob(input,{root});assert.equal(job.input.platform,'sph');assert.equal(job.input.visibility,'unknown');
  let publishes=0,queries=0;const engine={publish:async()=>{publishes++;return {resultStatus:'draft',draftEvidence:{ok:true}};},queryDraft:async current=>{queries++;return {ok:true,evidence:{ok:true,preserved:true,platform:'sph',clientTaskId:current.id}};}};
  const result=await runJob(job.id,{root,engine});assert.equal(result.state,'draft_confirmed');assert.equal(queries,1);await runJob(job.id,{root,engine});assert.equal(publishes,1);
  const mismatch=await verifyJob(job.id,{root,engine:{queryDraft:async()=>({ok:true,evidence:{ok:true,preserved:true,platform:'sph',clientTaskId:'other-job'}})}});assert.equal(mismatch.state,'unknown');
  const altered=await prepareJob(input,{root});const file=path.join(root,'jobs',altered.id,'job.json');await fs.writeFile(file,JSON.stringify({...altered,input:{...altered.input,platform:'dy'}}));
  await assert.rejects(runJob(altered.id,{root,engine}),/变化/);assert.equal((await readJob(altered.id,{root})).state,'prepared');
});
test('sph weak receipts and missing draft query never confirm; unsupported modes stop before media work',async t=>{
  const {prepareJob,runJob}=await api();const {root,input}=await context(t,{platform:'sph'});
  const job=await prepareJob(input,{root});assert.equal((await runJob(job.id,{root,engine:{publish:async()=>({resultStatus:'draft',draftEvidence:{ok:true}})}})).state,'unknown');
  for(const change of [{platform:'typo'},{platform:'xhs',title:'一'.repeat(21)},{mode:'publish'},{visibility:'private'},{creativeStatement:'marketing'}])await assert.rejects(prepareJob({...input,...change},{root}),/平台|草稿|范围|声明|暂未|最多/);
});
test('verification needs an intact task record but does not require uploaded source files to remain',async t=>{
  const {prepareJob,runJob,verifyJob}=await api();const {root,input}=await context(t);const video=path.join(root,'movable.mp4');await fs.copyFile(input.video,video);
  const job=await prepareJob({...input,video},{root});let uploads=0;const engine={publish:async()=>{uploads++;return {resultStatus:'draft',draftEvidence:{ok:true}};},queryDraft:async()=>({ok:true,evidence:{ok:true}})};
  await runJob(job.id,{root,engine});await fs.rm(video);await fs.rm(job.files.cover.path);
  assert.equal((await verifyJob(job.id,{root,engine})).state,'draft_confirmed');assert.equal(uploads,1);
  const file=path.join(root,'jobs',job.id,'job.json');const record=JSON.parse(await fs.readFile(file,'utf8'));record.input.title='篡改';await fs.writeFile(file,JSON.stringify(record));await assert.rejects(verifyJob(job.id,{root,engine}),/变化/);
});

test('xhs can prepare a local draft while the real execution gate prevents any upload before live acceptance',async t=>{
  const {prepareJob,runJob,readJob}=await api();const {root,input}=await context(t,{platform:'xhs'});const job=await prepareJob(input,{root});assert.equal(job.input.platform,'xhs');assert.equal(job.input.visibility,'unknown');await assert.rejects(runJob(job.id,{root,engine:{publish:()=>assert.fail('unaccepted xhs workflow must not upload')}}),/验收|执行/);assert.equal((await readJob(job.id,{root})).state,'prepared');
});
