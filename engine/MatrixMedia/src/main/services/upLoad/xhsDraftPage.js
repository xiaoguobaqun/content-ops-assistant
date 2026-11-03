// 自包含的只读注入函数，不读取输入值、Cookie、存储或签名素材地址。
export function inspectXhsPage(){
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const elements=[...document.querySelectorAll('*')];
  const text=elements.filter(e=>visible(e)&&e.childElementCount===0&&!['SCRIPT','STYLE','INPUT','TEXTAREA','NOSCRIPT'].includes(e.tagName)).map(e=>norm(e.textContent)).filter(Boolean).join(' ').slice(0,7000);
  const fields=[...document.querySelectorAll('input,textarea,[contenteditable]')].filter(e=>e.type!=='hidden'&&e.type!=='password').map(e=>({tag:e.tagName,type:e.type||'',cls:e.className,placeholder:e.getAttribute('placeholder')||'',accept:e.accept||''}));
  const actions=[...document.querySelectorAll('button,a,[role="button"]')].filter(visible).map(e=>({tag:e.tagName,text:norm(e.textContent).slice(0,100),cls:e.className,disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true'}));
  const images=[...document.querySelectorAll('img,canvas')].filter(visible).map(e=>{let kind=e.tagName==='CANVAS'?'canvas':'',host='';try{const u=new URL(e.src);kind=u.protocol;host=u.protocol==='https:'?u.hostname:'';}catch{}const r=e.getBoundingClientRect();return {tag:e.tagName,cls:e.className,kind,host,width:r.width,height:r.height};});
  const hosts=[...document.querySelectorAll('xhs-publish-btn')].map(e=>Object.fromEntries(['submit-text','save-text','is-publish','is-save-draft','submit-disabled','save-disabled'].map(k=>[k,e.getAttribute(k)])));
  const editControls=elements.filter(e=>e.childElementCount===0&&(e.textContent||'').trim()==='编辑').map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {tag:e.tagName,namespace:e.namespaceURI,cls:String(e.className||''),display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hitTag:hit?.tagName,hitCls:String(hit?.className||''),ancestors:[e.parentElement,e.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.tagName,cls:String(p.className||'')}))};});
  const coverControls=elements.filter(e=>e.childElementCount===0&&['编辑封面','上传封面','本地上传','上传图片','确定','完成','确认'].includes((e.textContent||'').trim())).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,text:norm(e.textContent),cls:String(e.className||''),rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:visible(e),ancestors:[e.parentElement,e.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p.tagName,cls:String(p.className||'')}))};});
  return {url:location.origin+location.pathname,title:document.title,text,fields,actions,images,hosts,editControls,coverControls};
}

/** 实测登录页右上角唯一二维码模式入口；不点击登录或协议勾选框。 */
export async function switchXhsLoginToQr(page){
  const login=await page.evaluate(()=>location.origin==='https://creator.xiaohongshu.com'&&location.pathname==='/login'&&(document.body.innerText||'').includes('短信登录'));
  if(!login)return false;
  const handles=await page.$$('img.css-wemwzq');
  try{if(handles.length!==1)return false;await handles[0].click();return true;}finally{await Promise.all(handles.map(h=>h.dispose()));}
}

/** 打开已观察的草稿入口，绝不选择发表/删除/恢复等动作。 */
export async function openXhsDraftBox(page){
  const handle=await page.evaluateHandle(()=>{
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
    const found=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&visible(e)&&/^草稿箱\s*[（(]\d+[)）]$/.test((e.textContent||'').trim()));
    if(found.length!==1)throw Error('未找到唯一可见的小红书草稿箱入口');
    const e=found[0],r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    if(!hit||!(e===hit||e.contains(hit)))throw Error('小红书草稿箱入口被遮挡');return e;
  });
  try{const element=handle.asElement();if(!element)throw Error('小红书草稿箱入口无效');await element.click();}finally{await handle.dispose();}
}

/** 仅检查名称、schema和数量，不导出浏览器记录、身份或素材URL。 */
export async function inspectXhsDraftStorage(){
  const names=new Set(['draft-database-v1','local-kv-v1','article-draft','audio-draft','image-draft','video-draft','kv-store','draftId','uid','key']);
  const safe=s=>names.has(String(s))?String(s):'[storage-field]';
  const schema=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
  const localDrafts=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!/draft/i.test(key))continue;
    let value;try{value=JSON.parse(localStorage.getItem(key));}catch{value=undefined;}
    localDrafts.push({key:safe(key),type:schema(value),count:Array.isArray(value)?value.length:null,fields:value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).slice(0,50).map(safe):[]});
  }
  const databases=[];
  if(indexedDB.databases)for(const info of await indexedDB.databases()){
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(info.name,info.version);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('数据库结构不可读'));req.onupgradeneeded=()=>{req.transaction.abort();reject(Error('数据库状态变化'));};});
    try{
      const stores=[];for(const name of db.objectStoreNames){
        const tx=db.transaction(name,'readonly'),store=tx.objectStore(name);
        const count=await new Promise((resolve,reject)=>{const r=store.count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('存储数量不可读'));});
        stores.push({name:safe(name),keyPath:Array.isArray(store.keyPath)?store.keyPath.map(safe):store.keyPath? safe(store.keyPath):null,indexes:[...store.indexNames].map(safe),count});
      }databases.push({name:safe(info.name),version:info.version,stores});
    }finally{db.close();}
  }
  return {localDrafts,databases};
}

export const XHS_CREATE_URL='https://creator.xiaohongshu.com/publish/publish?from=menu&target=video';
export async function readXhsDraftBaseline(page){
  const url=new URL(page.url());if(url.origin!=='https://creator.xiaohongshu.com'||url.pathname!=='/publish/publish')throw Error('小红书草稿页地址尚未核实');
  // 已打开的抽屉不再点击入口，避免把真实草稿列表关掉。
  if(!await page.evaluate(()=>document.body.innerText.includes('草稿存储于当前使用的浏览器本地')))await openXhsDraftBox(page);
  await page.waitForFunction(()=>document.body.innerText.includes('草稿存储于当前使用的浏览器本地'),{timeout:10000});
  const text=await page.evaluate(()=>document.body.innerText),storage=await page.evaluate(inspectXhsDraftStorage);
  const stores=storage.databases.find(db=>db.name==='draft-database-v1'&&db.version===10)?.stores;
  const known=['article-draft','audio-draft','image-draft','video-draft'];
  if(!stores||stores.length!==4||known.some(name=>!stores.some(s=>s.name===name&&s.keyPath==='draftId')))return {empty:null,scope:'browser-local',message:'小红书本机草稿存储结构未核实'};
  if(stores.some(s=>s.count>0)||storage.localDrafts.some(s=>s.count!==0))return {empty:false,scope:'browser-local',storage};
  const listEmpty=['草稿箱(0)','视频笔记(0)','图文笔记(0)','长文笔记(0)','播客笔记(0)','暂无草稿'].every(t=>text.includes(t));
  return {empty:listEmpty&&stores.every(s=>s.count===0)?true:null,scope:'browser-local',storage,message:listEmpty?'':'小红书草稿列表未完整加载'};
}
