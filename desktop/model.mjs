import path from 'node:path';
import {getPlatform,platformId,validatePlatformInput} from '../src/platforms.mjs';
export const states={prepared:['待执行','neutral'],running:['处理中','blue'],draft_confirmed:['已存草稿','green'],confirmed:['已发布','green'],unknown:['待核实','amber'],invalidated:['已作废','neutral']};
export function jobView(job,{active=false}={}){
  if(job.state==='running'&&!active)job={...job,state:'unknown',message:'上次操作已中断或不在当前后台中，请先回查结果，避免重复提交。'};
  const input=job.input||{},files=job.files||{};const [statusLabel,tone]=states[job.state]||['待核实','amber'];
  const platform=platformId(input),p=getPlatform(platform);
  const receiptMessage=/Waiting failed:|Runtime.callFunctionOn timed out|Navigation timeout/.test(job.receipt?.message||'')?'等待平台页面响应超时，操作已停止，请先回查。':job.receipt?.message;
  const detailMessage=job.state==='unknown'?[...new Set([receiptMessage,job.verification?.message].filter(Boolean))].join('；'):job.verification?.message||receiptMessage||'';
  return {id:job.id,platform,platformName:p.name,shortTitle:input.shortTitle||'',state:states[job.state]?job.state:'unknown',statusLabel:platform==='xhs'&&job.state==='draft_confirmed'?'已存本机草稿':statusLabel,tone,inputDigest:job.inputDigest,
    title:input.title||'未命名任务',description:input.description||'',phone:input.phone||'',mode:input.mode,visibility:input.visibility,creativeStatement:input.creativeStatement||'none',
    videoPath:files.video?.path||'',videoName:path.basename(files.video?.path||''),coverPath:files.cover?.path||'',videoSize:files.video?.size||0,
    createdAt:job.createdAt,startedAt:job.startedAt,finishedAt:job.finishedAt,checkedAt:job.checkedAt,
    message:job.message||detailMessage||(p.executionEnabled===false?'小红书草稿尚未完成实机验收，暂不可执行':''),platformWorkId:job.platformWorkId||null,platformUrl:job.platformUrl||null,
    batchId:input.batchId||null,trashedAt:job.trashedAt||null,verificationReports:job.verificationReports||[],screenshotPath:job.verification?.screenshot||null,moderation:job.moderation||'unknown',canExecute:!job.trashedAt&&!input.batchId&&job.state==='prepared'&&p.executionEnabled!==false,canVerify:!job.trashedAt&&!!job.startedAt};
}
export function validateInput(raw){
  if(!raw||typeof raw!=='object')throw Error('请先填写任务内容');
  const input={};for(const key of ['platform','phone','video','title','description','shortTitle','cover','mode','visibility','creativeStatement'])if(raw[key]!==undefined)input[key]=raw[key];
  for(const key of ['phone','video','title'])if(typeof input[key]!=='string'||!input[key].trim())throw Error({phone:'请选择抖音账号',video:'请选择视频',title:'请填写标题'}[key]);
  if(/[\0\r\n\/\\]/.test(input.phone)||input.phone.length>80)throw Error('账号名称包含不支持的字符');
  if([...input.title.trim()].length>30)throw Error('标题最多 30 个字');
  if(typeof input.description!=='string'&&input.description!==undefined)throw Error('简介格式无效');
  if((input.description||'').length>1000)throw Error('简介最多 1000 个字');
  if(!['draft','publish'].includes(input.mode))throw Error('请选择存草稿或实际发布');
  validatePlatformInput(input);
  if(!/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(input.video))throw Error('请选择常见的视频文件');
  return input;
}
export function validId(id){if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id||''))throw Error('任务编号无效');return id;}
