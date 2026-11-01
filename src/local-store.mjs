import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
export const contentDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function localId(id){if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id||''))throw Error('记录编号无效');return id;}
export async function atomicJson(file,value){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';
 try{const handle=await fs.open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
}
// 独立于引擎锁，避免批次登记后再调用单任务时嵌套持锁。
export async function withLocalLock(root,work,{waitMs=5000}={}){
 await fs.mkdir(root,{recursive:true,mode:0o700});const handle=await fs.open(path.join(root,'metadata.lock'),'a+',0o600);
 try{const until=Date.now()+waitMs;
  while(true){const result=spawnSync('python3',['-c','import fcntl,sys\ntry: fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(73)'],{stdio:['ignore','ignore','pipe',handle.fd]});
   if(result.status===0)break;if(result.status!==73)throw Error('本机记录锁不可用');if(Date.now()>=until)throw Error('本机记录正在修改，请稍后重试');
   // 异步让出事件循环，同进程的持锁操作也能完成；不能同步阻塞等待 flock。
   await new Promise(resolve=>setTimeout(resolve,25));
  }return await work();
 }finally{await handle.close();}
}
export function processAlive(pid){if(!Number.isInteger(pid)||pid<2)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
