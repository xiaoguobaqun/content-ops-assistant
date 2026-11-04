import test from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
import {auditXhsStoredVideoDrafts} from '../src/main/services/upLoad/xhsLocalDraft.js';
import {bindXhsLocalDraft,reconcileXhsSavedDraft} from '../src/main/services/upLoad/xhsSafeDraft.js';

test('cover-editor persistence binds the uploaded cover and archive rather than the unchanged default frame',async t=>{
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<body></body>'}));await page.goto('https://creator.xiaohongshu.com/publish/publish');
  await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('draft-database-v1',10);r.onupgradeneeded=()=>r.result.createObjectStore('video-draft',{keyPath:'draftId'});r.onsuccess=()=>{const db=r.result,tx=db.transaction('video-draft','readwrite');tx.objectStore('video-draft').put({draftId:'fixture',uid:'private-owner',timeStamp:1500,content:{draftStore:{title:'标题',desc:'简介',video:{fileid:'video-asset',videoId:'video-id',fsize:99,width:1920,height:1080,duration:29.7},cover:{fileid:'default-frame',frame:{isUpload:false,isUserSelect:false}}},contextStore:{coverContext:{cover:{fileid:'uploaded-cover',width:1592,height:1194,frame:{isUpload:true,isUserSelect:false},selectionSource:'upload'},coverUrl:'https://media.example/?signature=private-signature',templateBlob:new Blob(['editor archive A'],{type:'application/zip'})}}}});tx.oncomplete=()=>{db.close();resolve();};};}));
  const audit=()=>page.evaluate(auditXhsStoredVideoDrafts,{title:'标题',description:'简介',expectedUserId:'private-owner'}),local=await audit(),record=local.records[0];
  const cp={platform:'xhs',scope:'browser-local',stage:'save-click-started',createdAt:1000,updatedAt:2000,baseline:{empty:true},sourceMedia:{size:99,width:1920,height:1080,duration:29.7},files:{video:{sha256:'a'.repeat(64)},cover:{sha256:'b'.repeat(64)}},uploadSelectionSha:'a'.repeat(64),sourceCoverSha:'b'.repeat(64),coverIdentity:'sha256:'+'c'.repeat(64),videoIdentity:record.media.fileIdHash,targetDraft:{keyHash:record.keyHash,media:record.media}};
  const bound=bindXhsLocalDraft(cp,local,{requireContent:true});
  assert.equal(bound.cover.kind,'cover-editor');assert.notEqual(bound.cover.fileIdHash,record.cover.fileIdHash);assert.equal(bound.cover.fileIdHash,record.editorCover.fileIdHash);assert.match(bound.cover.archiveHash,/^sha256:[a-f0-9]{64}$/);assert.equal(bound.materialHash,record.editorMaterialHash);
  const reconciled=reconcileXhsSavedDraft(cp,local);assert.equal(reconciled.targetDraft.cover.fileIdHash,record.editorCover.fileIdHash);
  for(const change of [{sourceCoverSha:'d'.repeat(64)},{coverIdentity:null},{uploadSelectionSha:null}])assert.throws(()=>bindXhsLocalDraft({...cp,...change},local,{requireContent:true}));
  for(const change of [{editorArchive:null},{editorCover:{...record.editorCover,isUpload:false}},{editorCover:{...record.editorCover,selectionSource:'video'}},{editorCover:{...record.editorCover,fileIdHash:null}}])assert.throws(()=>bindXhsLocalDraft(cp,{...local,records:[{...record,...change}]},{requireContent:true}));
  await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('draft-database-v1',10);r.onsuccess=()=>{const db=r.result,tx=db.transaction('video-draft','readwrite'),store=tx.objectStore('video-draft'),q=store.get('fixture');q.onsuccess=()=>{q.result.content.contextStore.coverContext.templateBlob=new Blob(['editor archive B'],{type:'application/zip'});store.put(q.result);};tx.oncomplete=()=>{db.close();resolve();};};}));
  const changed=await audit();assert.notEqual(changed.records[0].editorMaterialHash,record.editorMaterialHash);assert.throws(()=>bindXhsLocalDraft(reconciled,changed,{requireContent:true}));
  const text=JSON.stringify(local);for(const secret of ['private-owner','private-signature','https://media.example','uploaded-cover','editor archive A'])assert.equal(text.includes(secret),false);
});

test('a previously pinned legacy cover keeps its exact original material contract',()=>{
  const media={fileIdHash:'sha256:'+'1'.repeat(64),videoIdHash:'sha256:'+'2'.repeat(64),size:99,width:1920,height:1080,duration:29.7};
  const cover={fileIdHash:'sha256:'+'3'.repeat(64),isUpload:true,isUserSelect:true},materialHash='sha256:'+'4'.repeat(64);
  const record={keyHash:'sha256:'+'5'.repeat(64),ownerMatched:true,media,cover,materialHash,titlePaths:['content.draftStore.title'],descriptionPaths:['content.draftStore.desc'],editorCover:{fileIdHash:'sha256:'+'6'.repeat(64),isUpload:true}};
  const cp={sourceMedia:media,targetDraft:{keyHash:record.keyHash,media,cover,materialHash}};
  const bound=bindXhsLocalDraft(cp,{scope:'browser-local',count:1,records:[record]},{requireContent:true});assert.equal(bound.materialHash,materialHash);assert.deepEqual(bound.cover,cover);
  assert.throws(()=>bindXhsLocalDraft(cp,{scope:'browser-local',count:1,records:[{...record,materialHash:'changed'}]},{requireContent:true}));
});
