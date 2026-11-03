export function parseAccountRemoveArgs(args=[]){
  if(args.length===1&&['--help','-h'].includes(args[0]))return {ok:true,value:{help:true}};
  const value={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--preview'&&!value.preview){value.preview=true;continue;}
    const key={'--platform':'platform','--phone':'phone','--expected-digest':'expectedDigest'}[args[i]];
    if(!key||Object.hasOwn(value,key)||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))return {ok:false,error:'移除账号参数无效'};
    value[key]=args[++i];
  }
  if(!['dy','sph','xhs'].includes(value.platform)||typeof value.phone!=='string'||!value.phone.trim()||value.phone!==value.phone.trim()||value.phone.length>80||/[\x00-\x1f\x7f/\\]/.test(value.phone)||!value.phone.split('-')[0].trim())return {ok:false,error:'需要有效的平台和账号名称'};
  if(value.preview?value.expectedDigest!==undefined:!/^sha256:[a-f0-9]{64}$/.test(value.expectedDigest||''))return {ok:false,error:'先预览，再使用原摘要确认移除'};
  return {ok:true,value};
}
export function accountRemoveHelpText(){return '用法: cli account-remove --platform dy|sph|xhs --phone <账号> --preview\n确认后: cli account-remove --platform dy|sph|xhs --phone <账号> --expected-digest <预览摘要>\n退出此应用的登录并移除本机登记，保留草稿存储；调用方须持有执行锁。';}
