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
  if(requireContent){
    let cover=record.cover,materialHash=record.materialHash;
    const pinned=checkpoint.targetDraft,legacyPinned=pinned?.cover?.kind!=='cover-editor'&&pinned?.materialHash&&pinned.materialHash===record.materialHash&&pinned.cover?.fileIdHash===record.cover?.fileIdHash&&record.cover?.isUpload===true&&record.cover?.isUserSelect===true;
    if(!legacyPinned&&(record.editorCover?.isUpload===true||record.editorArchive)){
      const hash=v=>/^sha256:[a-f\d]{64}$/.test(v||''),fileHash=v=>/^[a-f\d]{64}$/.test(v||''),editor=record.editorCover,archive=record.editorArchive;
      const sourceProved=fileHash(checkpoint.files?.cover?.sha256)&&checkpoint.sourceCoverSha===checkpoint.files.cover.sha256&&fileHash(checkpoint.files?.video?.sha256)&&checkpoint.uploadSelectionSha===checkpoint.files.video.sha256&&hash(checkpoint.coverIdentity)&&checkpoint.videoIdentity===media.fileIdHash&&checkpoint.targetDraft?.keyHash===record.keyHash;
      if(!sourceProved||editor?.isUpload!==true||editor.selectionSource!=='upload'||!hash(editor.fileIdHash)||!['width','height'].every(k=>Number.isFinite(editor[k])&&editor[k]>0)||archive?.type!=='application/zip'||!Number.isFinite(archive.size)||archive.size<=0||!hash(archive.sha256)||!hash(record.editorMaterialHash))throw Error('封面编辑器的上传来源或保存归档尚未核实');
      cover={...editor,kind:'cover-editor',archiveHash:archive.sha256};materialHash=record.editorMaterialHash;
    }else if(cover?.isUpload!==true||cover?.isUserSelect!==true)throw Error('本机草稿文案或自选封面未完整匹配');
    const target=checkpoint.targetDraft?.cover;
    if(!record.titlePaths?.includes('content.draftStore.title')||!record.descriptionPaths?.includes('content.draftStore.desc')||!cover?.fileIdHash||target?.fileIdHash&&target.fileIdHash!==cover.fileIdHash||target?.kind==='cover-editor'&&(cover.kind!=='cover-editor'||target.archiveHash!==cover.archiveHash))throw Error('本机草稿文案或自选封面未完整匹配');
    return {...record,cover,materialHash};
  }
  return record;
}

/** 点击保存后的不明结果只允许独立只读采证，绝不退回补全/保存路径。 */
export function canReconcileXhsCheckpoint(cp){
 const hash=value=>/^sha256:[a-f\d]{64}$/.test(value||''),fileHash=value=>/^[a-f\d]{64}$/.test(value||'');
 return cp?.platform==='xhs'&&cp.scope==='browser-local'&&cp.stage==='save-click-started'&&cp.baseline?.empty===true&&Number.isFinite(cp.createdAt)&&Number.isFinite(cp.updatedAt)&&cp.updatedAt>=cp.createdAt&&
  hash(cp.coverIdentity)&&fileHash(cp.files?.video?.sha256)&&fileHash(cp.files?.cover?.sha256)&&cp.sourceCoverSha===cp.files.cover.sha256&&cp.uploadSelectionSha===cp.files.video.sha256&&
  hash(cp.targetDraft?.keyHash)&&hash(cp.targetDraft?.media?.fileIdHash)&&hash(cp.targetDraft?.media?.videoIdHash)&&cp.videoIdentity===cp.targetDraft.media.fileIdHash;
}
export function reconcileXhsSavedDraft(checkpoint,local){
 if(!canReconcileXhsCheckpoint(checkpoint))throw Error('保存后只读采证所需的原素材与封面证据不完整');
 const record=bindXhsLocalDraft(checkpoint,local,{requireContent:true});
 return {...checkpoint,targetDraft:{keyHash:record.keyHash,media:record.media,cover:record.cover,materialHash:record.materialHash},reconciliationSource:'independent-readonly-after-save'};
}
