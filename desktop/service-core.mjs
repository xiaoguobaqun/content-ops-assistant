import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {engine as realEngine,doctor as realDoctor} from '../src/engine.mjs';
import {defaultRoot,prepareJob,runJob,verifyJob,readJob} from '../src/jobs.mjs';
import {jobView,validateInput,validId} from './model.mjs';
import {withCancellation,throwIfCancelled} from '../src/cancellation.mjs';
import {createAccountStore} from '../src/accounts.mjs';
import {platforms,getPlatform,platformId,accountPlatform} from '../src/platforms.mjs';

export function createDesktopService({root=defaultRoot,documentsDir,signal,engine=realEngine,doctor=realDoctor,prepare=prepareJob,run=runJob,verify=verifyJob,onEvent=()=>{}}={}){
  let activity=null,pending=null;let cache={accounts:[],health:null,checkedAt:null};
  const accountStore=createAccountStore({root,documentsDir});
  const view=job=>jobView(job,{active:activity?.status==='running'&&activity.jobId===job.id});
  const cacheFile=path.join(root,'desktop-state.json');
  const emit=event=>{try{onEvent(event);}catch{}};
  async function loadCache(){try{cache={...cache,...JSON.parse(await fs.readFile(cacheFile,'utf8'))};}catch{}}
  async function persistCache(){await fs.mkdir(root,{recursive:true,mode:0o700});const temporary=cacheFile+'.tmp';await fs.writeFile(temporary,JSON.stringify(cache),{mode:0o600});await fs.rename(temporary,cacheFile);}
  async function getJob(id){const job=await readJob(validId(id),{root});if(job.id!==id||!job.input||!job.files)throw Error('任务记录无效，请检查原始任务文件');return job;}
  async function dashboard(){
    await loadCache();let names=[];try{names=await fs.readdir(path.join(root,'jobs'));}catch{}
    const jobs=[],warnings=[];
    for(const id of names){try{jobs.push(view(await getJob(id)));}catch{warnings.push('有一份旧任务无法读取，其余记录可继续使用。');}}
    jobs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return {jobs,accounts:cache.accounts,platforms,health:cache.health,checkedAt:cache.checkedAt,activity,warnings:[...new Set(warnings)],protocolVersion:1};
  }
  function idle(){if(pending)throw Error('已有操作正在执行，请等待完成');}
  function start(kind,details,work){
    idle();activity={id:randomUUID(),kind,status:'running',startedAt:Date.now(),...details};emit({type:'activity',activity});
    pending=Promise.resolve().then(work).then(async result=>{
      const job=result?.id&&result?.input?view(result):null;
      activity={...activity,status:job?.state==='unknown'?'attention':'completed',finishedAt:Date.now(),message:job?.message||'操作已完成'};
      emit({type:'activity',activity,...(job?{job}:{})});
      emit({type:'snapshot',data:await dashboard()});
    }).catch(async error=>{activity={...activity,status:'failed',finishedAt:Date.now(),message:error.message||'操作未完成，请回查任务'};emit({type:'activity',activity});emit({type:'snapshot',data:await dashboard()});})
      .finally(()=>{pending=null;});
    return {activity};
  }
  async function handle(method,args={}){
    throwIfCancelled();
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('操作参数无效');
    if(method==='dashboard')return dashboard();
    if(method==='getJob')return view(await getJob(args.id));
    if(method==='prepare'){
      idle();const input=validateInput(args.input);const job=await prepare(input,{root});return jobView(job);
    }
    if(method==='refresh')return start('refresh',{label:'正在检查账号与运行环境'},async()=>{
      const health=await doctor();const accounts=await engine.accounts();cache={accounts,health,checkedAt:Date.now()};await persistCache();return cache;
    });
    if(method==='execute'){
      idle();const job=await getJob(args.id);
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
        try{await engine.login(phone,{qrPath,platform});throwIfCancelled();await accountStore.register(phone,platform);cache.accounts=await engine.accounts();cache.checkedAt=Date.now();await persistCache();if(!cache.accounts.some(account=>account.phone===phone&&(accountPlatform(account)===platform||platform==='dy'&&!account.pt&&!account.platform)&&account.loggedIn===true))throw Error('登录状态尚未确认，请刷新连接或重新扫码');}
        finally{clearInterval(timer);await fs.rm(qrPath,{force:true});}
      });
    }
    throw Error('不支持这项操作');
  }
  return {handle:(method,args)=>withCancellation(signal,()=>handle(method,args)),waitForIdle:async()=>{await pending;},get activity(){return activity;}};
}
