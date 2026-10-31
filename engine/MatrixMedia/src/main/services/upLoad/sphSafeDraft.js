/** 单次草稿流程。每项前置条件都必须成功，保存异常不会重试。 */
export async function executeSafeSphDraft(steps){
  const check=()=>steps.checkCancelled?.();
  check();const baseline=await steps.baseline();
  if(baseline?.empty!==true)throw Error(baseline?.empty===false?'视频号已有草稿，已停止以免覆盖':baseline?.message||'视频号草稿状态未核实，已停止');
  for(const stage of ['upload','text','processing','cover']){check();await steps[stage]();}
  check();const evidence=await steps.inspect();
  if(evidence?.ok!==true||!evidence.mediaId||!evidence.coverSrc)throw Error('草稿内容、视频或封面尚未核实，已停止提交');
  check();await steps.checkpoint({...evidence,baseline});
  check();await steps.save();
  return evidence;
}
