import path from 'path';
const preSave=new Set(['upload-selected','text-started','text-checked','processing-checked','automatic-draft-bound','cover-started','cover-checked','completion-bound','completion-editor-opened','completion-text-checked','completion-cover-started','completion-cover-checked','completion-save-ready']);
/** 补全只接受明确的既有任务；进入过保存阶段的任务只能独立回查。 */
export function validateXhsCompletionCheckpoint(cp,expected,partition){
 if(expected?.action!=='complete-existing-draft'||expected.platform!=='xhs'||!path.isAbsolute(expected.checkpointPath||'')||!expected.clientTaskId||cp?.platform!=='xhs'||cp.scope!=='browser-local'||cp.partition!==partition||cp.clientTaskId!==expected.clientTaskId||cp.title!==expected.title||cp.description!==expected.description)throw Error('小红书补全授权与原任务不匹配');
 if(typeof cp.title!=='string'||!cp.title||[...cp.title].length>20||typeof cp.description!=='string'||cp.description.length>1000||!preSave.has(cp.stage)||cp.baseline?.empty!==true||!Number.isFinite(cp.createdAt)||!Number.isFinite(cp.updatedAt)||cp.updatedAt<cp.createdAt)throw Error('小红书原任务不处于可补全的保存前阶段，只能回查');
 for(const [kind,key] of [['video','sourceVideoSha'],['cover','sourceCoverSha']])if(!path.isAbsolute(cp.files?.[kind]?.path||'')||!/^[a-f\d]{64}$/.test(cp.files[kind].sha256||'')||cp.files[kind].sha256!==expected[key])throw Error('小红书补全素材指纹不匹配');
 if(cp.uploadSelectionSha!==cp.files.video.sha256||!cp.sourceMedia||!['size','width','height','duration'].every(k=>typeof cp.sourceMedia[k]==='number'&&Number.isFinite(cp.sourceMedia[k])&&cp.sourceMedia[k]>0))throw Error('缺少原上传选择或可信视频证据，禁止补全');return cp;
}
/** 没有视频上传、删除或发布步骤；任何未知都停止，不再点击保存。 */
export async function executeSafeXhsCompletion(steps){
 const check=()=>steps.checkCancelled?.();
 for(const name of ['bind','open','text','cover']){check();await steps[name]();}
 check();const evidence=await steps.inspect();if(evidence?.ok!==true||!evidence.videoIdentity||!evidence.coverIdentity)throw Error('补全文案、媒体或封面尚未核实');
 check();await steps.checkpoint(evidence);check();await steps.save();return evidence;
}
