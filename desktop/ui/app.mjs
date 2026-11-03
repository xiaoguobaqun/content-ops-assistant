import {operationTime,filterTaskDates} from './task-filters.mjs';
import {verificationReportsView} from './task-ui.mjs';
import {createProfilesUI,createAiSettingsUI} from './profiles-ui.mjs';
import {peopleManager,personPicker,batchRow,batchDetail} from './people-ui.mjs';
import {createFormRevision} from './form-state.mjs';
import {platforms,getPlatform,accountPlatform} from '../../src/platforms.mjs';
const api=window.contentOps;
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon=name=>`<svg aria-hidden="true"><use href="icons.svg#${name}"/></svg>`;
const state={flow:'single',personId:'',personRevision:null,editingPersonId:'',selectedPlatforms:[],view:'workspace',data:{people:[],jobs:[],accounts:[],health:null},activity:null,serviceAlive:true,search:'',filter:'all',taskScope:'active',dateFrom:'',dateTo:'',dateInvalid:{},preview:'video',preparing:false,detailId:null,loginPlatform:'dy',revision:createFormRevision(),form:{platform:'dy',phone:'',title:'',description:'',shortTitle:'',mode:'draft',visibility:'private',creativeStatement:'none',video:null,cover:null}};
const bindingDrafts=new Map();let savingBinding=null;
function mergePeople(incoming=[]){const rows=new Map((state.data.people||[]).map(p=>[p.id,p]));for(const p of incoming){const old=rows.get(p.id);if(!old||p.revision>=old.revision)rows.set(p.id,p);}return [...rows.values()];}
const names={workspace:['发布工作台','准备好内容，把剩下的步骤交给工作流。'],tasks:['任务记录','每一次操作，都有迹可循。'],accounts:['人员与账号','按人员绑定账号，资料和任务都保留在本机。'],system:['系统状态','检查运行环境，让每一次操作更稳妥。']};
const scopes={private:'仅自己可见',friends:'好友可见',public:'公开'};
const modes={draft:'保存草稿',publish:'实际发布'};
function date(value){if(!value)return '尚未执行';const d=new Date(value);return Number.isNaN(d.getTime())?'时间未知':d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function bytes(value){return value>1024*1024?`${(value/1024/1024).toFixed(1)} MB`:`${Math.ceil((value||0)/1024)} KB`;}
function badge(job){return `<span class="badge ${escape(job.tone||'neutral')}">${escape(job.statusLabel||'待核实')}</span>`;}
function toast(message,error=false){const element=document.createElement('div');element.className='toast'+(error?' error':'');element.textContent=message;$('#toasts').append(element);setTimeout(()=>element.remove(),6500);}
async function request(method,args={}){if(!api)throw Error('请通过桌面应用打开这个工作台');const result=await api.invoke(method,args);if(result?.error)throw Error(result.error);return result;}
function busy(){return state.activity?.status==='running';}
const notifyDirty=()=>request('setUnsaved',{hasChanges:profilesUI.dirty||aiSettingsUI.dirty}).catch(()=>{});
const profilesUI=createProfilesUI({request,toast,getBusy:busy,onDirty:notifyDirty,onSettings:()=>{setView('system');$('#ai-settings-panel')?.scrollIntoView({block:'start'});}});
const aiSettingsUI=createAiSettingsUI({request,toast,getBusy:busy,onDirty:notifyDirty,onSaved:()=>profilesUI.refreshProviders()});
function currentPerson(){return (state.data.people||[]).find(p=>p.id===state.personId);}
function syncPerson(){const people=state.data.people||[];const person=currentPerson()||people[0];if((person?.id||'')!==state.personId||person?.revision!==state.personRevision){state.personId=person?.id||'';state.personRevision=person?.revision;state.selectedPlatforms=Object.keys(person?.bindings||{});state.revision.edit();}}
function workspacePlatform(){if(state.flow!=='people')return getPlatform(state.form.platform);return {...getPlatform('dy'),name:'多平台',publish:false,titleLimit:Math.min(30,...state.selectedPlatforms.map(id=>getPlatform(id).titleLimit))};}
function currentAccounts(){return state.data.accounts.filter(a=>accountPlatform(a)===state.form.platform);}
function selectAccount(){const rows=currentAccounts();if(!rows.some(a=>a.phone===state.form.phone))state.form.phone=(rows.find(a=>a.loggedIn===true)||rows[0])?.phone||'';}
function platformOptions(value,loginOnly=false){return platforms.map(p=>{const available=p.enabled||(loginOnly&&p.loginEnabled);return `<option value="${p.id}"${p.id===value?' selected':''}${available?'':' disabled'}>${p.name}${available?(p.executionEnabled===false&&!loginOnly?'（待验收）':''):p.loginEnabled?'（草稿待接入）':'（待接入）'}</option>`;}).join('');}
function jobPlatform(job){return getPlatform(job.platform??'dy');}
function scopeLabel(job){if(job.mode==='draft')return jobPlatform(job).id==='xhs'?'本机草稿 · 尚未对外发布':'草稿 · 尚未对外发布';return jobPlatform(job).id==='dy'?(scopes[job.visibility]||'未知'):jobPlatform(job).id==='xhs'?'本机草稿 · 尚未对外发布':'草稿 · 尚未对外发布';}
function accountOptions(){return currentAccounts().map(a=>`<option value="${escape(a.phone)}"${state.form.phone===a.phone?' selected':''}>${escape(a.phone)}${a.loggedIn?'':'（待连接）'}</option>`).join('');}
function jobById(id){const all=[...state.data.jobs,...(state.data.trash||[])];return all.find(job=>job.id===id)||all.flatMap(job=>job.jobs||[]).find(job=>job.id===id);}
function thumb(job){return `<span class="recent-thumb">${job.coverUrl?`<img src="${escape(job.coverUrl)}" alt="">`:icon('video')}</span>`;}
function setView(view){if(!names[view])return;if(view!==state.view&&state.view==='accounts'&&!profilesUI.canLeave())return;if(view!==state.view&&state.view==='system'&&!aiSettingsUI.canLeave())return;state.view=view;document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));$('#page-title').textContent=names[view][0];$('#page-description').textContent=names[view][1];render();}
function renderHeader(){
  const count=state.data.accounts.filter(account=>account.loggedIn).length;const button=$('#account-status');button.classList.toggle('connected',count>0);button.querySelector('span:last-child').textContent=count?`已连接 ${count} 个账号`:'尚未连接账号';
  $('#task-count').textContent=String(state.data.jobs.length);$('#service-label').textContent=state.serviceAlive?'本机工作区':'服务已停止';$('#service-indicator').className='status-dot '+(state.serviceAlive?'green':'red');$('#refresh-button').disabled=busy();
}
function renderActivity(){
  const host=$('#activity-region'),activity=state.activity;
  if(!activity||activity.status!=='running'){host.replaceChildren();renderHeader();syncButtons();return;}
  const seconds=Math.floor((Date.now()-activity.startedAt)/1000),elapsed=seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
  const loadingQr=activity.kind==='login'&&activity.loginStage!=='confirming'&&!activity.qrUrl&&activity.platform!=='xhs';
  host.innerHTML=`<div class="activity-banner"><span class="spinner" aria-hidden="true"></span><div class="activity-text"><strong>${escape(loadingQr?`正在获取${getPlatform(activity.platform||'dy').name}登录二维码`:activity.label||'正在处理任务')}</strong><p>${['execute','executeBatch'].includes(activity.kind)?'视频上传和封面处理需要一些时间，结果会自动出现在任务记录。':activity.kind==='login'?(activity.loginStage==='confirming'?'扫码已完成，正在确认账号连接，无需重复扫码。':loadingQr?'正在加载平台登录页，二维码出现后再扫码。':activity.platform==='dy'?'请用抖音 App扫码；如要求短信等本人验证，请在弹出的抖音窗口完成。':`二维码会自动刷新，请使用${getPlatform(activity.platform||'dy').app}扫码。`):'完成后会自动更新，不会重新上传内容。'}</p></div><span class="elapsed">${elapsed}</span><button class="button button-text button-small" data-action="stop">停止</button></div>`;
  renderHeader();syncButtons();
}
function batchPreparedNote(job){return ({prepared:'多平台草稿已准备好，确认后执行可用平台；待验收项不会上传。',partial:'部分平台草稿已核实，请查看各平台结果及剩余待处理项。',draft_confirmed:'全部平台草稿已核实，可在任务记录查看。',unknown:'有平台结果待核实，请先回查；已开始的平台不会重跑。',incomplete:'准备未完成，请查看任务记录。',running:'正在依次保存各平台草稿。'})[job.state]||'请查看各平台处理结果。';}
function renderWorkspace(){
  const f=state.form,job=state.revision.job;const picked=!!f.video;const ready=job?.state==='prepared';const p=workspacePlatform(),accounts=currentAccounts();
  $('#main').innerHTML=`<div class="workbench"><section class="editor-panel" aria-label="发布内容编辑"><div class="workflow-strip"><div class="workflow-step ${!ready?'active':''}"><span>1</span>选择素材</div><i class="workflow-line"></i><div class="workflow-step ${ready?'active':''}"><span>2</span>准备任务</div><i class="workflow-line"></i><div class="workflow-step ${job&&job.state!=='prepared'?'active':''}"><span>3</span>执行与核验</div></div>
  <div class="form-body"><div class="workspace-bindings"><span>人员与账号可在这里直接调整</span><button type="button" class="button button-quiet button-small" data-action="bindings">人员绑定</button></div><div class="segmented flow-selector" role="group" aria-label="发布入口"><button type="button" data-flow="people" class="${state.flow==='people'?'selected':''}">多平台存草稿</button><button type="button" data-flow="single" class="${state.flow==='single'?'selected':''}">单平台发布 / 草稿</button></div>${state.flow==='people'?personPicker({people:state.data.people||[],personId:state.personId,selected:state.selectedPlatforms,accounts:state.data.accounts,escape}):`<div class="field"><label for="platform">发布平台</label><select id="platform" name="platform">${platformOptions(f.platform)}</select></div><div class="two-columns"><div class="field"><label for="account">发布账号 <span class="required">*</span></label>${accounts.length?`<div class="account-select"><span class="platform-icon">${p.mark}</span><select id="account" name="phone">${accountOptions()}</select></div>`:`<div class="form-placeholder">还没有可用账号，<button data-view="accounts">先连接${p.name}账号</button>。</div>`}</div><div class="field"><label>执行方式</label><div class="segmented" role="group" aria-label="执行方式"><button type="button" data-mode="draft" class="${f.mode==='draft'?'selected':''}" aria-pressed="${f.mode==='draft'}">${icon('folder')}保存草稿</button>${p.publish?`${[ ['private','私密发布'],['public','公开发布'] ].map(([scope,label])=>`<button type="button" data-mode="publish" data-visibility="${scope}" class="${f.mode==='publish'&&f.visibility===scope?'selected':''}" aria-pressed="${f.mode==='publish'&&f.visibility===scope}">${icon('send')}${label}</button>`).join('')}`:''}</div></div></div>`}
  <div class="field"><div class="field-label">视频素材 <span class="required">*</span>${picked?`<span class="label-hint">${escape(f.video.name.split('.').pop().toUpperCase())} 文件</span>`:''}</div><button id="choose-video" class="file-picker ${picked?'selected-file':''}" type="button">${picked?`<span class="upload-icon">${icon('video')}</span><span class="file-name"><strong>${escape(f.video.name)}</strong><small>${bytes(f.video.size)}<span id="video-metadata"></span></small></span><span class="change-file">更换视频</span>`:`<span class="upload-icon">${icon('upload')}</span><strong>拖入视频，或点击选择</strong><small>支持 MP4、MOV 等常见视频格式 · 只选择素材，不会直接上传</small>`}</button></div>
  <div class="field"><label for="title">作品标题 <span class="required">*</span><span class="label-hint" id="title-count">${[...f.title].length} / ${p.titleLimit}</span></label><input id="title" name="title" type="text" value="${escape(f.title)}" placeholder="给这条内容一个清楚的标题" autocomplete="off"></div>
  ${(state.flow==='people'?state.selectedPlatforms.includes('sph'):f.platform==='sph')?`<p class="field-note">标题会放在视频描述开头；下面的简介接在标题后。</p><div class="field"><label for="short-title">视频号短标题（选填）</label><input id="short-title" name="shortTitle" value="${escape(f.shortTitle)}" placeholder="6～16 个字，不含特殊标点"></div>`:''}<div class="field"><label for="description">作品简介 <span class="label-hint" id="description-count">${f.description.length} / 1000</span></label><textarea id="description" name="description" maxlength="1000" placeholder="介绍视频内容，也可以留空">${escape(f.description)}</textarea></div>
  <div class="field"><div class="field-label">视频封面<span class="label-hint">${state.flow==='people'?'各平台共用所选封面':f.platform==='dy'?'横竖封面会分别设置':f.platform==='sph'?'个人主页卡片使用所选封面；分享卡片沿用平台自动封面':'使用所选封面；测试草稿已核验'}</span></div><div class="cover-options"><span class="cover-icon">${icon('image')}</span><p>${f.cover?escape(f.cover.name):'从视频中自动生成'}<small>${f.cover?'使用你选择的封面图片':'准备任务时，自动提取一帧并生成封面'}</small></p><button class="button button-text button-small" id="choose-cover">${f.cover?'更换图片':'选择图片'}</button>${f.cover?`<button class="icon-button" data-action="reset-cover" aria-label="恢复自动封面">${icon('close')}</button>`:''}</div></div>
  <hr class="field-divider">${p.publish?`<div class="two-columns"><div class="field"><label for="visibility">谁可以看</label><select id="visibility" name="visibility">${Object.entries(scopes).map(([key,value])=>`<option value="${key}"${key===f.visibility?' selected':''}>${value}</option>`).join('')}</select><p class="field-note" id="scope-note">${f.visibility==='private'?'默认仅自己可见，方便先检查内容。':f.visibility==='public'?'发布后，所有人都可以看到这条作品。':'发布后，仅抖音好友可以看到。'}</p></div><div class="field"><label for="statement">自主声明</label><select id="statement" name="creativeStatement">${Object.entries({none:'无需添加自主声明',ai_generated:'内容由 AI 生成',fiction:'演绎内容',marketing:'营销内容',personal_opinion:'个人观点',repost:'转载内容'}).map(([key,value])=>`<option value="${key}"${key===f.creativeStatement?' selected':''}>${value}</option>`).join('')}</select></div></div>`:'<p class="field-note">草稿尚未对外发布；正式发布可见范围尚未验证。目前只开放草稿。</p>'}${p.id==='xhs'?'<p class="field-note">本机草稿保存在当前浏览器，清除浏览器数据会删除。平台上传后可能自动保存。本次测试草稿已补全并恢复核验；全新任务完整流程待复验，执行暂不开放。</p>':''}</div>
  ${job?`<div class="prepared-note ${job.state==='unknown'?'amber':''}">${job.kind==='batch'?batchPreparedNote(job):job.state==='prepared'?(job.canExecute===false?'任务已准备好。小红书草稿待实机验收，当前不能执行。':f.mode==='draft'?`任务已准备好，点击下方“执行任务”保存到${p.name}草稿。`:'任务已准备好，点击下方“执行任务”发布，提交前还需确认。'):job.state==='draft_confirmed'?'已保存并恢复核验草稿。可在任务记录查看结果。':job.state==='confirmed'?'平台作品已核实，可在任务记录查看。':'这次操作的结果需要核实，请先查看任务，避免重复提交。'}</div>`:''}
  <div class="form-bottom"><span class="bottom-note">${icon('shield')}任务和素材保留在本机</span><div class="form-actions">${job?.state==='prepared'?'<button class="button button-text" data-action="reprepare">重新准备</button>':''}<button id="primary-action" class="button button-primary">${icon(job?.state==='prepared'?(f.mode==='draft'?'folder':'send'):job?'check':'plus')}<span>${job?.state==='prepared'?(f.mode==='draft'?'执行任务：保存到抖音草稿':'执行任务：发布到抖音'):job?'查看任务结果':'生成封面并准备任务'}</span></button></div></div></section>
  <aside class="preview-panel"><div class="preview-heading"><h2>作品预览</h2><span>以平台实际展示为准</span></div><section class="preview-card"><div class="preview-tabs"><button data-preview="video" class="${state.preview==='video'?'active':''}">${icon('video')}视频</button><button data-preview="cover" class="${state.preview==='cover'?'active':''}">${icon('image')}封面</button></div><div id="preview-media" class="preview-media"></div><div class="preview-caption"><strong id="preview-title">${escape(f.title||'你的作品标题')}</strong><p id="preview-description">${escape(f.description||'填写简介后，会在这里一起预览。')}</p><div class="preview-footer"><span id="preview-account">${escape(state.flow==='people'?currentPerson()?.name||'尚未选择人员':f.phone||'尚未选择账号')}</span><span class="mini-scope">${icon('lock')}<span id="preview-scope">${state.flow==='people'?'多平台草稿':f.platform==='dy'?scopes[f.visibility]:'草稿 · 尚未对外发布'}</span></span></div></div></section><div class="recent-heading"><h2>最近任务</h2><button data-view="tasks">查看全部</button></div><div class="recent-list">${state.data.jobs.slice(0,3).map(item=>`<button class="recent-item" data-detail="${item.id}">${thumb(item)}<div><strong>${escape(item.title)}</strong><small>${badge(item)}<span>${date(item.createdAt)}</span></small></div></button>`).join('')||'<div class="empty-inline">第一份任务完成后，会出现在这里。</div>'}</div></aside></div>`;
  renderMedia();bindForm();syncButtons();
}
function renderMedia(){
  const host=$('#preview-media');if(!host)return;const f=state.form,job=state.revision.job;
  const src=state.preview==='video'?f.video?.url:f.cover?.url||job?.coverUrl;
  host.classList.toggle('has-media',!!src);
  host.innerHTML=src?(state.preview==='video'?`<video id="preview-video" src="${escape(src)}" controls preload="metadata" playsinline aria-label="所选视频预览"></video>`:`<img src="${escape(src)}" alt="将要使用的封面">`):`<div class="preview-empty">${icon(state.preview==='video'?'video':'image')}<strong>${state.preview==='video'?'视频预览会显示在这里':'准备任务后查看自动封面'}</strong><p>${state.preview==='video'?'选择一段视频，开始准备内容。':'也可以选择一张自己的封面图片。'}</p></div>`;
  const video=$('#preview-video');video?.addEventListener('loadedmetadata',()=>{const target=$('#video-metadata');if(target&&Number.isFinite(video.duration))target.textContent=` / ${Math.round(video.duration)} 秒 / ${video.videoWidth}×${video.videoHeight}`;});video?.addEventListener('error',()=>toast('视频暂时无法预览，仍可准备任务检查素材。',true));
}
function bindForm(){
  $('#person')?.addEventListener('change',event=>{state.personId=event.target.value;state.personRevision=null;syncPerson();renderWorkspace();});
  document.querySelectorAll('[data-batch-platform]').forEach(input=>input.addEventListener('change',()=>{state.selectedPlatforms=['dy','sph','xhs'].filter(id=>document.querySelector(`[data-batch-platform="${id}"]`)?.checked);state.revision.edit();renderWorkspace();}));
  $('#platform')?.addEventListener('change',event=>{state.form.platform=event.target.value;state.loginPlatform=event.target.value;state.form.mode='draft';state.form.visibility=state.form.platform==='dy'?'private':'unknown';state.form.creativeStatement='none';state.form.shortTitle='';state.revision.edit();selectAccount();renderWorkspace();});
  const mapping={'short-title':'shortTitle',account:'phone',title:'title',description:'description',visibility:'visibility',statement:'creativeStatement'};
  for(const [id,key]of Object.entries(mapping))$('#'+id)?.addEventListener(id==='title'||id==='description'?'input':'change',event=>{
    state.form[key]=event.target.value;state.revision.edit();
    if(id==='title')$('#title-count').textContent=`${[...state.form.title].length} / ${workspacePlatform().titleLimit}`;
    if(id==='description')$('#description-count').textContent=`${state.form.description.length} / 1000`;
    if(id==='visibility'){document.querySelectorAll('[data-visibility]').forEach(b=>{const active=state.form.mode==='publish'&&b.dataset.visibility===state.form.visibility;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});}
    if(id==='visibility')$('#scope-note').textContent=state.form.visibility==='private'?'默认仅自己可见，方便先检查内容。':state.form.visibility==='public'?'发布后，所有人都可以看到这条作品。':'发布后，仅抖音好友可以看到。';
    $('#preview-title').textContent=state.form.title||'你的作品标题';$('#preview-description').textContent=state.form.description||'填写简介后，会在这里一起预览。';$('#preview-account').textContent=state.flow==='people'?currentPerson()?.name||'尚未选择人员':state.form.phone||'尚未选择账号';$('#preview-scope').textContent=state.flow==='people'?'多平台草稿':state.form.platform==='dy'?scopes[state.form.visibility]:'草稿 · 尚未对外发布';syncButtons();
    document.querySelector('.prepared-note')?.remove();document.querySelector('[data-action=reprepare]')?.remove();
  });
}
function syncButtons(){
  const primary=$('#primary-action');if(primary){const job=state.revision.job;primary.disabled=state.preparing||busy()||!state.serviceAlive;primary.querySelector('span').textContent=job?.kind==='batch'?(job.canExecute&&!job.needsVerification?(job.attempt?'继续未开始的平台':'执行批量草稿'):'查看各平台结果'):state.preparing?'正在准备封面…':job?.state==='prepared'?(job.canExecute===false?'查看待验收任务':state.form.mode==='draft'?`执行任务：保存到${getPlatform(state.form.platform).name}草稿`:`执行任务：发布到${getPlatform(state.form.platform).name}`):job?'查看任务结果':'生成封面并准备任务';}
  document.querySelectorAll('[data-mode],[data-flow],[data-batch-platform],#save-person,#choose-video,#choose-cover,[name],#login-button,#platform,#login-platform').forEach(element=>{element.disabled=element.dataset.unbound==='true'||busy()&&state.activity.kind!=='refresh';});
  document.querySelectorAll('[data-execute],[data-execute-batch],[data-verify]').forEach(element=>{element.disabled=busy()||state.preparing||!state.serviceAlive;});
  document.querySelectorAll('.people-form').forEach(form=>{const saving=savingBinding!==null;form.querySelectorAll('input,select,button').forEach(el=>{el.disabled=saving||busy()&&state.activity.kind!=='refresh';});if(saving)form.querySelector('#save-person').textContent='正在保存…';});
  document.querySelectorAll('[data-remove-account]').forEach(element=>{element.disabled=busy()||state.preparing||state.removingAccount||!state.serviceAlive;});
}
function acceptVideo(file){if(!file?.path)return;const previousTitle=state.form.video?.name.replace(/\.[^.]+$/,'');state.form.video=file;if(!state.form.title||state.form.title===previousTitle)state.form.title=state.flow==='people'?file.name.replace(/\.[^.]+$/,''):[...file.name.replace(/\.[^.]+$/,'')].slice(0,getPlatform(state.form.platform).titleLimit).join('');state.revision.edit();state.preview='video';renderWorkspace();}
async function prepare(){
  if(state.flow==='people')return preparePeopleBatch();
  if(!state.form.video){toast('请先选择视频',true);return;}if(!state.form.phone){toast(`请先连接并选择${getPlatform(state.form.platform).name}账号`,true);return;}if(!state.form.title.trim()){toast('请填写作品标题',true);$('#title')?.focus();return;}
  const snapshot=state.revision.begin();state.preparing=true;syncButtons();
  try{
    const f=state.form;const job=await request('prepare',{input:{platform:f.platform,shortTitle:f.shortTitle,phone:f.phone,video:f.video.path,cover:f.cover?.path,title:f.title,description:f.description,mode:f.mode,visibility:f.visibility,creativeStatement:f.creativeStatement}});
    upsert(job);if(state.revision.commit(snapshot,job)){state.preview='cover';toast('封面和任务已准备好');}else toast('内容已修改，请按当前内容重新准备任务');
  }catch(error){toast(error.message,true);}finally{state.preparing=false;render();}
}
async function preparePeopleBatch(){
  if(!currentPerson()){toast('请先创建人员并绑定账号',true);return;}
  if(!state.form.video){toast('请先选择视频',true);return;}
  const snapshot=state.revision.begin();state.preparing=true;syncButtons();
  try{const f=state.form;const batch=await request('prepareBatch',{input:{personId:state.personId,platforms:state.selectedPlatforms,video:f.video.path,cover:f.cover?.path,title:f.title,description:f.description,shortTitle:f.shortTitle}});upsert(batch);if(state.revision.commit(snapshot,batch)){state.preview='cover';toast('多平台草稿任务已准备好');}else toast('内容已变化，请重新准备');}
  catch(error){toast(error.message,true);}finally{state.preparing=false;render();}
}
async function executeBatch(id){try{const result=await request('executeBatch',{id});if(result.canceled)return;if(result.activity){state.activity=result.activity;renderActivity();}}catch(error){toast(error.message,true);}}
function upsert(job){if(job.batchId){const parent=jobById(job.batchId);if(parent?.jobs){const index=parent.jobs.findIndex(child=>child.id===job.id);if(index>=0)parent.jobs[index]=job;}return;}const index=state.data.jobs.findIndex(item=>item.id===job.id);if(index<0)state.data.jobs.unshift(job);else state.data.jobs[index]=job;}
async function execute(id){try{const result=await request('execute',{id});if(result.canceled)return;if(result.activity){state.activity=result.activity;renderActivity();}}catch(error){toast(error.message,true);}}
async function verify(id){try{const result=await request('verify',{id});state.activity=result.activity;$('#task-dialog').close();state.detailId=null;renderActivity();}catch(error){toast(error.message,true);}}
function taskRows(){return state.taskScope==='trash'?state.data.trash||[]:state.data.jobs;}
function historyAction(job){return job.trashedAt?'<button class="button button-text button-small" data-restore-task="'+job.id+'">恢复记录</button>':'<button class="button button-text button-small button-danger" data-trash-task="'+job.id+'" data-task-kind="'+(job.kind==='batch'?'batch':'job')+'"'+(busy()||job.state==='running'?' disabled':'')+'>删除记录</button>';}
function renderTasks(){
 const categories=[['all','全部'],['prepared','待执行'],['draft_confirmed','草稿'],['unknown','待核实'],['confirmed','已发布'],['partial','部分完成'],['incomplete','准备未完成'],['invalidated','已作废']];
 $('#main').innerHTML=`<section class="table-panel"><div class="table-toolbar"><div class="segmented"><button data-task-scope="active" class="${state.taskScope==='active'?'selected':''}">任务记录</button><button data-task-scope="trash" class="${state.taskScope==='trash'?'selected':''}">回收站（${(state.data.trash||[]).length}）</button></div><div class="filter-tabs" role="group" aria-label="任务状态筛选">${categories.map(([key,name])=>`<button data-filter="${key}" class="${state.filter===key?'selected':''}">${name}<small>${key==='all'?taskRows().length:taskRows().filter(job=>job.state===key).length}</small></button>`).join('')}</div><label class="search-box">${icon('search')}<input class="search-input" id="task-search" aria-label="搜索标题或账号" placeholder="搜索标题或账号" value="${escape(state.search)}"></label></div><div class="task-date-filters"><span>操作日期</span><label>从 <input id="task-from" type="date" value="${escape(state.dateFrom)}"></label><label>至 <input id="task-to" type="date" value="${escape(state.dateTo)}"></label><button class="button button-text button-small" data-action="clear-dates">清除日期</button><small>按最近执行或回查日期；未执行任务按创建日期。删除记录可从回收站恢复。</small></div><div id="task-list"></div></section>`;
 $('#task-search').addEventListener('input',event=>{state.search=event.target.value;renderTaskList();});
 for(const [id,key]of [['task-from','dateFrom'],['task-to','dateTo']])$('#'+id).addEventListener('change',event=>{state.dateInvalid[key]=event.target.validity.badInput||!event.target.validity.valid;if(!state.dateInvalid[key])state[key]=event.target.value;renderTaskList();});renderTaskList();
}
function renderTaskList(){
 if(Object.values(state.dateInvalid).some(Boolean)){$('#task-list').innerHTML='<p class="empty-inline" role="alert">日期无效或输入不完整，请更正日期或清除日期筛选。</p>';return;}
 let rows;try{rows=filterTaskDates(taskRows(),state.dateFrom,state.dateTo);}catch(error){$('#task-list').innerHTML='<p class="empty-inline" role="alert">'+escape(error.message)+'</p>';return;}
 const jobs=rows.filter(job=>(state.filter==='all'||job.state===state.filter)&&`${job.title} ${job.kind==='batch'?job.person.name+' 多平台':job.phone+' '+jobPlatform(job).name}`.toLowerCase().includes(state.search.toLowerCase()));
 $('#task-list').innerHTML=jobs.length?`<table class="task-table"><thead><tr><th>作品内容</th><th>账号 / 范围</th><th>任务状态</th><th>最近操作</th><th>操作</th></tr></thead><tbody>${jobs.map(job=>job.kind==='batch'?batchRow(job,{escape,badge,thumb,date:()=>date(operationTime(job)),disabled:busy()||state.preparing||!state.serviceAlive}).replace('</div></td></tr>',historyAction(job)+'</div></td></tr>'):`<tr><td><button class="task-title" data-detail="${job.id}">${thumb(job)}<span><strong>${escape(job.title)}</strong><small>${escape(job.videoName)}</small></span></button></td><td><span>${escape(job.phone)} · ${jobPlatform(job).name}</span><div class="muted task-subline">${scopeLabel(job)}</div></td><td>${badge(job)}</td><td class="nowrap">${date(operationTime(job))}</td><td><div class="task-actions">${job.canExecute?`<button class="button button-soft button-small" data-execute="${job.id}"${busy()||state.preparing||!state.serviceAlive?' disabled':''}>${job.mode==='draft'?'执行任务 · 存草稿':job.mode==='publish'?'执行任务 · 发布':'执行任务'}</button>`:''}<button class="button button-text button-small" data-detail="${job.id}">查看详情${icon('chevron')}</button>${historyAction(job)}</div></td></tr>`).join('')}</tbody></table><div class="table-foot">${jobs.length} 份任务。待核实的任务请先回查，避免重复提交。</div>`:'<div class="empty-state"><h2>没有找到匹配的任务</h2><p>可调整日期、状态或关键词。</p></div>';
}
function renderAccounts(){
  const accounts=state.data.accounts,p=getPlatform(state.loginPlatform);
  $('#main').innerHTML=`<div class="account-layout"><section class="table-panel"><div class="section-heading"><div><h2>已添加的账号</h2><p>共 ${accounts.length} 个账号，${accounts.filter(a=>a.loggedIn===true).length} 个已连接</p></div></div><div class="account-list">${accounts.map(account=>{const id=accountPlatform(account),ap=id?getPlatform(id):null;return `<div class="account-row"><span class="account-avatar">${escape(account.phone.slice(0,1))}</span><div class="account-info"><strong>${escape(account.phone)}</strong><small>${escape(ap?.name||account.pt||'未知平台')} / 本机账号</small></div><span class="badge ${account.loggedIn===true?'green':'amber'}">${account.loggedIn===true?'已连接':account.loggedIn===null?'待核实':'待连接'}</span>${(ap?.enabled||ap?.loginEnabled)?`<button class="button button-text button-small" data-login="${escape(account.phone)}" data-login-platform="${id}">重新连接</button><button class="button button-text button-small button-danger" data-remove-account="${escape(account.phone)}" data-remove-platform="${id}">移除账号</button>`:''}</div>`;}).join('')||`<div class="empty-state">${icon('users')}<h2>连接你的第一个账号</h2><p>在右侧选择平台并填写账号名称，再用对应 App 扫码。</p></div>`}</div></section><aside class="login-panel"><h2>连接${p.name}账号</h2><p>给账号起一个本机名称，点击下方按钮后，用${p.app}扫码登录。${p.id==='dy'?'扫码后如要求短信验证，请在自动打开的抖音窗口中完成。':''}</p><form class="login-form" id="login-form"><label for="login-platform">平台</label><select id="login-platform" name="loginPlatform">${platformOptions(state.loginPlatform,true)}</select><label for="login-phone">账号名称</label><input id="login-phone" name="loginPhone" placeholder="例如：品牌主账号" maxlength="80" autocomplete="off"><button id="login-button" class="button button-primary" type="submit">${icon('plus')}获取登录二维码</button></form><div id="qr-region"></div><div class="login-note">${icon('shield')}<span>同平台可添加多个账号，登录状态分别保留，无需每次退出切号；任务按所选账号顺序执行。账号主名称需不同，例如“品牌主号”“品牌副号”。账号授权由${p.name}处理，登录状态只保存在本机。</span></div></aside></div>`;
  const profileHost=document.createElement('div');$('#main').append(profileHost);profilesUI.mount(profileHost,state.data.people||[]);
  $('#main').insertAdjacentHTML('afterbegin',peopleManager({people:state.data.people||[],accounts,editingId:state.editingPersonId,draft:bindingDrafts.get(state.editingPersonId||'new'),escape}));
  bindPeopleEditor($('#main'),false);
  $('#login-platform').addEventListener('change',event=>{state.loginPlatform=event.target.value;renderAccounts();});
  $('#login-form').addEventListener('submit',event=>{event.preventDefault();login($('#login-phone').value);});renderQr();syncButtons();
}
function bindingInput(form){
 const key=form.dataset.bindingKey,previous=(state.data.people||[]).find(p=>p.id===key),stored=bindingDrafts.get(key),bindings={};for(const p of platforms){const phone=form.querySelector('#binding-'+p.id).value;if(phone)bindings[p.id]={platform:p.id,phone};}
 return {id:previous?.id,expectedRevision:stored?.expectedRevision??previous?.revision,name:form.querySelector('#person-name').value,bindings};
}
async function savePeopleForm(form,inDialog){
 if(savingBinding!==null)return;const key=form.dataset.bindingKey,personInput=bindingInput(form);bindingDrafts.set(key,personInput);savingBinding=key;syncButtons();
 try{const person=await request('peopleSave',{person:personInput});state.data.people=[...(state.data.people||[]).filter(p=>p.id!==person.id),person];bindingDrafts.delete(key);state.editingPersonId=person.id;state.personId=person.id;state.personRevision=null;state.flow='people';syncPerson();if(inDialog)$('#bindings-dialog').close();render();toast('人员与账号绑定已保存，仅保存在本机');}
 catch(error){toast(error.message,true);}
 finally{savingBinding=null;if(form.isConnected)form.querySelector('#save-person').textContent=personInput.id?'保存人员与绑定':'创建人员';syncButtons();}
}
function bindPeopleEditor(host,inDialog){
 const form=host.querySelector('#people-form'),editor=host.querySelector('#people-editor');form.dataset.bindingKey=editor.value||'new';
 const remember=event=>{if(event.target===editor||savingBinding!==null)return;bindingDrafts.set(form.dataset.bindingKey,bindingInput(form));};form.addEventListener('input',remember);form.addEventListener('change',remember);
 editor.addEventListener('change',event=>{if(savingBinding!==null)return;state.editingPersonId=event.target.value;if(inDialog)openBindings(state.editingPersonId);else renderAccounts();});
 form.addEventListener('submit',event=>{event.preventDefault();void savePeopleForm(event.currentTarget,inDialog);});
}
function openBindings(id=state.personId||state.editingPersonId){
 if(busy()&&state.activity.kind!=='refresh'){toast('请等待当前操作完成后修改绑定',true);return;}
 const dialog=$('#bindings-dialog');dialog.innerHTML='<div class="dialog-header"><h2 id="bindings-title">工作台 · 人员绑定</h2><button class="icon-button" data-action="close-bindings" aria-label="关闭人员绑定">×</button></div><div class="dialog-body">'+peopleManager({people:state.data.people||[],accounts:state.data.accounts,editingId:id,draft:bindingDrafts.get(id||'new'),escape})+'</div>';bindPeopleEditor(dialog,true);if(!dialog.open)dialog.showModal();
}
function renderQr(){
  const host=$('#qr-region');if(!host)return;const a=state.activity,p=getPlatform(a?.platform||state.loginPlatform);
  const confirming=a?.loginStage==='confirming';
  host.innerHTML=a?.kind==='login'&&a.status==='running'?`<div class="qr-box">${confirming?'<div class="empty-inline">正在确认登录状态，无需重复扫码。</div>':a.qrUrl?`<img src="${escape(a.qrUrl)}?t=${a.qrUpdatedAt||0}" alt="${p.name}登录二维码">`:`<div class="empty-inline">${a.platform==='xhs'?'请在已打开的小红书窗口完成扫码或本人验证。':'正在获取可扫描的二维码…'}</div>`}${confirming||!a.qrUrl?'':`<p>打开${p.app}扫一扫<br>请在手机上确认登录${p.id==='dy'?'<br>如需短信验证，请在弹出的抖音窗口完成。':''}</p>`}</div>`:'';
}
async function login(phone){try{const result=await request('login',{phone,platform:state.loginPlatform});state.activity=result.activity;renderActivity();renderQr();}catch(error){toast(error.message,true);}}
async function removeAccount(platform,phone){
  if(busy()||state.preparing||state.removingAccount)return;state.removingAccount=true;syncButtons();
  try{const result=await request('removeAccount',{platform,phone});if(result.activity){state.activity=result.activity;renderActivity();}}
  catch(error){toast(error.message,true);}finally{state.removingAccount=false;syncButtons();}
}
function renderSystem(){
  const health=state.data.health,labels={'account-lock':['账号保护','防止多个任务争用同一账号'],ffmpeg:['视频与封面处理','用于从视频生成封面'],ffprobe:['素材检查','检查视频和图片是否可用'],engine:['多平台执行引擎','用于上传、保存草稿和回查结果']};
  $('#main').innerHTML=`<section class="system-overview"><div class="system-icon">${icon(health?.ok?'check':'settings')}</div><div><h2>${health?health.ok?'运行环境已就绪':'有项目需要处理':'正在读取运行环境'}</h2><p>${health?.ok?'可以开始准备视频和执行任务。':'点击重新检查，查看本机运行环境。'}${state.data.checkedAt?` 最近检查：${date(state.data.checkedAt)}`:''}</p></div><button class="button button-quiet" data-action="refresh">${icon('refresh')}重新检查</button></section><section class="table-panel"><div class="section-heading"><h2>运行检查</h2><button class="button button-text button-small" data-action="logs">查看运行日志${icon('external')}</button></div><div class="check-list">${(health?.checks||[]).map(check=>`<div class="check-row">${icon(check.ok?'check':'info')}<div><strong>${labels[check.name]?.[0]||escape(check.name)}</strong><p>${escape(check.message||labels[check.name]?.[1]||'本机运行组件')}</p></div><span class="badge ${check.ok?'green':'amber'}">${check.ok?'可用':'需处理'}</span></div>`).join('')||'<div class="empty-inline">运行检查完成后，会在这里显示每一项的结果。</div>'}</div></section><section class="table-panel"><div class="section-heading"><h2>平台接入与验收</h2></div><div class="check-list">${platforms.map(p=>`<div class="check-row"><div><strong>${p.name}</strong><p>${p.validation}</p></div><span class="badge ${p.draftVerified?'green':'amber'}">${p.draftVerified?'草稿已验证':p.enabled?'待实机验收':p.loginEnabled?'草稿待接入':'待接入'}</span></div>`).join('')}</div></section><div class="notes-panel"><h3>关于这个工作区</h3><p>抖音和视频号测试素材草稿已实机验证；小红书本人登录及测试草稿补全、独立恢复保留已验证；全新任务完整流程待复验，执行暂不开放。任务、素材记录和登录状态保留在本机。恢复草稿时会核实内容和原样保留情况，作品结果不明确时会保留为“待核实”。<br>这是本机版本，请保留原项目目录。更换电脑需要重新准备运行环境。</p></div>`;
}
async function openDetail(id){const cached=jobById(id);if(cached)showDetail(id);const result=await request(cached?.kind==='batch'?'getBatch':'getJob',{id});if(result?.id){if(cached?.trashedAt){const i=(state.data.trash||[]).findIndex(j=>j.id===id);if(i>=0)state.data.trash[i]=result;}else upsert(result);showDetail(id);}}
async function changeTaskTrash(id,restore=false,kind='job'){const result=await request(restore?'restoreTask':'trashTask',{id,kind});if(result?.canceled)return;state.data=await request('dashboard');if(state.detailId===id){$('#task-dialog').close();state.detailId=null;}render();toast(restore?'记录已恢复，执行状态保持原样':'记录已移到回收站，可恢复');}
function showDetail(id){
  const job=jobById(id);if(!job)return;state.detailId=id;const dialog=$('#task-dialog');if(job.kind==='batch'){dialog.innerHTML=batchDetail(job,{escape,badge});if(!dialog.open)dialog.showModal();syncButtons();return;}
  dialog.innerHTML=`<div class="dialog-header"><div><h2 id="task-dialog-title">${escape(job.title)}</h2><small>创建于 ${date(job.createdAt)}</small></div>${badge(job)}<button class="icon-button" data-action="close-detail" aria-label="关闭任务详情">${icon('close')}</button></div><div class="dialog-body"><div class="detail-summary">${job.coverUrl?`<img class="detail-cover" src="${escape(job.coverUrl)}" alt="任务封面">`:''}<dl class="detail-fields"><div><dt>平台 / 账号</dt><dd>${jobPlatform(job).name} / ${escape(job.phone)}</dd></div><div><dt>执行方式</dt><dd>${modes[job.mode]||'未知'}</dd></div><div><dt>谁可以看</dt><dd>${scopeLabel(job)}</dd></div><div><dt>视频素材</dt><dd>${escape(job.videoName)}</dd></div><div><dt>上次执行</dt><dd>${date(job.finishedAt||job.startedAt)}</dd></div><div><dt>最近核验</dt><dd>${job.checkedAt?date(job.checkedAt):'尚无独立回查'}</dd></div></dl></div>${job.description?`<p class="detail-description">${escape(job.description)}</p>`:''}<div class="result-box ${job.state==='unknown'?'amber':''}"><strong>${escape(job.statusLabel)}</strong><p>${escape(job.message||({prepared:'内容已准备好，可以开始执行。',draft_confirmed:'草稿已恢复并核验，内容按该平台的草稿方式保留。',confirmed:'已找到符合本次任务的作品。',running:'流程正在执行，请耐心等待。',unknown:'结果还未确认，请先回查，避免重复提交。'}[job.state]))}</p>${job.platformWorkId?`<p>作品编号：${escape(job.platformWorkId)}</p>`:''}${job.state==='confirmed'?'<p>作品已创建；审核状态请以平台显示为准。</p>':''}</div>${verificationReportsView(job.verificationReports,{escape,date})}${job.screenshotUrl?`<details><summary class="button button-text">查看核验截图</summary><img class="detail-screenshot" src="${escape(job.screenshotUrl)}" alt="最近一次平台草稿核验截图"></details>`:''}<div class="detail-actions"><button class="button button-text" data-show-job="${job.id}">${icon('folder')}任务文件</button><button class="button button-quiet" data-open-platform="${job.id}">${icon('external')}打开${jobPlatform(job).name}</button>${job.canVerify?`<button class="button button-primary" data-verify="${job.id}"${busy()?' disabled':''}>${icon('refresh')}回查结果</button>`:''}${job.canExecute?`<button class="button button-primary" data-execute="${job.id}"${busy()?' disabled':''}>${icon(job.mode==='draft'?'folder':'send')}${job.mode==='draft'?`执行任务：保存到${jobPlatform(job).name}草稿`:`执行任务：发布到${jobPlatform(job).name}`}</button>`:''}</div></div>`;
  if(!dialog.open)dialog.showModal();
}
function render(){renderHeader();({workspace:renderWorkspace,tasks:renderTasks,accounts:renderAccounts,system:renderSystem}[state.view])();if(state.view==='system'){const host=document.createElement('div');$('#main').append(host);aiSettingsUI.mount(host);}renderActivity();}
async function refresh(){try{const result=await request('refresh');state.activity=result.activity;renderActivity();}catch(error){toast(error.message,true);}}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  try{
    if(button.dataset.view){setView(button.dataset.view);return;}
    if(button.dataset.flow){state.flow=button.dataset.flow;state.form.mode='draft';state.revision.edit();syncPerson();if(state.flow==='single'){const binding=currentPerson()?.bindings[state.form.platform];if(binding)state.form.phone=binding.phone;selectAccount();}renderWorkspace();return;}
    if(button.dataset.executeBatch){const dialog=$('#task-dialog');if(dialog.open)dialog.close();state.detailId=null;await executeBatch(button.dataset.executeBatch);return;}
    if(button.dataset.detail){await openDetail(button.dataset.detail);return;}
    if(button.dataset.taskScope){state.taskScope=button.dataset.taskScope;state.dateFrom='';state.dateTo='';state.dateInvalid={};renderTasks();return;}
    if(button.dataset.trashTask){await changeTaskTrash(button.dataset.trashTask,false,button.dataset.taskKind);return;}
    if(button.dataset.restoreTask){await changeTaskTrash(button.dataset.restoreTask,true);return;}
    if(button.dataset.filter){state.filter=button.dataset.filter;renderTasks();return;}
    if(button.dataset.mode){state.form.mode=button.dataset.mode;if(button.dataset.visibility)state.form.visibility=button.dataset.visibility;state.revision.edit();renderWorkspace();return;}
    if(button.dataset.preview){state.preview=button.dataset.preview;document.querySelectorAll('[data-preview]').forEach(b=>b.classList.toggle('active',b===button));renderMedia();return;}
    if(button.dataset.removeAccount){await removeAccount(button.dataset.removePlatform,button.dataset.removeAccount);return;}
    if(button.dataset.login){state.loginPlatform=button.dataset.loginPlatform||'dy';setView('accounts');$('#login-phone').value=button.dataset.login;await login(button.dataset.login);return;}
    if(button.dataset.verify){await verify(button.dataset.verify);return;}
    if(button.dataset.execute){const dialog=$('#task-dialog');if(dialog.open)dialog.close();state.detailId=null;await execute(button.dataset.execute);return;}
    if(button.dataset.showJob){await request('showJob',{id:button.dataset.showJob});return;}
    if(button.dataset.openPlatform){await request('openPlatform',{id:button.dataset.openPlatform});return;}
    if(button.id==='choose-video'){const file=await request('chooseVideo');if(file)acceptVideo(file);return;}
    if(button.id==='choose-cover'){const file=await request('chooseCover');if(file){state.form.cover=file;state.revision.edit();state.preview='cover';renderWorkspace();}return;}
    if(button.id==='primary-action'){const job=state.revision.job;if(!job)await prepare();else if(job.kind==='batch'){if(job.canExecute&&!job.needsVerification)await executeBatch(job.id);else showDetail(job.id);}else if(job.state==='prepared'&&job.canExecute)await execute(job.id);else showDetail(job.id);return;}
    const action=button.dataset.action;
    if(action==='bindings')openBindings();
    if(action==='close-bindings')$('#bindings-dialog').close();
    if(action==='clear-dates'){state.dateFrom='';state.dateTo='';state.dateInvalid={};renderTasks();}
    if(action==='reset-cover'){state.form.cover=null;state.revision.edit();renderWorkspace();}
    if(action==='reprepare'){state.revision.edit();await prepare();}
    if(action==='close-detail'){$('#task-dialog').close();state.detailId=null;}
    if(action==='refresh'||button.id==='refresh-button')await refresh();
    if(action==='logs')await request('showLogs');
    if(action==='stop'){const result=await request('stop');if(!result.canceled){state.activity=null;state.serviceAlive=true;toast('已停止操作。未完成的任务请先回查。');const data=await request('dashboard');state.data=data;render();}}
  }catch(error){toast(error.message,true);}
});
$('#task-dialog').addEventListener('close',()=>{state.detailId=null;});
api?.onUpdate(event=>{
  if(event.type==='videoSelected'){acceptVideo(event.video);return;}
  if(event.type==='videoDropError'){toast(event.message,true);return;}
  if(event.profile)profilesUI.update(event.profile);
  if(event.type==='peopleUpdated'){state.data.people=mergePeople(event.people||[]);syncPerson();if(state.view==='workspace')renderWorkspace();else if(state.view==='accounts')renderAccounts();}
  if(event.type==='service-exit'){state.serviceAlive=false;state.activity=null;renderActivity();toast(event.message,true);return;}
  if(event.activity?.kind==='verify'&&event.activity.status!=='running'&&event.activity.jobId){void openDetail(event.activity.jobId).catch(error=>toast(error.message,true));}
  if(event.activity){const previous=state.activity;state.activity=event.activity;renderActivity();renderQr();profilesUI.refreshBusy();aiSettingsUI.refreshBusy();if(previous?.status==='running'&&event.activity.status!=='running'&&event.activity.kind!=='refresh')toast(event.activity.message,event.activity.status==='failed'||event.activity.status==='attention');}
  if(event.batch){upsert(event.batch);if(state.revision.job?.id===event.batch.id)state.revision.commit(state.revision.begin(),event.batch);}
  if(event.job){upsert(event.job);if(state.revision.job?.id===event.job.id)state.revision.commit(state.revision.begin(),event.job);}
  if(event.type==='snapshot'&&event.data){const people=mergePeople(event.data.people||[]);state.data={...event.data,people};selectAccount();syncPerson();if(state.revision.job){const fresh=jobById(state.revision.job.id);if(fresh)state.revision.commit(state.revision.begin(),fresh);}render();if(state.detailId)showDetail(state.detailId);}
});
setInterval(()=>{if(busy())renderActivity();},1000);
async function boot(){render();try{state.data=await request('dashboard');selectAccount();syncPerson();if((state.data.people||[]).length)state.flow='people';state.activity=state.data.activity;render();if(!busy())await refresh();}catch(error){state.serviceAlive=false;renderHeader();toast(error.message,true);}}
boot();
