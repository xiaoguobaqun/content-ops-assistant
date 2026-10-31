/** 受管草稿严格按序执行；任何未知或异常都不尝试再次上传/暂存。 */
export async function executeSafeXhsDraft(steps){
  const check=()=>steps.checkCancelled?.();check();const baseline=await steps.baseline();
  if(baseline?.empty!==true)throw Error(baseline?.empty===false?'小红书已有本机草稿，已停止以免覆盖':baseline?.message||'小红书草稿箱尚未核实，已停止');
  for(const stage of ['upload','text','processing','cover']){check();await steps[stage]();}
  check();const evidence=await steps.inspect();
  if(evidence?.ok!==true||!evidence.videoIdentity||!evidence.coverIdentity)throw Error('小红书文案、视频或自选封面尚未核实，停止暂存');
  check();await steps.checkpoint({...evidence,baseline});check();await steps.save();return evidence;
}

/** 自动保存也是创建结果；只允许绑定基线为空后、同一任务时间窗内的唯一同账号素材。 */
export function bindXhsLocalDraft(checkpoint,local,{requireContent=false}={}){
  if(local?.scope!=='browser-local'||local.count!==1||local.records?.length!==1)throw Error('本机草稿不唯一，停止操作');const record=local.records[0],media=record.media,source=checkpoint.sourceMedia;
  const validMedia=value=>value&&['size','width','height','duration'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])&&value[k]>0);
  if(record.ownerMatched!==true||!media?.fileIdHash||!media.videoIdHash||!validMedia(source)||!validMedia(media)||media.size!==source.size||media.width!==source.width||media.height!==source.height||Math.abs(media.duration-source.duration)>0.05)throw Error('本机草稿账号或可信媒体信息与任务不匹配');
  if(checkpoint.targetDraft){const target=checkpoint.targetDraft;if(target.keyHash!==record.keyHash||target.media?.fileIdHash!==media.fileIdHash||target.media?.videoIdHash!==media.videoIdHash)throw Error('本机草稿标识与原任务不匹配');}
  else if(checkpoint.baseline?.empty!==true||!Number.isFinite(record.timeStamp)||record.timeStamp<checkpoint.createdAt||record.timeStamp>(checkpoint.updatedAt||checkpoint.createdAt)+5000)throw Error('自动草稿创建时间或空基线不能证明属于本次任务');
  if(requireContent&&(!record.titlePaths?.includes('content.draftStore.title')||!record.descriptionPaths?.includes('content.draftStore.desc')||record.cover?.isUpload!==true||record.cover?.isUserSelect!==true||!record.cover?.fileIdHash||(checkpoint.targetDraft?.cover?.fileIdHash&&checkpoint.targetDraft.cover.fileIdHash!==record.cover.fileIdHash)))throw Error('本机草稿文案或自选封面未完整匹配');
  return record;
}
