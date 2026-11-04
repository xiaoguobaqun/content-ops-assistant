import fs from 'node:fs/promises';
import {constants,writeSync,fsyncSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {executionContext} from './execution-context.mjs';

const flock=`import fcntl,sys
try: fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit(73)
`;
function liveGroup(pgid){
  if(!Number.isInteger(pgid)||pgid<2)return false;
  try{process.kill(-pgid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}
}
function hasCommand(command){
  const result=spawnSync('ps',['-axo','command='],{encoding:'utf8'});
  if(result.status!==0)throw Error('无法核实上次引擎进程，保留锁状态');
  return result.stdout.split('\n').some(line=>line.trim().startsWith(command+' '));
}
// flock 锁由继承的同一文件描述持有，Python 返回后仍由 Node 持有；进程退出由内核释放。
export async function withEngineLock(root,fn){
  if(process.platform==='win32'){
    const {withWindowsLock}=await import('./windows-host.mjs');
    return withWindowsLock(path.join(root,'engine.lock.guard'),session=>locked(root,fn,session));
  }
  return locked(root,fn);
}
async function locked(root,fn,windowsSession){
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const handle=await fs.open(path.join(root,'engine.lock'),constants.O_RDWR|constants.O_CREAT,0o600);
  try{
    if(!windowsSession){
      const result=spawnSync('python3',['-c',flock],{stdio:['ignore','ignore','pipe',handle.fd]});
      if(result.status===73)throw Error('已有任务正在执行，账号锁尚未释放');
      if(result.status!==0)throw Error('账号锁不可用，需要 Python 3 和系统文件锁支持');
    }
    const raw=await fs.readFile(path.join(root,'engine.lock'),'utf8');
    let previous;try{previous=raw.trim()?JSON.parse(raw):null;}catch{throw Error('上次锁记录不完整，请先检查引擎进程');}
    // Windows 守护者持有同一个 guard 和 Job；拿到 guard 前必已清空上次全部后代。
    if(!windowsSession){
      if(previous?.phase==='running'&&liveGroup(previous.pgid))throw Error('上次引擎进程仍在运行，请先等待或停止，不能启动新任务');
      if(previous?.phase==='launching'&&previous.command&&hasCommand(previous.command))throw Error('上次引擎可能仍在启动，请先检查进程');
    }else if(previous&&previous.platform!=='win32'&&previous.phase!=='idle')throw Error('发现非 Windows 引擎锁记录，请先核对旧进程');
    let owner={pid:process.pid,platform:process.platform,phase:'idle',updatedAt:Date.now()};
    const record=patch=>{
      owner={...owner,...patch,updatedAt:Date.now()};
      const bytes=Buffer.from(JSON.stringify(owner));
      const block=Buffer.alloc(4096,32);if(bytes.length>block.length)throw Error('锁记录过长');bytes.copy(block);
      writeSync(handle.fd,block,0,block.length,0);fsyncSync(handle.fd);
    };
    record({});
    return await executionContext.run({
      ...(windowsSession?{windowsSession}:{}),
      launching:command=>record({phase:'launching',command,pgid:null}),
      spawned:pgid=>record({phase:'running',pgid}),
      stopped:()=>record({phase:'idle',pgid:null,command:null}),
    },fn);
  }finally{await handle.close();}
}
