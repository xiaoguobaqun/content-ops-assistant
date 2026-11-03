import path from 'path';
export function parseXhsCompletionArgs(args=[]){
 if(args.includes('--help'))return {ok:true,value:{help:true}};
 const value={};for(let i=0;i<args.length;i++){
  const key={'--phone':'phone','--expected-file':'expectedFile','--screenshot':'screenshot'}[args[i]];
  if(!key||value[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))return {ok:false,error:'小红书补全参数无效；不接受视频上传或发布参数'};value[key]=args[++i];
 }
 if(!value.phone?.trim()||value.phone!==value.phone.trim()||value.phone.length>80||/[\x00-\x1f\x7f\/\\]/.test(value.phone)||!value.expectedFile||!path.isAbsolute(value.expectedFile)||value.screenshot&&!path.isAbsolute(value.screenshot))return {ok:false,error:'需要有效账号与绝对路径的补全授权文件'};return {ok:true,value};
}
