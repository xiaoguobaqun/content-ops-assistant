import {bindXhsLocalDraft} from './xhsSafeDraft.js';
import {readXhsText,readXhsCoverIdentity} from './xhsEditor.js';

export async function openXhsStoredEditor(page,checkpoint){
  const text=await page.evaluate(()=>document.body.innerText);
  if(!text.includes('草稿箱(1)')||!text.includes('视频笔记(1)')||!text.includes(checkpoint.title))throw Error('草稿列表与唯一目标不匹配');
  const handle=await page.evaluateHandle(()=>{const found=[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return e.childElementCount===0&&(e.textContent||'').trim()==='编辑'&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';});if(found.length!==1)throw Error('未找到唯一草稿编辑入口');return found[0];});
  try{await handle.asElement().click();}finally{await handle.dispose();}
  await page.waitForSelector('input[placeholder="填写标题会有更多赞哦"]',{visible:true,timeout:20000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.video-plugin-title-action')].some(e=>(e.textContent||'').includes('重新上传')),{timeout:90000});
}

/** 核验只读恢复；不填写文案、不选择素材、不点击保存或发表。 */
export async function recoverXhsDraftContent(page,checkpoint,{audit,onStage=async()=>{},checkCancelled=()=>{},capture=async()=>{}}={}){
  checkCancelled();const record=bindXhsLocalDraft(checkpoint,await audit(),{requireContent:true});
  if(checkpoint.targetDraft?.materialHash!==record.materialHash)throw Error('目标本机草稿内容摘要已变化，停止恢复');
  checkpoint.stage='recovery-opening';await onStage(checkpoint.stage);checkCancelled();await openXhsStoredEditor(page,checkpoint);checkCancelled();
  const text=await page.evaluate(readXhsText),coverIdentity=await readXhsCoverIdentity(page);
  if(text.title!==checkpoint.title||text.description!==checkpoint.description||!checkpoint.coverIdentity||coverIdentity!==checkpoint.coverIdentity)throw Error('独立恢复的文案或封面图片与任务不匹配');
  await capture();checkCancelled();const after=bindXhsLocalDraft(checkpoint,await audit(),{requireContent:true});
  if(after.materialHash!==record.materialHash)throw Error('恢复期间草稿内容发生变化，原样保留尚未核实');
  return {ok:true,scope:'browser-local',keyHash:record.keyHash,media:record.media,cover:record.cover,materialHash:record.materialHash,coverIdentity};
}
