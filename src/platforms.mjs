// 浏览器和 Node 共用的能力声明；接入状态与实机验收分别展示。
export const platforms=Object.freeze([
  Object.freeze({id:'dy',draftVerified:true,name:'抖音',app:'抖音 App',mark:'抖',enabled:true,publish:true,titleLimit:30,descriptionLimit:1000,home:'https://creator.douyin.com/',accountUrl:'https://creator.douyin.com/creator-micro/home',validation:'草稿已实机验证；真实发布闭环待验收'}),
  Object.freeze({id:'sph',draftVerified:true,name:'微信视频号',engineName:'视频号',app:'微信',mark:'微',enabled:true,publish:false,titleLimit:30,descriptionLimit:1000,home:'https://channels.weixin.qq.com/platform/post/list',accountUrl:'https://channels.weixin.qq.com/platform',validation:'测试素材草稿已独立恢复核验并原样保留；真实发表未开放'}),
  Object.freeze({id:'xhs',loginEnabled:true,name:'小红书',app:'小红书 App',mark:'红',enabled:true,executionEnabled:false,publish:false,titleLimit:20,descriptionLimit:1000,home:'https://creator.xiaohongshu.com/',accountUrl:'https://creator.xiaohongshu.com/new/home',validation:'本人登录、测试草稿补全及独立恢复保留已验证；全新任务完整流程待复验，执行暂不开放'}),
]);
export function getPlatform(id='dy'){
  const platform=platforms.find(item=>item.id===id);
  if(!platform)throw Error('平台无效，请重新选择');return platform;
}
export function platformId(input={}){return getPlatform(input.platform===undefined?'dy':input.platform).id;}
export function accountPlatform(account){
  if(account.platform!==undefined)return getPlatform(account.platform).id;
  return platforms.find(item=>(item.engineName||item.name)===account.pt)?.id||null;
}
export function platformContent(input){
  const platform=platformId(input);
  return {title:input.title,description:platform==='sph'?[input.title,input.description].filter(Boolean).join('\n'):input.description,shortTitle:input.shortTitle||''};
}
export function validatePlatformInput(input){
  const platform=getPlatform(platformId(input));
  if(!platform.enabled)throw Error(`${platform.name}暂未接入`);
  const mode=input.mode??'draft';if(!['draft','publish'].includes(mode))throw Error('执行模式必须为 draft 或 publish');
  if(!platform.publish&&mode!=='draft')throw Error(`${platform.name}暂时只开放草稿`);
  const visibility=input.visibility??(platform.id==='dy'?'private':'unknown');
  if(platform.id==='dy'?!['private','friends','public'].includes(visibility):visibility!=='unknown')throw Error('该平台的可见范围尚未验证，请使用草稿');
  if(platform.id!=='dy'&&input.creativeStatement&&input.creativeStatement!=='none')throw Error('该平台的自主声明尚未接入');
  if([...String(input.title||'').trim()].length>platform.titleLimit)throw Error(`标题最多 ${platform.titleLimit} 个字`);
  if(typeof input.shortTitle!=='undefined'&&typeof input.shortTitle!=='string')throw Error('短标题格式无效');
  if([...String(input.shortTitle||'')].length>16)throw Error('视频号短标题最多 16 个字');
  if(input.shortTitle&&([...input.shortTitle.trim()].length<6||/[，。、\/,;:!?'"()\[\]{}<>]/.test(input.shortTitle)))throw Error('视频号短标题需为 6～16 个字，不能包含特殊标点');
  if(platform.id!=='sph'&&input.shortTitle)throw Error('该平台不使用视频号短标题');
  if((platformContent(input).description||'').length>platform.descriptionLimit)throw Error(`标题与简介合计最多 ${platform.descriptionLimit} 个字`);
  return platform;
}
export function assertPlatformExecution(input){
  const platform=validatePlatformInput(input);if(platform.executionEnabled===false)throw Error(`${platform.name}草稿尚未完成实机验收，暂不可执行`);return platform;
}
export function draftConfirmed(job,reply){
  if(platformId(job.input)==='dy')return reply?.ok===true&&reply?.evidence?.ok===true;
  const evidence=reply?.evidence;
  const matched=reply?.ok===true&&evidence?.ok===true&&evidence.preserved===true&&evidence.platform===platformId(job.input)&&evidence.clientTaskId===job.id;
  if(platformId(job.input)!=='xhs')return matched;
  return matched&&evidence.scope==='browser-local'&&['draftKeyHash','videoIdentity','coverIdentity','materialHash'].every(k=>/^sha256:[a-f\d]{64}$/.test(evidence[k]||''))&&evidence.sourceVideoSha===job.files?.video?.sha256&&evidence.sourceCoverSha===job.files?.cover?.sha256;
}
