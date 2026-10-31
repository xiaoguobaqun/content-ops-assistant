import fs from 'fs';import {createHash} from 'crypto';
export function readXhsText(){
  const titles=document.querySelectorAll('input[placeholder="填写标题会有更多赞哦"]'),editors=document.querySelectorAll('.tiptap.ProseMirror[contenteditable="true"]');if(titles.length!==1||editors.length!==1)throw Error('小红书文案输入框不唯一');
  const editor=editors[0],serialize=node=>node.nodeType===3?node.nodeValue:node.nodeName==='BR'?'\n':[...node.childNodes].map(serialize).join('');
  const blocks=[...editor.children];let description=blocks.length&&blocks.every(e=>e.tagName==='P')?blocks.map(e=>e.childNodes.length===1&&e.firstChild.nodeName==='BR'?'':serialize(e)).join('\n'):serialize(editor);
  return {title:titles[0].value,description};
}
export async function fillXhsDraftText(page,expected){
  if(!expected.title||[...expected.title].length>20||String(expected.description||'').length>1000)throw Error('小红书文案超过允许长度');
  await page.waitForSelector('input[placeholder="填写标题会有更多赞哦"]',{visible:true,timeout:15000});
  const current=await page.evaluate(readXhsText);if(current.title||current.description)throw Error('小红书编辑器已有文案，停止以免覆盖');
  if(!current.title)await page.type('input[placeholder="填写标题会有更多赞哦"]',expected.title,{delay:10});if(!current.description)await page.click('.tiptap.ProseMirror[contenteditable="true"]');
  const lines=current.description?[]:String(expected.description||'').split('\n');for(let i=0;i<lines.length;i++){if(i)await page.keyboard.press('Enter');await page.keyboard.type(lines[i],{delay:5});}
  const actual=await page.evaluate(readXhsText);if(actual.title!==expected.title||actual.description!==(expected.description||''))throw Error('小红书标题或正文读回不匹配');
}

/** 从实际封面语义区找到唯一图片卡片，不按屏幕位置推断。 */
export function xhsCoverCard(){
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>50&&r.height>50&&s.visibility!=='hidden'&&s.display!=='none';};
  const heading=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&(e.textContent||'').trim()==='设置封面');if(heading.length!==1)throw Error('小红书封面区不唯一');
  let section=heading[0];for(let i=0;i<8&&section;i++,section=section.parentElement)if(section.textContent.includes('默认截取第一帧作为封面')&&section.textContent.includes('智能推荐封面'))break;
  if(!section||section===document.body)throw Error('小红书封面语义区尚未核实');
  const candidates=[...section.querySelectorAll('*')].filter(e=>visible(e)&&!e.closest('.ai-cover-preview-card')&&((e.tagName==='IMG'&&!e.classList.contains('ai-cover-preview-card'))||/url\(/.test(getComputedStyle(e).backgroundImage)));
  if(candidates.length!==1)throw Error('未找到唯一实际封面图片');return candidates[0];
}
export async function hashXhsImage(element){
  let src=element.tagName==='IMG'?element.currentSrc||element.src:'';
  if(!src){const bg=getComputedStyle(element).backgroundImage,m=bg.match(/^url\(["']?(.*?)["']?\)$/);src=m?.[1]||'';}
  if(!src)throw Error('封面图片地址未就绪');const response=await fetch(src);if(!response.ok)throw Error('封面图片无法独立读取');const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw Error('封面图片为空');
  const hash=await crypto.subtle.digest('SHA-256',bytes);return 'sha256:'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readXhsCoverIdentity(page){const h=await page.evaluateHandle(xhsCoverCard);try{return await h.evaluate(hashXhsImage);}finally{await h.dispose();}}
async function exactVisibleAction(page,labels){
  const h=await page.evaluateHandle(values=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};const a=[...document.querySelectorAll('button,[role="button"],.d-button')].filter(e=>visible(e)&&values.includes((e.textContent||'').trim())&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');if(a.length!==1)throw Error('封面操作按钮不唯一或不可用');return a[0];},labels);
  try{await h.asElement().click();}finally{await h.dispose();}
}
export async function uploadXhsCustomCover(page,file){
  const before=await readXhsCoverIdentity(page),card=await page.evaluateHandle(xhsCoverCard);try{await card.asElement().click();}finally{await card.dispose();}
  const imageInput=async()=>{const handles=await page.$$('input[type=file]'),images=[];for(const h of handles){const accept=await h.evaluate(e=>e.accept||'');if(/image|jpe?g|png/i.test(accept)&&!/video|\.mov|\.mp4/i.test(accept))images.push(h);else await h.dispose();}if(images.length!==1){await Promise.all(images.map(h=>h.dispose()));return null;}return images[0];};
  await page.waitForFunction(()=>[...document.querySelectorAll('input[type=file]')].some(e=>/image|jpe?g|png/i.test(e.accept)&&!/video|\.mov|\.mp4/i.test(e.accept))||[...document.querySelectorAll('*')].some(e=>e.childElementCount===0&&['上传封面','本地上传','上传图片'].includes((e.textContent||'').trim())),{timeout:15000});
  let input=await imageInput();if(!input){await exactVisibleAction(page,['上传封面','本地上传','上传图片']);await page.waitForFunction(()=>[...document.querySelectorAll('input[type=file]')].some(e=>/image|jpe?g|png/i.test(e.accept)&&!/video|\.mov|\.mp4/i.test(e.accept)),{timeout:10000});input=await imageInput();}if(!input)throw Error('封面图片选择框不唯一');
  let sourceCoverSha;
  try{await input.uploadFile(file);sourceCoverSha=await input.evaluate(async e=>{if(e.files.length!==1)throw Error('封面文件未选中');const hash=await crypto.subtle.digest('SHA-256',await e.files[0].arrayBuffer());return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');});}finally{await input.dispose();}
  if(sourceCoverSha!==createHash('sha256').update(fs.readFileSync(file)).digest('hex'))throw Error('封面选择内容与本机素材不匹配');
  await exactVisibleAction(page,['确定','完成','确认']);
  const until=Date.now()+20000;let coverIdentity;do{try{coverIdentity=await readXhsCoverIdentity(page);if(coverIdentity!==before)return {coverIdentity,sourceCoverSha};}catch{}await page.waitForTimeout(250);}while(Date.now()<until);throw Error('封面确认后未读到自选图片变化');
}

export async function selectXhsVideo(page,file){
  const inputs=await page.$$('input.upload-input[type=file]');if(inputs.length!==1)throw Error('视频文件输入框不唯一');
  const input=inputs[0];try{
    await input.evaluate(e=>{window.__contentOpsVideoSelection=null;e.addEventListener('change',event=>{const file=event.target.files[0];window.__contentOpsVideoSelection=file?(async()=>{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');})():Promise.reject(Error('未选中视频文件'));},{once:true,capture:true});});
    await input.uploadFile(file);return await page.evaluate(async()=>{const result=await window.__contentOpsVideoSelection;delete window.__contentOpsVideoSelection;if(!result)throw Error('缺少实际视频选择证据');return result;});
  }finally{await input.dispose();}
}
