export function parseDouyinDraftArgs(args=[]) {
  if(args.includes('--help')) return {ok:true,value:{help:true}};
  const value={};
  for(let i=0;i<args.length;i++){
    const key={'--phone':'phone','--expected-file':'expectedFile','--screenshot':'screenshot'}[args[i]];
    if(!key||!args[i+1]||args[i+1].startsWith('--')) return {ok:false,error:'草稿回查参数无效'};
    value[key]=args[++i];
  }
  return value.phone&&value.expectedFile?{ok:true,value}:{ok:false,error:'需要 --phone 和 --expected-file'};
}
