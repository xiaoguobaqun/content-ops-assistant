import {spawn,spawnSync} from 'node:child_process';
import {executionContext} from './execution-context.mjs';
import {currentSignal,throwIfCancelled} from './cancellation.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function activeGroup(pgid){
  try{process.kill(-pgid,0);}catch(e){if(e.code==='ESRCH')return false;if(e.code!=='EPERM')throw e;}
  const result=spawnSync('ps',['-axo','pgid=,stat='],{encoding:'utf8'});
  if(result.status!==0)throw Error('无法核实子进程树是否已停止');
  return result.stdout.split('\n').some(line=>{const [group,state]=line.trim().split(/\s+/);return Number(group)===pgid&&!state?.startsWith('Z');});
}
async function stopGroup(pgid,graceMs){
  const kill=signal=>{try{process.kill(-pgid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};
  kill('SIGTERM');let until=Date.now()+graceMs;
  while(activeGroup(pgid)&&Date.now()<until)await delay(25);
  if(activeGroup(pgid))kill('SIGKILL');
  until=Date.now()+2000;
  while(activeGroup(pgid)&&Date.now()<until)await delay(25);
  if(activeGroup(pgid))throw Error('子进程树未停止，账号仍被占用，请先检查进程');
}

// argv 不经过 shell；即使直接子进程先退出，也要停止同组后代才返回。
export function runProcess(command,args,{cwd,env=process.env,timeoutMs=90000,killGraceMs=3000,onSpawn}={}){
  if(process.platform==='win32')return (async()=>{
    throwIfCancelled();const {runWindowsProcess}=await import('./windows-host.mjs');
    const ownership=executionContext.getStore();const options={cwd,env,timeoutMs,killGraceMs,onSpawn,signal:currentSignal(),ownership};
    return ownership?.windowsSession?ownership.windowsSession.run(command,args,options):runWindowsProcess(command,args,options);
  })();
  return new Promise((resolve,reject)=>{
    try{throwIfCancelled();}catch(error){reject(error);return;}
    const signal=currentSignal();
    const ownership=executionContext.getStore();
    try{ownership?.launching(command);}catch(error){reject(error);return;}
    const child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',finishing=false,closed=false,exitCode,exitSignal;
    let closeResolve;const closePromise=new Promise(resolve=>closeResolve=resolve);
    const append=(old,chunk)=>(old+chunk.toString()).slice(-2*1024*1024);
    child.stdout.on('data',chunk=>{stdout=append(stdout,chunk);});child.stderr.on('data',chunk=>{stderr=append(stderr,chunk);});
    const cleanup=()=>{clearTimeout(timer);process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);signal?.removeEventListener('abort',onAbort);};
    const finish=async(error)=>{
      if(finishing)return;finishing=true;clearTimeout(timer);
      try{
        if(child.pid&&activeGroup(child.pid))await stopGroup(child.pid,killGraceMs);
        if(!closed)await closePromise;
        ownership?.stopped();cleanup();
        if(error)reject(error);else resolve({code:exitCode,signal:exitSignal,stdout,stderr});
      }catch(stopError){cleanup();reject(stopError);}
    };
    const onTerm=()=>finish(Error('执行中断，子进程树已停止，请先回查'));
    const onInt=()=>finish(Error('执行中断，子进程树已停止，请先回查'));
    const onAbort=()=>finish(signal.reason||Error('操作已停止，请先回查'));
    process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
    signal?.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>finish(Error('执行超时，子进程树已停止；请先回查，勿重复提交')),timeoutMs);
    child.once('spawn',()=>{try{ownership?.spawned(child.pid);onSpawn?.(child.pid);}catch(error){finish(error);}});
    child.once('error',error=>{closed=true;closeResolve();finish(error);});
    child.once('close',(code,signal)=>{closed=true;exitCode=code;exitSignal=signal;closeResolve();finish();});
  });
}
