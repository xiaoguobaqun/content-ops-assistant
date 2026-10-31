export const SPH_LIST_URL='https://channels.weixin.qq.com/platform/post/list';
export const SPH_DRAFT_URL='https://channels.weixin.qq.com/platform/post/draftListManager';
export const SPH_CREATE_URL='https://channels.weixin.qq.com/platform/post/create';

/** 失败现场仅记录可见控件结构，不读 Cookie、密码或隐藏输入值。 */
export function inspectSphFailurePage(){
  const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const all=selector=>roots.flatMap(r=>[...r.querySelectorAll(selector)]);
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const ancestry=e=>{const result=[];for(let n=e;n&&result.length<6;n=n.parentElement)result.push({tag:n.tagName,cls:String(n.className||''),role:n.getAttribute('role')});return result;};
  const labels=all('*').filter(e=>visible(e)&&/^(编辑封面|编辑个人主页卡片|上传封面|确定|确认)$/.test((e.textContent||'').trim())&&e.childElementCount<2).map(e=>({text:e.textContent.trim(),ancestors:ancestry(e)}));
  const fileInputs=all('input[type="file"]').map(e=>({accept:e.accept,cls:e.className,parents:ancestry(e),files:e.files?.length||0}));
  const images=all('img').filter(e=>visible(e)&&/cover|crop|preview/.test(e.className)).map(e=>({cls:e.className,src:e.src.startsWith('https:')?e.src.replace(/[?#].*$/,''):e.src.split(':')[0]+':',parents:ancestry(e)}));
  return {rootCount:roots.length,labels,fileInputs,images};
}

// 页面注入函数保持自包含，避免打包后引用被改名的闭包。
export function readSphDraftPage(){
  const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const visible=e=>!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=='hidden';
  const norm=s=>String(s||'').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
  const text=roots.flatMap(r=>[...r.querySelectorAll('*')].filter(e=>visible(e)&&e.childElementCount===0&&!['SCRIPT','STYLE'].includes(e.tagName)).map(e=>norm(e.textContent))).join(' ');
  const rows=roots.flatMap(r=>[...r.querySelectorAll('[data-draft-id],.draft-item,.draft-list-item,.post-draft-item,.weui-desktop-table__tbody tr,.ant-table-row')]).filter(visible);
  const loading=roots.some(r=>[...r.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.weui-desktop-loading')].some(visible))||/正在加载|加载中/.test(text);
  const draftTab=roots.flatMap(r=>[...r.querySelectorAll('button,a,[role="tab"],.weui-desktop-tab__nav__item,.ant-tabs-tab')]).filter(e=>visible(e)&&/^草稿(?:箱)?(?:\s*[（(]?\d+[)）]?)?$/.test(norm(e.textContent)));
  const inManager=location.pathname==='/platform/post/draftListManager';
  const selected=inManager||draftTab.some(e=>e.getAttribute('aria-selected')==='true'||/active|selected/.test(e.className));
  const draftMenu=roots.some(r=>[...r.querySelectorAll('.finder-ui-desktop-sub-menu__item')].some(e=>norm(e.textContent)==='草稿箱'));
  const positive=rows.length>0&&selected||draftTab.some(e=>/[（(]\s*[1-9]\d*\s*[)）]/.test(e.textContent))||/继续编辑|恢复草稿/.test(text);
  const zeroInManager=inManager&&draftTab.some(e=>/^草稿箱\s*[（(]\s*0\s*[)）]$/.test(norm(e.textContent)));
  const emptyText=zeroInManager||/暂无草稿|还没有草稿|暂无任何草稿/.test(text)||(selected&&/暂无内容|暂无数据|还没有内容/.test(text));
  return {empty:loading?null:positive?false:emptyText?true:null,loading,draftTab:draftTab.length,draftMenu,selected,rows:rows.length,text:text.slice(0,6000),url:location.href};
}

export async function inspectSphEditor(expected){
  const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const find=selector=>roots.map(r=>r.querySelector(selector)).find(Boolean);
  const norm=s=>String(s||'').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
  // 已观察到 Finder 以 encfilekey 区分文件、token/尺寸参数用于访问和展示；其他地址保守散列完整 URL。
  const asset=async s=>{if(!/^https:\/\//.test(String(s||'')))return '';const url=new URL(s),key=url.hostname==='finder.video.qq.com'&&/^\/\d+\/\d+\/stodownload$/.test(url.pathname)&&url.searchParams.get('encfilekey');const identity=key?url.origin+url.pathname+'?encfilekey='+encodeURIComponent(key):url.href;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));return 'sha256:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');};
  const editor=find('.input-editor'),short=find('input[placeholder="填写短标题有机会获得更多流量"]');
  const video=find('video'),source=video&&(video.currentSrc||video.getAttribute('src')||'');
  const media=video?{width:video.videoWidth,height:video.videoHeight,duration:Number.isFinite(video.duration)?video.duration:null}:null;
  const remote=/^https:\/\//.test(source)?await asset(source):'';
  const metadataId=media?.width>0&&media?.height>0&&media?.duration>0?`${media.width}x${media.height}@${media.duration.toFixed(2)}`:'';
  const mediaId=remote||metadataId;
  const coverSrc=await asset((find('.vertical-cover-wrap img.vertical-img-size')||find('.cover-img-vertical'))?.src);
  const original=find('.declare-original-checkbox input[type="checkbox"]');
  const descriptionMatches=!!editor&&norm(editor.innerText||editor.textContent)===norm(expected.description);
  const shortTitleMatches=norm(short?.value)===norm(expected.shortTitle);
  const mediaMatches=!expected.mediaId||expected.mediaId===mediaId||(/^\d+x\d+@\d+\.\d{2}$/.test(expected.mediaId)&&expected.mediaId===metadataId);
  const coverMatches=!expected.coverSrc||expected.coverSrc===coverSrc;
  const ok=descriptionMatches&&shortTitleMatches&&!!mediaId&&/^sha256:[a-f0-9]{64}$/.test(coverSrc)&&mediaMatches&&coverMatches&&!original?.checked;
  return {ok,descriptionMatches,shortTitleMatches,mediaMatches,coverMatches,originalSelected:!!original?.checked,mediaId,media,coverSrc};
}

async function control(page,kind,expected){
  const handle=await page.evaluateHandle(async(action,conditions)=>{
    const asset=async s=>{if(!/^https:\/\//.test(String(s||'')))return '';const url=new URL(s),key=url.hostname==='finder.video.qq.com'&&/^\/\d+\/\d+\/stodownload$/.test(url.pathname)&&url.searchParams.get('encfilekey');const identity=key?url.origin+url.pathname+'?encfilekey='+encodeURIComponent(key):url.href;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));return 'sha256:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');};
    const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
    const norm=s=>String(s||'').replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const visible=e=>!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)&&getComputedStyle(e).visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!/(?:^|[ _-])disabled(?:$|[ _-])/.test(String(e.className));
    if(action==='save'&&roots.some(r=>[...r.querySelectorAll('[role="dialog"],.weui-desktop-dialog')].some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden')))return null;
    let candidates=[];
    if(action==='recover'){
      const rows=roots.flatMap(r=>[...r.querySelectorAll('[data-draft-id],.draft-item,.draft-list-item,.post-draft-item,.weui-desktop-table__tbody tr,.ant-table-row')]);
      const matched=[];for(const row of rows){if(visible(row)&&norm(row.textContent).includes(norm(conditions.title))&&(await Promise.all([...row.querySelectorAll('img')].map(img=>asset(img.src)))).includes(conditions.coverSrc))matched.push(row);}
      if(matched.length!==1)return null;
      return matched[0];
    }else{
      candidates=roots.flatMap(r=>[...r.querySelectorAll('button,a,[role="button"],[role="tab"],.weui-desktop-tab__nav__item,.ant-tabs-tab')]).filter(e=>visible(e)&&(action==='save'?/^保存草稿$/.test(norm(e.textContent)):/^草稿(?:箱)?(?:\s*[（(]?\d+[)）]?)?$/.test(norm(e.textContent))));
    }
    return candidates.length===1?candidates[0]:null;
  },kind,expected||{});
  const button=handle.asElement();if(!button){await handle.dispose();throw Error(kind==='recover'?'无法唯一定位本次草稿，禁止重新上传':'未确认唯一且可用的草稿按钮，已停止');}
  try{
    if(kind==='recover'){
      await button.hover();const edit=await button.evaluateHandle(row=>{const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';const edits=[...row.querySelectorAll('button,a,[role="button"],.opr-item')].filter(e=>visible(e)&&/^(编辑|继续编辑)$/.test((e.textContent||'').trim()));return edits.length===1?edits[0]:null;});
      try{if(!edit.asElement())throw Error('未确认唯一可用的草稿编辑入口');await edit.asElement().click();}finally{await edit.dispose();}
    }else await button.click();
  }finally{await handle.dispose();}
}
export function clickSphDraftSave(page){return control(page,'save');}

export async function waitSphElement(page,selector,{timeoutMs=30000}={}){
  const deadline=Date.now()+timeoutMs;
  do{
    const handle=await page.evaluateHandle(sel=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);const found=roots.flatMap(r=>[...r.querySelectorAll(sel)]);return found.length===1?found[0]:null;},selector);
    const element=handle.asElement();if(element)return element;await handle.dispose();await page.waitForTimeout(100);
  }while(Date.now()<deadline);
  throw Error(`未找到唯一的页面输入项：${selector}`);
}

export async function saveSphDraftOnce(page,{timeoutMs=20000}={}){
  // 当前平台保存后仍留在编辑页。观察本次点击发起的实际响应，不能依赖跳转或中断未完成的请求。
  const requests=new Set();let witness=null;
  const relevant=request=>{try{const u=new URL(request.url());return request.method()==='POST'&&u.hostname==='channels.weixin.qq.com'&&u.pathname==='/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft';}catch{return false;}};
  const onRequest=request=>{if(relevant(request))requests.add(request);};
  const onResponse=async response=>{if(!requests.has(response.request()))return;try{const j=await response.json();witness={ok:response.status()>=200&&response.status()<300&&j.errCode===0&&typeof j.data?.objectId==='string'&&j.data.objectId.length>0,source:'post_draft',objectId:typeof j.data?.objectId==='string'?j.data.objectId:null};}catch{witness={ok:false};}};
  page.on('request',onRequest);page.on('response',onResponse);
  try{
    await clickSphDraftSave(page);const deadline=Date.now()+timeoutMs;
    do{if(witness){if(!witness.ok)throw Error('平台没有确认本次草稿保存，禁止再次点击');return witness;}
      await page.waitForTimeout(100);
    }while(Date.now()<deadline);
    throw Error('等待草稿保存结果超时，请回查原任务');
  }finally{page.off('request',onRequest);page.off('response',onResponse);}
}

export async function readSphDraftBaseline(page,options={}){
  for(let attempt=0;attempt<3;attempt++){
    try{return await readSphDraftBaselineOnce(page,options);}
    catch(error){if(attempt===2||!/net::ERR_ABORTED/.test(error.message||''))throw error;await page.waitForTimeout(200);}
  }
}
async function readSphDraftBaselineOnce(page,{timeoutMs=15000}={}){
  const requests=new Set();let witness=null,snapshot;
  const relevant=request=>{try{const u=new URL(request.url());return u.hostname==='channels.weixin.qq.com'&&u.pathname==='/micro/content/cgi-bin/mmfinderassistant-bin/post/get_draft_list';}catch{return false;}};
  const onRequest=request=>{if(relevant(request))requests.add(request);};
  const onResponse=async response=>{
    if(!requests.has(response.request()))return;
    try{const payload=await response.json(),data=payload?.data,count=data?.totalCount;
      if(response.status()>=200&&response.status()<300&&payload.errCode===0&&Array.isArray(data?.list)&&Number.isSafeInteger(count)&&count>=0){witness={source:'get_draft_list',count,listCount:data.list.length,complete:count===0&&data.list.length===0,observedAt:Date.now()};}
    }catch{}
  };
  page.on('request',onRequest);page.on('response',onResponse);
  try{
    try{await page.goto(SPH_DRAFT_URL,{waitUntil:'domcontentloaded',timeout:20000});}
    catch(error){if(!page.url().startsWith(SPH_DRAFT_URL))throw error;}
    const deadline=Date.now()+timeoutMs;
    do{
      snapshot=await page.evaluate(readSphDraftPage);
      if(snapshot.empty===false||witness?.count>0)return {...snapshot,empty:false,witness};
      if(snapshot.empty===true&&witness?.complete===true)return {...snapshot,empty:true,witness};
      await page.waitForTimeout(150);
    }while(Date.now()<deadline);
    return {...snapshot,empty:null,witness,message:'未取得完整的草稿列表响应，禁止上传'};
  }finally{page.off('request',onRequest);page.off('response',onResponse);}
}

export async function recoverAndPreserveSphDraft(page,expected,{capture,timeoutMs=20000,onStage=async()=>{},withListPage=async read=>read(page)}={}){
  if(!expected.clientTaskId||!expected.mediaId||!expected.coverSrc||expected.baseline?.empty!==true)throw Error('缺少本次任务的上传检查点，不能安全恢复草稿');
  const baseline=await readSphDraftBaseline(page,{timeoutMs});
  if(baseline.empty!==false)throw Error('未找到可唯一核验的已保存草稿；不会重新上传');
  await onStage('recovering');await control(page,'recover',expected);
  let evidence,readFailure,preserved=false;
  try{
    const deadline=Date.now()+timeoutMs;
    do{evidence=await page.evaluate(inspectSphEditor,expected);if(evidence.ok)break;await page.waitForTimeout(400);}while(Date.now()<deadline);
    if(!evidence?.ok)throw Error('恢复后的草稿内容不匹配');
    if(capture)await capture();
  }catch(error){readFailure=error;}
  // 恢复不修改字段。只在确实到达本次目标编辑器后原样暂存一次。
  const editorPresent=await page.evaluate(()=>{const root=document.querySelector('wujie-app.wujie_iframe')?.shadowRoot||document.querySelector('wujie-app')?.shadowRoot||document;return !!root.querySelector('.input-editor');}).catch(()=>false);
  if(editorPresent){
    try{await onStage('preserving');await saveSphDraftOnce(page,{timeoutMs});
      preserved=await withListPage(async listPage=>{const after=await readSphDraftBaseline(listPage,{timeoutMs});if(after.empty!==false)return false;const deadline=Date.now()+timeoutMs;do{
        // 再确认目标行仍在，避免只凭“某一份草稿存在”判定保留成功。
        const matched=await listPage.evaluate(async conditions=>{const asset=async s=>{if(!/^https:\/\//.test(String(s||'')))return '';const url=new URL(s),key=url.hostname==='finder.video.qq.com'&&/^\/\d+\/\d+\/stodownload$/.test(url.pathname)&&url.searchParams.get('encfilekey');const identity=key?url.origin+url.pathname+'?encfilekey='+encodeURIComponent(key):url.href;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));return 'sha256:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');};const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);const rows=roots.flatMap(r=>[...r.querySelectorAll('[data-draft-id],.draft-item,.draft-list-item,.post-draft-item,.weui-desktop-table__tbody tr,.ant-table-row')]);let matches=0;for(const row of rows)if((row.textContent||'').includes(conditions.title)&&(await Promise.all([...row.querySelectorAll('img')].map(img=>asset(img.src)))).includes(conditions.coverSrc))matches++;return matches===1;},expected);
        if(matched)return true;await listPage.waitForTimeout(100);
      }while(Date.now()<deadline);return false;});
    }catch(error){if(!readFailure)readFailure=error;}
  }
  const result={...evidence,platform:'sph',clientTaskId:expected.clientTaskId,preserved,ok:evidence?.ok===true&&preserved};
  if(readFailure||!result.ok){const error=readFailure||Error('未确认原样保留草稿');error.evidence=result;throw error;}
  await onStage('verified');return result;
}
