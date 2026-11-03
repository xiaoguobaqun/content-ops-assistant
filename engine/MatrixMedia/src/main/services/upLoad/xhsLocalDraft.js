/** 已观察的IndexedDB只读审计；原始身份/签名地址只在内存参与摘要，绝不输出。 */
export async function auditXhsStoredVideoDrafts(expected={}){
  const infos=await indexedDB.databases();if(!infos.some(d=>d.name==='draft-database-v1'&&d.version===10))throw Error('本机草稿数据库未就绪');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('draft-database-v1',10);r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('草稿数据库结构变化'));};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('草稿数据库不可读'));});
  let records;try{
    if(!db.objectStoreNames.contains('video-draft'))throw Error('视频草稿存储不存在');
    const request=method=>new Promise((resolve,reject)=>{const r=db.transaction('video-draft','readonly').objectStore('video-draft')[method]();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('本机草稿读取失败'));});
    const count=await request('count');if(count!==1)return {scope:'browser-local',count,records:[]};records=await request('getAll');
  }finally{db.close();}
  const digest=async bytes=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const names=new Set(['content','draftStore','contextStore','coverContext','recommendCovers','blob','title','description','desc','descInnerHTML','video','cover','draftId','uid','timeStamp','fileid','fileId','videoId','fsize','width','height','duration','frame','isUpload','isUserSelect','ts','pkCoverList','settingStore','publishStore','pkCoverEnabled','original','userDeclaration','privacyInfo','articleStore','url2FileIdMap']);
  const safe=s=>names.has(String(s))||/^\d{1,4}$/.test(String(s))?String(s):'[field]';
  const results=[];
  for(const record of records){
    const blobs=[],titlePaths=[],descriptionPaths=[];
    const visit=async(value,path,collect=true)=>{
      if(value instanceof Blob){const hash=await digest(await value.arrayBuffer());if(collect)blobs.push({path,size:value.size,type:value.type,sha256:hash.slice(7)});return {canonical:['blob',value.size,value.type,hash],shape:{type:value instanceof File?'File':'Blob',size:value.size,mime:value.type}};}
      if(value===null)return {canonical:null,shape:'null'};
      if(typeof value!=='object'){
        if(collect&&typeof value==='string'&&value===expected.title)titlePaths.push(path);
        if(collect&&typeof value==='string'&&value===expected.description)descriptionPaths.push(path);
        return {canonical:value,shape:typeof value};
      }
      if(value instanceof Date)return {canonical:['Date',value.toISOString()],shape:'Date'};
      const canonical=[],shape=Array.isArray(value)?[]:{};
      for(const key of Object.keys(value).sort()){const childPath=path?path+'.'+safe(key):safe(key),child=await visit(value[key],childPath,collect);canonical.push([key,child.canonical]);shape[safe(key)]=child.shape;}
      return {canonical,shape};
    };
    const {canonical,shape}=await visit(record,'');const material=await visit({draftStore:record.content?.draftStore,settingStore:record.content?.settingStore,cover:record.content?.contextStore?.coverContext?.cover,pkCoverEnabled:record.content?.publishStore?.pkCoverEnabled},'',false);const materialHash=await digest(JSON.stringify(material.canonical));const video=record.content?.draftStore?.video,cover=record.content?.draftStore?.cover;const media=video?{fileIdHash:video.fileid?await digest(video.fileid):null,videoIdHash:video.videoId?await digest(video.videoId):null,size:video.fsize,width:video.width,height:video.height,duration:video.duration}:null;
    const editor=record.content?.contextStore?.coverContext,editorCover=editor?.cover;
    // 新封面编辑器的恢复依赖模板归档；独立摘要须包含整个上下文，不能只读旧默认帧。
    const editorMaterialHash=editor?await digest(JSON.stringify([material.canonical,(await visit(editor,'',false)).canonical])):null;
    const editorSchema=Object.entries(editor||{}).filter(([k])=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)).map(([name,value])=>({name,type:value instanceof Blob?'Blob':value===null?'null':typeof value,fields:value&&typeof value==='object'&&!(value instanceof Blob)?Object.keys(value).filter(k=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)).slice(0,30):undefined}));
    results.push({materialHash,editorMaterialHash,timeStamp:record.timeStamp,ownerMatched:expected.expectedUserId?record.uid===expected.expectedUserId:null,media,cover:cover?{fileIdHash:cover.fileid?await digest(cover.fileid):null,isUpload:cover.frame?.isUpload,isUserSelect:cover.frame?.isUserSelect}:null,editorCover:editorCover?{fileIdHash:editorCover.fileid?await digest(editorCover.fileid):null,isUpload:editorCover.frame?.isUpload,isUserSelect:editorCover.frame?.isUserSelect,width:editorCover.width,height:editorCover.height,selectionSource:typeof editorCover.selectionSource==='string'&&/^[a-zA-Z_-]{1,32}$/.test(editorCover.selectionSource)?editorCover.selectionSource:'[unknown]'}:null,editorArchive:editor?.templateBlob instanceof Blob?{size:editor.templateBlob.size,type:editor.templateBlob.type,sha256:await digest(await editor.templateBlob.arrayBuffer())}:null,editorSchema,keyHash:await digest(String(record.draftId)),recordHash:await digest(JSON.stringify(canonical)),titlePaths,descriptionPaths,blobs,shape});
  }
  return {scope:'browser-local',count:records.length,records:results};
}
