import {buildAccountPartition,canonicalAccountPartition} from './accountPartition.js';
/** 只消费页面自身取得的本人信息响应；不会据此构造平台请求。 */
export function classifyXhsAuthResponse({url,status,payload,expectedUserId,fromCache=false,fromServiceWorker=false}){
  let u;try{u=new URL(url);}catch{return {ok:false};}
  if(u.origin!=='https://creator.xiaohongshu.com'||u.pathname!=='/api/galaxy/user/info')return {ok:false};
  if(fromCache||fromServiceWorker)return {ok:false};
  if(status===401)return {ok:true,loggedIn:false,reason:'小红书登录已失效'};
  if(status<200||status>=300||payload?.code!==0||payload?.success!==true)return {ok:false};
  const userId=payload.data?.userId;
  if(typeof expectedUserId!=='string'||!expectedUserId||typeof userId!=='string'||userId!==expectedUserId)return {ok:false};
  return {ok:true,loggedIn:true};
}
export function isXhsLoginQrPayload(value){
  try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='xiaohongshu.com'||u.hostname.endsWith('.xiaohongshu.com'))&&!u.username&&!u.password&&/login|qr/i.test(u.pathname);}catch{return false;}
}

/** 账号记录冲突时只报告标准分区，绝不探测记录指向的其他账号会话。 */
export function resolveXhsAccountPartition(account){
  const partition=buildAccountPartition(account.phone,'小红书');
  const ok=!account.partition||canonicalAccountPartition(account.partition,'小红书')===partition;
  return {ok,partition,...(ok?{}:{reason:'小红书账号记录的分区不一致，请使用新的本机账号名称重新连接'})};
}
