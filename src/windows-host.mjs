import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const defaultHost=fileURLToPath(new URL('../runtime/windows-host.exe',import.meta.url));
const outputLimit=2*1024*1024;
const protocolLimit=256*1024;
const unknown=()=>Error('Windows 保护程序异常退出，执行结果未知；请先回查，勿重复提交');
const interrupted=()=>Error('操作已停止，子进程树已停止；请先回查');
const timeout=()=>Error('执行超时，子进程树已停止；请先回查，勿重复提交');
const cancellation=signal=>signal?.reason instanceof Error&&signal.reason.name!=='AbortError'?signal.reason:interrupted();

function milliseconds(value,fallback){
  const result=value??fallback;
  if(!Number.isSafeInteger(result)||result<0||result>2147483647)throw Error('Windows 保护程序等待时间无效');
  return result;
}
function validate(command,args,env){
  if(typeof command!=='string'||!command||command.includes('\0')||!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw Error('Windows 执行参数无效');
  if(!env||typeof env!=='object'||Object.entries(env).some(([key,value])=>!key||key.includes('\0')||key.includes('=')||(value!==undefined&&String(value).includes('\0'))))throw Error('Windows 执行环境无效');
}

class WindowsSession {
  constructor(file,waitMs){
    this.active=null;this.nextId=0;this.failure=null;this.closing=false;this.exited=false;
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.exit=new Promise(resolve=>this.exitResolve=resolve);
    this.child=spawn(process.env.CONTENT_OPS_WINDOWS_HOST||defaultHost,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let pending='';
    // Native diagnostics never include argv/environment, and are never copied into user errors.
    let diagnostic='';this.child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4096);});
    this.child.stdin.on('error',()=>this.fail(unknown()));
    this.child.stdout.on('data',chunk=>{
      if(this.failure)return;
      pending+=chunk.toString('utf8');
      for(;;){
        const end=pending.indexOf('\n');
        if(end<0)break;
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        if(line.length>protocolLimit){this.fail(unknown());this.child.kill();return;}
        try{this.message(JSON.parse(line));}catch{this.fail(unknown());this.child.kill();return;}
      }
      if(pending.length>protocolLimit){this.fail(unknown());this.child.kill();}
    });
    this.child.once('error',()=>this.fail(Error('Windows 保护程序不可用，请重新安装应用')));
    this.child.once('close',code=>{
      this.exited=true;clearTimeout(this.startTimer);
      if(!this.closing||code!==0||this.active)this.fail(unknown());
      this.exitResolve();
    });
    this.startTimer=setTimeout(()=>{this.fail(unknown());this.child.kill();},Math.min(waitMs+10000,2147483647));
    this.send({op:'open',file,waitMs});
  }
  send(message){
    if(this.exited||this.child.stdin.destroyed){this.fail(unknown());return;}
    this.child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)this.fail(unknown());});
  }
  fail(error){
    if(this.failure)return;
    this.failure=error;clearTimeout(this.startTimer);this.readyReject(error);
    if(this.active){const active=this.active;this.active=null;active.cleanup();active.reject(error);}
    // EOF asks a healthy guardian to stop its Job before releasing its file handle.
    if(!this.child.stdin.destroyed)this.child.stdin.end();
  }
  message(message){
    if(message.type==='ready'){clearTimeout(this.startTimer);this.readyResolve();return;}
    if(message.type==='error'){
      const error=message.reason==='busy'?Error('已有任务正在执行，账号锁尚未释放'):Error('Windows 文件锁不可用，执行结果未知；请先回查');
      this.fail(error);return;
    }
    const active=this.active;
    if(!active||message.id!==active.id)throw unknown();
    if(message.type==='stdout'||message.type==='stderr'){
      if(typeof message.data!=='string'||message.data.length>protocolLimit)throw unknown();
      active[message.type]=Buffer.concat([active[message.type],Buffer.from(message.data,'base64')]).subarray(-outputLimit);return;
    }
    if(message.type==='spawned'){
      if(!Number.isInteger(message.pid)||message.pid<1)throw unknown();
      try{active.ownership?.spawned(message.pid);active.onSpawn?.(message.pid);}catch(error){active.error=error;this.send({op:'stop',id:active.id});}
      return;
    }
    if(message.type!=='result'||message.treeStopped!==true)throw unknown();
    this.active=null;active.cleanup();
    try{active.ownership?.stopped();}catch(error){active.error??=error;}
    let error=active.error;
    if(message.reason==='timeout')error??=timeout();
    else if(message.reason==='cancelled')error??=interrupted();
    else if(message.reason||!Number.isInteger(message.code))error??=Error('Windows 子进程启动失败，执行结果未知；请先回查');
    if(error)active.reject(error);
    else active.resolve({code:message.code,signal:null,stdout:active.stdout.toString('utf8'),stderr:active.stderr.toString('utf8')});
  }
  async run(command,args,{cwd,env=process.env,timeoutMs=90000,killGraceMs=3000,onSpawn,signal,ownership}={}){
    await this.ready;
    if(this.failure)throw this.failure;
    if(this.closing||this.active)throw Error('Windows 执行会话已关闭或正在执行任务');
    validate(command,args,env);
    if(cwd!==undefined&&(typeof cwd!=='string'||cwd.includes('\0')))throw Error('Windows 工作目录无效');
    timeoutMs=milliseconds(timeoutMs,90000);killGraceMs=milliseconds(killGraceMs,3000);
    if(signal?.aborted)throw cancellation(signal);
    ownership?.launching(command);
    const id=++this.nextId;
    const execution=new Promise((resolve,reject)=>{
      const abort=error=>{if(this.active?.id!==id)return;this.active.error??=error;this.send({op:'stop',id});};
      const onAbort=()=>abort(cancellation(signal));
      const onTerm=()=>abort(interrupted());const onInt=()=>abort(interrupted());
      const cleanup=()=>{process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);signal?.removeEventListener('abort',onAbort);};
      this.active={id,resolve,reject,cleanup,ownership,onSpawn,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),error:null};
      process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);signal?.addEventListener('abort',onAbort,{once:true});
      this.send({op:'run',id,command,args,cwd:cwd??null,env:Object.fromEntries(Object.entries(env).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),timeoutMs,killGraceMs});
      if(signal?.aborted)onAbort();
    });
    this.running=execution;
    // Session teardown can safely await a run the callback forgot to await.
    execution.catch(()=>{});
    return execution;
  }
  async close(){
    this.closing=true;
    if(this.active){this.active.error??=interrupted();this.send({op:'stop',id:this.active.id});await this.running.catch(()=>{});}
    if(!this.exited&&!this.failure){this.send({op:'close'});this.child.stdin.end();}
    await this.exit;
    if(this.failure)throw this.failure;
  }
}

// The native guardian owns both this handle and every Job spawned in the session.
// On Node death it sees EOF, empties the Job, and only then releases the guard.
export async function withWindowsLock(file,work,{waitMs=0}={}){
  waitMs=waitMs===Infinity?2147483647:milliseconds(waitMs,0);
  if(file!==null){if(typeof file!=='string'||!file||file.includes('\0'))throw Error('Windows 文件锁路径无效');file=path.resolve(file);await fs.mkdir(path.dirname(file),{recursive:true});}
  const session=new WindowsSession(file,waitMs);
  let result;let error;
  try{await session.ready;result=await work(session);}catch(cause){error=cause;}
  try{await session.close();}catch(cause){if(error)cause.cause=error;throw cause;}
  if(error)throw error;
  return result;
}

export function runWindowsProcess(command,args,options={}){
  return withWindowsLock(null,session=>session.run(command,args,options));
}
