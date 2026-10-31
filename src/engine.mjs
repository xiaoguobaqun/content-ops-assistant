import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runProcess } from './process.mjs';
import {withEngineLock} from './lock.mjs';
import {executionContext} from './execution-context.mjs';
import {buildAccountPartition} from '../engine/MatrixMedia/src/shared/accountPartition.js';
import {platformId,getPlatform,validatePlatformInput,assertPlatformExecution,platformContent} from './platforms.mjs';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const engineRoot=path.join(projectRoot,'engine/MatrixMedia');
const localRoot=path.join(projectRoot,'.local');
export function publishArgs(job){
  const {input,files}=job;
  validatePlatformInput(input);const platform=platformId(input),text=platformContent(input);
  const args=['publish','--platform',platform,'--phone',input.phone,'--file',files.video.path,'--cover',files.cover.path,'--title',text.title,'--description',text.description,'--name',`content-ops:${job.id}`,'--task-id',job.id];
  if(platform==='dy')args.push('--visibility',input.visibility,'--creative-statement',input.creativeStatement);
  else {if(text.shortTitle)args.push('--short-title',text.shortTitle);args.push('--checkpoint-file',path.join(localRoot,'jobs',job.id,`${platform}-checkpoint.json`));}
  args.push(input.mode==='draft'?'--draft':'--publish');return args;
}
export function loginArgs(phone,qrPath,platform='dy'){const p=getPlatform(platform);if(!p.enabled&&!p.loginEnabled)throw Error('该平台暂未接入');const args=['login','--platform',p.id,'--phone',phone,'--save-qr-png',qrPath,'--timeout-sec','300'];if(['sph','xhs'].includes(platform))args.push('--show');return args;}
export function parseEngineReply(stdout,channel){
  for(const line of stdout.trim().split(/\r?\n/).reverse()){
    try{const data=JSON.parse(line);if(data.channel===channel) return data;}catch{}
  }
  throw Error('引擎没有返回有效回执，结果待核实');
}
function executable(){
  const paths={darwin:'dist/Electron.app/Contents/MacOS/Electron',linux:'dist/electron',win32:'dist/electron.exe'};
  if(!paths[process.platform]) throw Error('当前系统暂不支持');
  return path.join(engineRoot,'node_modules/electron',paths[process.platform]);
}
async function latestSource(dir){
  let latest=0;
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    latest=Math.max(latest,item.isDirectory()?await latestSource(file): (await fs.stat(file)).mtimeMs);
  }
  return latest;
}
export async function assertBuilt(){
  let built;try{built=await fs.stat(path.join(engineRoot,'dist/electron/main.js'));await fs.access(executable());}catch{throw Error('请先安装并构建发布引擎：node scripts/build-engine.mjs');}
  const sourceTime=Math.max(await latestSource(path.join(engineRoot,'src/main')),await latestSource(path.join(engineRoot,'src/shared')),(await fs.stat(path.join(engineRoot,'.electron-vue/webpack.main.config.js'))).mtimeMs);
  if(built.mtimeMs<sourceTime) throw Error('引擎源码已更新，请重新构建：node scripts/build-engine.mjs');
}
async function callEngine(args,{timeoutMs=90000,recordLogs=true}={}){
  if(!executionContext.getStore())return withEngineLock(localRoot,()=>callEngine(args,{timeoutMs,recordLogs}));
  await assertBuilt();
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await runProcess(executable(),[engineRoot,'cli',...args],{cwd:engineRoot,env,timeoutMs});
  if(recordLogs){await fs.mkdir(path.join(localRoot,'logs'),{recursive:true,mode:0o700});
  await fs.writeFile(path.join(localRoot,'logs',`${Date.now()}-${args[0]}-${randomUUID()}.log`),result.stdout+'\n'+result.stderr,{mode:0o600});}
  return result;
}
export function confirmEngineLogin(result,{platform='dy',phone}={}){
  if(result.code!==0)throw Error('登录未完成，请在平台窗口完成本人验证。');
  if(platform==='xhs'){
    const reply=parseEngineReply(result.stdout,'xhs-login');
    if(reply.ok!==true||reply.platform!=='xhs'||reply.partition!==buildAccountPartition(phone,'小红书'))throw Error('小红书登录账号分区尚未核实');
  }
  return {ok:true};
}
export function draftQuerySpec(job){
  const platform=platformId(job.input),dir=path.join(localRoot,'jobs',job.id),expectedFile=path.join(dir,'draft-expected.json');
  const expected=['sph','xhs'].includes(platform)?{clientTaskId:job.id,...platformContent(job.input),checkpointPath:path.join(dir,`${platform}-checkpoint.json`)}:{title:job.input.title,description:job.input.description,visibility:job.input.visibility,coverSrcs:job.receipt?.draftEvidence?.expectedCoverSrcs||[],requireCover:!!job.files.cover};
  const channel=platform==='dy'?'douyin-draft':`${platform}-draft`;
  return {expectedFile,expected,channel,args:[channel,'--phone',job.input.phone,'--expected-file',expectedFile,'--screenshot',path.join(dir,'verified-draft.png')]};
}
export const engine={
  async login(phone,{qrPath,platform='dy'}){const result=await callEngine(loginArgs(phone,qrPath,platform),{timeoutMs:320000,recordLogs:false});return confirmEngineLogin(result,{platform,phone});},
  async queryDraft(job){
    const spec=draftQuerySpec(job);await fs.writeFile(spec.expectedFile,JSON.stringify(spec.expected),{mode:0o600});
    const result=await callEngine(spec.args,{timeoutMs:120000});return parseEngineReply(result.stdout,spec.channel);
  },
  async publish(job){assertPlatformExecution(job.input);const result=await callEngine(publishArgs(job),{timeoutMs:15*60*1000});return parseEngineReply(result.stdout,'puppeteerFile-done');},
  async query(phone,workId){const args=['douyin-works','--phone',phone,'--json'];if(workId) args.push('--work-id',workId);const result=await callEngine(args,{timeoutMs:100000});return parseEngineReply(result.stdout,'douyin-works');},
  async accounts(phone,platform){
    await fs.mkdir(localRoot,{recursive:true,mode:0o700});const output=path.join(localRoot,`accounts-${randomUUID()}.json`);
    try{const args=['accounts','--json','--out',output];if(platform)args.push('--platform',getPlatform(platform).id);if(phone)args.push('--phone',phone);const result=await callEngine(args);if(result.code!==0)throw Error('账号查询失败');return JSON.parse(await fs.readFile(output,'utf8'));}
    finally{await fs.rm(output,{force:true});}
  },
  async help(){return (await callEngine(['publish','--help'])).stdout;},
};
export async function doctor(){
  const checks=[];
  try{const result=await runProcess('python3',['-c','import fcntl; print("Python 3 / flock available")']);checks.push({name:'account-lock',ok:result.code===0});}catch{checks.push({name:'account-lock',ok:false,message:'需要 macOS/Linux 与 Python 3'});}
  for(const tool of ['ffmpeg','ffprobe']){
    try{const result=await runProcess(tool,['-version']);checks.push({name:tool,ok:result.code===0,version:result.stdout.split('\n')[0]});}catch{checks.push({name:tool,ok:false});}
  }
  try{await assertBuilt();checks.push({name:'engine',ok:true});}catch(e){checks.push({name:'engine',ok:false,message:e.message});}
  return {ok:checks.every(c=>c.ok),checks};
}
