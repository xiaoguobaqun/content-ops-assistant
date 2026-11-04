'use strict';
// 只由可信原生主进程调用；界面传来的provider、样本或密钥一律不转发。
function profileAnalysisArgs(args,settings){
  const selected=settings.list().find(p=>p.id===args.providerId);
  if(!selected?.configured)throw Error('请先完整配置所选 AI 服务');
  const expected=args.expectedProvider;
  if(!expected||['id','protocol','baseURL','model'].some(key=>expected[key]!==selected[key]))throw Error('AI 接口配置发生变化，请重新预览');
  return {personId:args.personId,expectedRevision:args.expectedRevision,bindingsDigest:args.bindingsDigest,expectedSourceDigest:args.expectedSourceDigest,provider:settings.resolve(selected.id)};
}
module.exports={profileAnalysisArgs};
