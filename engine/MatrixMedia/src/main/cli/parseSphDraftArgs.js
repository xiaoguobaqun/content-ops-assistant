export function parseSphDraftArgs(args=[]){
  if(args.includes('--help'))return {ok:true,value:{help:true}};
  const value={inspect:false,inspectCreate:false,inspectWorks:false};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--inspect'){value.inspect=true;continue;}
    if(args[i]==='--inspect-create'){value.inspect=true;value.inspectCreate=true;continue;}
    if(args[i]==='--inspect-works'){value.inspect=true;value.inspectWorks=true;continue;}
    const key={'--phone':'phone','--expected-file':'expectedFile','--screenshot':'screenshot'}[args[i]];
    if(!key||!args[i+1]||args[i+1].startsWith('--'))return {ok:false,error:'视频号草稿核验参数无效'};value[key]=args[++i];
  }
  return value.phone&&(value.inspect||value.expectedFile)?{ok:true,value}:{ok:false,error:'需要 --phone 和 --expected-file，或 --inspect'};
}
