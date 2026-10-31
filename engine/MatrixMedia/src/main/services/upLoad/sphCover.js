import fs from 'fs';
import path from 'path';

// 注入函数自包含，兼容 Shadow DOM 和渲染到页面其他位置的新版卡片编辑器。
export function findSphCoverDialog(){
  const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const norm=s=>String(s||'').replace(/\s+/g,'').trim();
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const titles=roots.flatMap(r=>[...r.querySelectorAll('*')]).filter(e=>visible(e)&&/^(编辑封面|编辑个人主页卡片)$/.test(norm(e.textContent)));
  const dialogs=[];
  for(const title of titles){
    let current=title.parentElement;
    while(current){
      const labels=[...current.querySelectorAll('*')].filter(visible).map(e=>norm(e.textContent));
      if(labels.includes('上传封面')&&labels.some(t=>t==='确认'||t==='确定')){dialogs.push(current);break;}
      current=current.parentElement;
    }
  }
  const unique=[...new Set(dialogs)];return unique.length===1?unique[0]:null;
}

async function coverSlotState(){
  const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const current=roots.flatMap(r=>[...r.querySelectorAll('.vertical-cover-wrap img.vertical-img-size')]);
  const images=(current.length?current:roots.flatMap(r=>[...r.querySelectorAll('.cover-img-vertical')])).filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden');
  const src=images.length===1?images[0].src:'';let id='';if(/^https:\/\//.test(src)){const url=new URL(src),key=url.hostname==='finder.video.qq.com'&&/^\/\d+\/\d+\/stodownload$/.test(url.pathname)&&url.searchParams.get('encfilekey');const identity=key?url.origin+url.pathname+'?encfilekey='+encodeURIComponent(key):url.href;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));id='sha256:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
  return {src,id,unique:images.length===1,candidates:current.length,visibleCount:images.length};
}

async function dialogHandle(page,timeoutMs=15000){
  const deadline=Date.now()+timeoutMs;
  do{const handle=await page.evaluateHandle(findSphCoverDialog);if(handle.asElement())return handle;await handle.dispose();await page.waitForTimeout(150);}while(Date.now()<deadline);
  throw Error('未找到唯一可见的封面编辑器，已停止');
}

async function actionHandle(dialog,labels){
  const handle=await dialog.evaluateHandle((container,allowed)=>{
    const norm=s=>String(s||'').replace(/\s+/g,'').trim();
    const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
    const candidates=[...container.querySelectorAll('button,[role="button"],a,span,div')].filter(e=>visible(e)&&allowed.includes(norm(e.textContent))).map(e=>e.closest('button,[role="button"],a')||e);
    const unique=[...new Set(candidates)].filter(e=>{
      for(let node=e;node&&node!==container.parentElement;node=node.parentElement)if(node.disabled||node.getAttribute('aria-disabled')==='true'||/(?:^|[ _-])disabled(?:$|[ _-])/.test(String(node.className))||getComputedStyle(node).pointerEvents==='none')return false;
      return true;
    });
    unique.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
    // 同一按钮的可见文本节点可以去重；不同候选按钮一律拒绝。
    const smallest=unique.filter(e=>!unique.some(other=>other!==e&&e.contains(other)));
    return smallest.length===1?smallest[0]:null;
  },labels);
  return handle;
}

async function imageInput(dialog){
  return dialog.evaluateHandle(container=>{const inputs=[...container.querySelectorAll('input[type="file"]')].filter(e=>/image/i.test(e.accept||''));return inputs.length===1?inputs[0]:null;});
}

export async function uploadSphCustomCover(page,coverPath){
  if(!fs.existsSync(coverPath))throw Error('封面文件不存在');
  let before;const readyDeadline=Date.now()+20000;do{before=await page.evaluate(coverSlotState);if(before.unique&&/^https:\/\//.test(before.src))break;await page.waitForTimeout(200);}while(Date.now()<readyDeadline);
  if(!before.unique||!/^https:\/\//.test(before.src))throw Error('未确认唯一的个人主页卡片封面（候选'+before.candidates+'，可见'+before.visibleCount+'）');
  const slot=await page.evaluateHandle(()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);const current=roots.flatMap(r=>[...r.querySelectorAll('.vertical-cover-wrap')]);const elements=(current.length?current:roots.flatMap(r=>[...r.querySelectorAll('.cover-preview-wrap')])).filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);return elements.length===1?elements[0]:null;});
  if(!slot.asElement()){await slot.dispose();throw Error('未确认唯一的个人主页卡片编辑入口');}
  try{await slot.asElement().click();}finally{await slot.dispose();}
  let dialog=await dialogHandle(page),input=await imageInput(dialog),accepted=false;
  try{
    if(!input.asElement()){
      await input.dispose();const upload=await actionHandle(dialog,['上传封面']);
      if(!upload.asElement()){await upload.dispose();throw Error('未找到唯一的上传封面入口');}
      const chooser=page.waitForFileChooser({timeout:2000}).catch(()=>null);
      try{await upload.asElement().click();}finally{await upload.dispose();}
      const fileChooser=await chooser;
      if(fileChooser){await fileChooser.accept([path.resolve(coverPath)]);accepted=true;}
      else input=await imageInput(dialog);
    }
    if(!accepted){if(!input.asElement())throw Error('未找到图片上传输入项');await input.asElement().uploadFile(path.resolve(coverPath));}
  }finally{await input.dispose().catch(()=>{});await dialog.dispose();}
  const deadline=Date.now()+15000;let clicked=false;
  do{
    dialog=await dialogHandle(page,2000);const confirm=await actionHandle(dialog,['确定','确认']);
    try{if(confirm.asElement()){await confirm.asElement().click();clicked=true;break;}}finally{await confirm.dispose();await dialog.dispose();}
    await page.waitForTimeout(200);
  }while(Date.now()<deadline);
  if(!clicked)throw Error('封面确认按钮尚不可用，停止后续提交');
  const savedDeadline=Date.now()+15000;
  do{
    const open=await page.evaluateHandle(findSphCoverDialog),isOpen=!!open.asElement();await open.dispose();
    const after=await page.evaluate(coverSlotState);
    if(!isOpen&&after.unique&&/^https:\/\//.test(after.src)&&after.id&&after.id!==before.id)return {src:after.src};
    await page.waitForTimeout(200);
  }while(Date.now()<savedDeadline);
  throw Error('封面预览或编辑弹窗尚未确认保存，停止后续提交');
}
