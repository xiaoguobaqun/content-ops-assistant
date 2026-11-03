import test from 'node:test';
import assert from 'node:assert/strict';
test('engine arguments always carry explicit mode, visibility, cover and literal text', async()=>{
  const {publishArgs}=await import('../src/engine.mjs');
  const job={id:'job-1',input:{phone:'测试账号',title:'a; $(b)',description:'说明',mode:'publish',visibility:'private',creativeStatement:'none'},files:{video:{path:'/tmp/素材 a.mov'},cover:{path:'/tmp/封面 a.jpg'}}};
  const args=publishArgs(job);
  assert.equal(args[args.indexOf('--visibility')+1],'private');
  assert.equal(args[args.indexOf('--title')+1],'a; $(b)');
  assert.equal(args[args.indexOf('--cover')+1],'/tmp/封面 a.jpg');
  assert.ok(args.includes('--publish')); assert.ok(!args.includes('--draft'));
  job.input.mode='draft'; assert.ok(publishArgs(job).includes('--draft'));
});
test('engine reply parser rejects log noise and extracts the structured receipt',async()=>{
  const {parseEngineReply}=await import('../src/engine.mjs');
  assert.deepEqual(parseEngineReply('startup\n{"noise":true}\n{"channel":"puppeteerFile-done","resultStatus":"draft"}\nend\n','puppeteerFile-done'),{channel:'puppeteerFile-done',resultStatus:'draft'});
  assert.throws(()=>parseEngineReply('no receipt','puppeteerFile-done'),/回执/);
});
test('desktop login keeps the shared session and opens the official window for SMS verification',async()=>{
  const {loginArgs}=await import('../src/engine.mjs');
  const args=loginArgs('分组A','/tmp/登录图.png');assert.ok(args.includes('--save-qr-png'));assert.equal(args[args.indexOf('--phone')+1],'分组A');assert.ok(!args.includes('--force'));assert.ok(args.includes('--show'));
});
test('sph arguments route a draft with exact short title and omit douyin-only options',async()=>{
  const {publishArgs,loginArgs}=await import('../src/engine.mjs');
  const job={id:'job-sph',input:{platform:'sph',phone:'品牌',title:'视频标题',description:'简介',shortTitle:'本次测试短标题',mode:'draft',visibility:'unknown',creativeStatement:'none'},files:{video:{path:'/tmp/v.mov'},cover:{path:'/tmp/c.jpg'}}};
  const args=publishArgs(job);assert.equal(args[args.indexOf('--platform')+1],'sph');assert.ok(args.includes('--draft'));assert.equal(args[args.indexOf('--short-title')+1],'本次测试短标题');
  assert.ok(!args.includes('--visibility'));assert.ok(!args.includes('--creative-statement'));assert.equal(loginArgs('品牌','/tmp/qr.png','sph')[2],'sph');
  assert.throws(()=>publishArgs({...job,input:{...job.input,mode:'publish'}}),/草稿|暂未/);
});
test('sph login makes the native WeChat verification window available without exporting a session',async()=>{
  const {loginArgs}=await import('../src/engine.mjs');const args=loginArgs('视频号测试','/tmp/qr.png','sph');
  assert.ok(args.includes('--show'));assert.ok(!args.includes('--browser'));assert.ok(!args.includes('--force'));
});

test('xhs login and draft preparation are available while real execution remains gated',async()=>{
  const {loginArgs,publishArgs}=await import('../src/engine.mjs');const {getPlatform}=await import('../src/platforms.mjs');
  assert.equal(getPlatform('xhs').loginEnabled,true);assert.equal(getPlatform('xhs').enabled,true);assert.equal(getPlatform('xhs').executionEnabled,false);
  const args=loginArgs('小红书测试','/tmp/xhs-qr.png','xhs');assert.ok(args.includes('--show'));assert.equal(args[2],'xhs');
  const {assertPlatformExecution}=await import('../src/platforms.mjs');assert.throws(()=>assertPlatformExecution({platform:'xhs',mode:'draft',visibility:'unknown',title:'标题'}),/验收|执行/);
});

test('xhs login requires an explicit matching authentication receipt even when the process exits zero',async()=>{
  const {confirmEngineLogin}=await import('../src/engine.mjs');
  assert.throws(()=>confirmEngineLogin({code:0,stdout:'process ended'},{platform:'xhs',phone:'测试'}),/回执|核实/);
  const reply={channel:'xhs-login',platform:'xhs',partition:'persist:测试小红书',ok:true};
  assert.equal(confirmEngineLogin({code:0,stdout:JSON.stringify(reply)},{platform:'xhs',phone:'测试'}).ok,true);
  assert.throws(()=>confirmEngineLogin({code:0,stdout:JSON.stringify({...reply,partition:'persist:其他小红书'})},{platform:'xhs',phone:'测试'}),/账号|分区|核实/);
});

test('xhs draft arguments preserve 20-character content and use an independent checkpoint',async()=>{
  const {publishArgs,draftQuerySpec}=await import('../src/engine.mjs');const job={id:'xhs-task',input:{platform:'xhs',phone:'小红书测试',title:'一二三四五六七八九十一二三四五六七八九十',description:'正文',mode:'draft',visibility:'unknown',creativeStatement:'none'},files:{video:{path:'/tmp/v.mov',sha256:'v'},cover:{path:'/tmp/c.jpg',sha256:'c'}}};const args=publishArgs(job);
  assert.equal(args[args.indexOf('--title')+1],job.input.title);assert.match(args[args.indexOf('--checkpoint-file')+1],/xhs-checkpoint\.json$/);for(const opt of ['--short-title','--visibility','--creative-statement','--publish'])assert.equal(args.includes(opt),false);
  const query=draftQuerySpec(job);assert.equal(query.args[0],'xhs-draft');assert.equal(query.expected.clientTaskId,'xhs-task');assert.match(query.expected.checkpointPath,/xhs-checkpoint\.json$/);
  assert.throws(()=>publishArgs({...job,input:{...job.input,title:job.input.title+'一'}}),/20/);assert.throws(()=>publishArgs({...job,input:{...job.input,shortTitle:'无效的短标题'}}),/短标题/);
});
test('抖音登录组件重复加载失败时显示固定原因，不暴露页面错误或凭据',async()=>{
  const {confirmEngineLogin}=await import('../src/engine.mjs');
  const reply={channel:'dy-login',ok:false,reason:'login-component-load-failed',message:'private page token must not be displayed'};
  assert.throws(()=>confirmEngineLogin({code:3,stdout:JSON.stringify(reply)},{platform:'dy'}),/登录组件.*加载失败/);
  assert.throws(()=>confirmEngineLogin({code:3,stdout:JSON.stringify({...reply,reason:'unrecognized'})},{platform:'dy'}),/登录未完成/);
});
