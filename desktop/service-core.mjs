import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {engine as realEngine,doctor as realDoctor} from '../src/engine.mjs';
import {defaultRoot,prepareJob,runJob,verifyJob,readJob} from '../src/jobs.mjs';
import {jobView,validateInput,validId} from './model.mjs';
import {withCancellation,throwIfCancelled} from '../src/cancellation.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {platforms,getPlatform,platformId,accountPlatform} from '../src/platforms.mjs';
import {createPeopleStore} from '../src/people.mjs';
import {createBatchStore} from '../src/batches.mjs';
import {contentDigest,withLocalLock,atomicJson,processAlive} from '../src/local-store.mjs';
import {withEngineLock} from '../src/lock.mjs';
import {accountGeneration,advanceAccountGeneration} from '../src/account-generation.mjs';
import {createProfileService,profileMethods} from './profile-service.mjs';
import {taskTrashedAt,setTaskTrashed,assertTaskActive} from '../src/task-history.mjs';
import {readVerificationReports} from '../src/verification-report.mjs';

export function createDesktopService({root=defaultRoot,documentsDir,signal,engine=realEngine,doctor=realDoctor,prepare=prepareJob,run=runJob,verify=verifyJob,analyze,onEvent=()=>{}}={}){
  let activity=null,pending=null;let cache={accounts:[],health:null,checkedAt:null};
  const accountStore=createAccountStore({root,documentsDir});
  const view=job=>jobView(job,{active:activity?.status==='running'&&activity.jobId===job.id});
  const cacheFile=path.join(root,'desktop-state.json');
  const emit=event=>{try{onEvent(event);}catch{}};
  const people=createPeopleStore({root});
  const profileService=createProfileService({root,people,engine,idle,start,emit,analyze});
  const batches=createBatchStore({root,people,engine,prepare,run,onProgress:async({batchId,jobId})=>{activity={...activity,batchId,jobId};emit({type:'activity',activity});emit({type:'snapshot',data:await dashboard()});}});
  async function loadCache(){try{cache={...cache,...JSON.parse(await fs.readFile(cacheFile,'utf8'))};}catch{}}
  async function persistCache(){await fs.mkdir(root,{recursive:true,mode:0o700});const temporary=cacheFile+'.tmp';await fs.writeFile(temporary,JSON.stringify(cache),{mode:0o600});await fs.rename(temporary,cacheFile);}
  async function getJob(id,{current=true}={}){let job=await readJob(validId(id),{root});if(job.id!==id||!job.input||!job.files)throw Error('任务记录无效，请检查原始任务文件');if(current&&job.state==='prepared'&&(job.input.accountGeneration??0)!==await accountGeneration(root,job.input))job={...job,state:'invalidated',message:'该账号已移除，旧任务已作废，请重新准备。'};return {...job,trashedAt:await taskTrashedAt(root,job.input.batchId||id),verificationReports:await readVerificationReports(root,id)};}
  async function dashboard(){
    await loadCache();let names=[];try{names=await fs.readdir(path.join(root,'jobs'));}catch{}
    const jobs=[],trash=[],warnings=[];
    for(const id of names){try{const job=await getJob(id);if(!job.input.batchId)(job.trashedAt?trash:jobs).push(view(job));}catch{warnings.push('有一份旧任务无法读取，其余记录可继续使用。');}}
    for(const batch of await batches.list()){const deleted=await taskTrashedAt(root,batch.id),row=activity?.status==='running'&&activity.batchId===batch.id?await batches.view(batch.id,{active:true}):batch;(deleted?trash:jobs).push(deleted?{...row,trashedAt:deleted,canExecute:false,jobs:row.jobs.map(j=>({...j,trashedAt:deleted,canExecute:false,canVerify:false}))}:row);}
    jobs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    let persons=[];try{persons=await people.list();}catch(error){warnings.push(error.message);}
    return {jobs,trash,people:persons,accounts:cache.accounts,platforms,health:cache.health,checkedAt:cache.checkedAt,activity,warnings:[...new Set(warnings)],protocolVersion:1};
  }
  function idle(){if(pending)throw Error('已有操作正在执行，请等待完成');}
  async function removalSelection(args){
    const platform=platformId(args),phone=args.phone;
    if(typeof phone!=='string'||!phone.trim()||phone!==phone.trim()||phone.length>80||/[\x00-\x1f\x7f/\\]/.test(phone))throw Error('账号名称无效');
    await loadCache();if(!cache.accounts.some(a=>accountPlatform(a)===platform&&a.phone===phone))throw Error('账号不存在，请刷新列表');
    const owner=(await people.list()).find(p=>p.bindings[platform]?.phone===phone);
    if(owner)throw Error(`该账号已绑定人员“${owner.name}”，请先在上方将该平台设为“暂不绑定”并保存`);
    return {platform,phone};
  }
  async function invalidatePreparedAccounts({platform,phone}){
    let ids=[];try{ids=await fs.readdir(path.join(root,'jobs'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const id of ids){
      if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id))continue;
      const job=await getJob(id,{current:false});
      if(job.state==='prepared'&&platformId(job.input)===platform&&job.input.phone===phone){job.state='invalidated';job.invalidatedAt=Date.now();job.message='账号移除流程已开始，此任务尚未执行且已作废。重新连接后请重新准备任务。';await atomicJson(path.join(root,'jobs',id,'job.json'),job);}
    }
  }
  function start(kind,details,work){
    idle();activity={id:randomUUID(),kind,status:'running',startedAt:Date.now(),...details};emit({type:'activity',activity});
    pending=Promise.resolve().then(work).then(async result=>{
      const job=result?.id&&result?.input?view(result):null;
      const batch=result?.kind==='batch'?result:null;
      activity={...activity,status:job?.state==='unknown'||batch&&batch.state!=='draft_confirmed'?'attention':'completed',finishedAt:Date.now(),message:job?.message||batch?.message||result?.message||'操作已完成'};
      emit({type:'activity',activity,...(job?{job}:{}),...(batch?{batch}:{})});
      emit({type:'snapshot',data:await dashboard()});
    }).catch(async error=>{activity={...activity,status:'failed',finishedAt:Date.now(),message:error.message||'操作未完成，请回查任务'};emit({type:'activity',activity});emit({type:'snapshot',data:await dashboard()});})
      .finally(()=>{pending=null;});
    return {activity};
  }
  async function handle(method,args={}){
    throwIfCancelled();
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('操作参数无效');
    if(profileMethods.has(method))return profileService.handle(method,args);
    if(method==='dashboard')return dashboard();
    if(method==='runtimeCheck'){idle();return {health:await doctor(),engineHelp:await engine.help()};}
    if(method==='getJob')return view(await getJob(args.id));
    if(method==='getBatch'){const row=await batches.view(validId(args.id),{active:activity?.status==='running'&&activity.batchId===args.id}),deleted=await taskTrashedAt(root,args.id);return deleted?{...row,trashedAt:deleted,canExecute:false,jobs:row.jobs.map(j=>({...j,trashedAt:deleted,canExecute:false,canVerify:false}))}:row;}
    if(method==='trashTask'||method==='restoreTask'){
      idle();const id=validId(args.id);return withEngineLock(root,async()=>{
        let row;try{await fs.access(path.join(root,'batches',id,'batch.json'));row=await batches.read(id);}catch(error){if(error.code!=='ENOENT')throw error;row=await readJob(id,{root});}
        if(['running','preparing'].includes(row.phase)&&processAlive(row.ownerPid)||row.state==='running')throw Error('任务仍在执行或处理中，暂不能移入回收站');
        if(row.input?.batchId)throw Error('批次子任务请从所属批次整体移入或恢复，不能单独删除');
        const result=await setTaskTrashed(root,id,method==='trashTask');emit({type:'snapshot',data:await dashboard()});return result;
      });
    }
    if(method==='accountRemovalPreview'){idle();const selection=await removalSelection(args);return engine.accountRemoval(selection.phone,selection.platform,{preview:true});}
    if(method==='removeAccount'){
      idle();if(!/^sha256:[a-f0-9]{64}$/.test(args.expectedDigest||''))throw Error('缺少移除确认，请重新操作');
      const selection=await removalSelection(args);
      return start('removeAccount',{label:'正在移除账号并退出此应用登录',...selection},()=>withEngineLock(root,()=>withLocalLock(root,async()=>{
        await removalSelection(selection);throwIfCancelled();
        const preview=await engine.accountRemoval(selection.phone,selection.platform,{preview:true});
        if(preview.digest!==args.expectedDigest)throw Error('账号记录已变化，请重新确认');
        await advanceAccountGeneration(root,selection);await invalidatePreparedAccounts(selection);throwIfCancelled();
        await engine.accountRemoval(selection.phone,selection.platform,{expectedDigest:preview.digest});
        cache.accounts=cache.accounts.filter(a=>!(accountPlatform(a)===selection.platform&&a.phone===selection.phone));await persistCache();
        return {message:'账号已移除并退出此应用登录，草稿存储和历史记录已保留'};
      })));
    }
    if(method==='peopleSave'){if(activity?.kind!=='refresh'||activity.status!=='running')idle();await loadCache();const result=await people.save(args.person,{accounts:cache.accounts});emit({type:'peopleUpdated',people:await people.list()});return result;}
    if(method==='prepareBatch'){
      idle();activity={id:randomUUID(),kind:'prepareBatch',status:'running',startedAt:Date.now(),label:'正在准备多平台草稿'};emit({type:'activity',activity});
      pending=Promise.resolve().then(()=>batches.prepare(args.input));const work=pending;
      try{const batch=await work;activity={...activity,status:'completed',finishedAt:Date.now(),message:'多平台草稿任务已准备好'};return await batches.view(batch.id);}
      catch(error){activity={...activity,status:'failed',finishedAt:Date.now(),message:error.message};throw error;}
      finally{pending=null;emit({type:'activity',activity});emit({type:'snapshot',data:await dashboard()});}
    }
    if(method==='executeBatch'){
      idle();const batch=await batches.view(validId(args.id));
      await assertTaskActive(root,{id:batch.id,input:{}});
      if(!batch.canExecute||batch.digest!==args.expectedDigest||batch.attempt!==args.expectedAttempt||contentDigest(batch.targetIds)!==contentDigest(args.targetIds))throw Error('批次或确认信息发生变化，请重新确认');
      if(batch.needsVerification)throw Error('请先回查待核实平台');
      return start('executeBatch',{batchId:batch.id,label:`正在为${batch.person.name}顺序保存多平台草稿`},()=>batches.execute(batch.id,args));
    }
    if(method==='prepare'){
      idle();const input=validateInput(args.input);const work=Promise.resolve().then(()=>prepare(input,{root}));pending=work;
      try{return jobView(await work);}finally{if(pending===work)pending=null;}
    }
    if(method==='refresh')return start('refresh',{label:'正在检查账号与运行环境'},async()=>{
      const health=await doctor();const accounts=await engine.accounts();cache={accounts,health,checkedAt:Date.now()};await persistCache();return cache;
    });
    if(method==='execute'){
      idle();const job=await getJob(args.id);
      await assertTaskActive(root,job);
      if(job.input.batchId)throw Error('批次子任务请从所属批次执行');
      if(job.state!=='prepared')throw Error('这个任务已执行，请查看结果或回查，不要重复提交');
      if(args.expectedDigest!==job.inputDigest)throw Error('任务内容发生变化，请重新准备并确认');
      return start('execute',{jobId:job.id,label:job.input.mode==='draft'?'正在保存并核验草稿':'正在提交并核对发布结果'},()=>run(job.id,{root,engine}));
    }
    if(method==='verify'){
      idle();const job=await getJob(args.id);if(!job.startedAt)throw Error('任务尚未执行，请先开始任务');
      return start('verify',{jobId:job.id,label:job.input.mode==='draft'?'正在恢复并核验草稿':'正在查询平台作品'},()=>verify(job.id,{root,engine}));
    }
    if(method==='login'){
      idle();const platform=platformId(args),p=getPlatform(platform),phone=String(args.phone||'').trim();if(!p.enabled&&!p.loginEnabled)throw Error('该平台暂未接入');if(!phone||phone.length>80||/[\0\r\n\/\\]/.test(phone))throw Error('账号名称无效');
      await accountStore.checkName(phone,platform);throwIfCancelled();
      const qrPath=path.join(root,'login',randomUUID()+'.png');await fs.mkdir(path.dirname(qrPath),{recursive:true,mode:0o700});
      return start('login',{label:platform==='xhs'?'请在小红书窗口完成本人验证':`请用${p.app}扫描二维码`,platform,phone,qrPath},async()=>{
        let stamp=0;const timer=setInterval(async()=>{try{const st=await fs.stat(qrPath);if(st.mtimeMs!==stamp){stamp=st.mtimeMs;emit({type:'activity',activity:{...activity,qrPath,qrUpdatedAt:stamp}});}}catch{}},500);
        try{
          await engine.login(phone,{qrPath,platform});throwIfCancelled();clearInterval(timer);
          activity={...activity,loginStage:'confirming',label:`正在确认${p.name}账号连接`,qrPath:null};emit({type:'activity',activity});
          await accountStore.register(phone,platform);
          const isTarget=account=>account.phone===phone&&(accountPlatform(account)===platform||platform==='dy'&&!account.pt&&!account.platform);
          const result=(await engine.accounts(phone,platform)).filter(isTarget);throwIfCancelled();
          const target=result.find(account=>account.loggedIn===true)||result[0]||{phone,pt:p.engineName||p.name,loggedIn:null,reason:'本次登录状态未确认'};
          cache.accounts=[...cache.accounts.filter(account=>!isTarget(account)),target];cache.checkedAt=Date.now();await persistCache();
          if(target.loggedIn!==true)throw Error('登录状态尚未确认，请刷新连接或重新扫码');
        }
        finally{clearInterval(timer);await fs.rm(qrPath,{force:true});}
      });
    }
    throw Error('不支持这项操作');
  }
  return {handle:(method,args)=>withCancellation(signal,()=>handle(method,args)),waitForIdle:async()=>{await pending;},get activity(){return activity;}};
}
