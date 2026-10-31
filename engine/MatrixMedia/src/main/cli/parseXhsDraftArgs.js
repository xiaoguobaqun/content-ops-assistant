import path from 'path';
export function parseXhsDraftArgs(args=[]){
  if(args.includes('--help'))return {ok:true,value:{help:true}};
  const value={inspect:false,inspectCreate:false};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--inspect-drafts'){value.inspect=true;value.inspectCreate=true;value.inspectDrafts=true;continue;}
    if(args[i]==='--inspect-create'){value.inspect=true;value.inspectCreate=true;continue;}
    if(args[i]==='--inspect'){value.inspect=true;continue;}
    const key={'--phone':'phone','--expected-file':'expectedFile','--screenshot':'screenshot'}[args[i]];
    if(!key||!args[i+1]||args[i+1].startsWith('--'))return {ok:false,error:'小红书草稿核验参数无效'};
    value[key]=args[++i];
  }
  if([value.expectedFile,value.screenshot].some(p=>p&&!path.isAbsolute(p)))return {ok:false,error:'核验证据文件必须使用绝对路径'};
  return value.phone&&(value.inspect||value.expectedFile)?{ok:true,value}:{ok:false,error:'需要 --phone 和 --inspect 或 --expected-file'};
}
