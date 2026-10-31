import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

test('draft inspection selects only the unique visible draft entry and never an adjacent publish action',async()=>{
  const mod=await import('../src/main/services/upLoad/xhsDraftPage.js');assert.equal(typeof mod.openXhsDraftBox,'function','draft-box reader is not implemented');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<div style="display:none">草稿箱(9)</div><div onclick="window.opened=(window.opened||0)+1">草稿箱(0)</div><button onclick="window.published=true">发布</button>');await mod.openXhsDraftBox(page);assert.equal(await page.evaluate(()=>window.opened),1);assert.equal(await page.evaluate(()=>window.published),undefined);
    await page.setContent('<div>草稿箱(0)</div><div>草稿箱(1)</div>');await assert.rejects(mod.openXhsDraftBox(page),/唯一/);
  }finally{await browser.close();}
});

test('draft audit exposes storage schemas and counts without exporting stored records or credentials',async()=>{
  const mod=await import('../src/main/services/upLoad/xhsDraftPage.js');assert.equal(typeof mod.inspectXhsDraftStorage,'function','storage audit is not implemented');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:'<p>storage fixture</p>'}));await page.goto('https://creator.xiaohongshu.com/publish/publish');
    await page.evaluate(async()=>{localStorage.setItem('token','credential-secret');localStorage.setItem('draft-list',JSON.stringify([{content:'private-content',video:'signed-url-secret'}]));await new Promise((resolve,reject)=>{const req=indexedDB.open('drafts_user_123456789',1);req.onupgradeneeded=()=>req.result.createObjectStore('drafts',{keyPath:'id'});req.onsuccess=()=>{const db=req.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({id:'private-id',token:'credential-secret',content:'private-content'});tx.oncomplete=()=>{db.close();resolve();};};req.onerror=()=>reject(req.error);});});
    const result=await page.evaluate(mod.inspectXhsDraftStorage);const output=JSON.stringify(result);for(const secret of ['credential-secret','private-content','private-id','signed-url-secret','123456789'])assert.equal(output.includes(secret),false,secret);assert.ok(result.databases.some(db=>db.stores.some(s=>s.count===1)));assert.deepEqual(result.localDrafts.map(x=>x.count),[1]);
  }finally{await browser.close();}
});

test('xhs readonly draft CLI accepts a draft-box audit and requires absolute evidence paths',async()=>{
  const {parseXhsDraftArgs}=await import('../src/main/cli/parseXhsDraftArgs.js');const parsed=parseXhsDraftArgs(['--phone','测试','--inspect-drafts','--screenshot','/tmp/drafts.png']);assert.equal(parsed.ok,true);assert.equal(parsed.value.inspectDrafts,true);
  for(const args of [['--phone','测试','--inspect','--screenshot','relative.png'],['--phone','测试','--expected-file','relative.json']])assert.equal(parseXhsDraftArgs(args).ok,false);
});

test('empty xhs draft baseline needs the opened local-draft list and all four empty draft stores',async()=>{
  const mod=await import('../src/main/services/upLoad/xhsDraftPage.js');assert.equal(typeof mod.readXhsDraftBaseline,'function','complete baseline reader is missing');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:'<div onclick="document.querySelector(\'#drawer\').hidden=false">草稿箱(0)</div><div hidden id="drawer">视频笔记(0) 图文笔记(0) 长文笔记(0) 播客笔记(0) 草稿存储于当前使用的浏览器本地 暂无草稿</div>'}));await page.goto('https://creator.xiaohongshu.com/publish/publish');
    assert.notEqual((await mod.readXhsDraftBaseline(page)).empty,true,'default count without a database cannot prove empty');
    await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('draft-database-v1',10);r.onupgradeneeded=()=>{for(const store of ['article-draft','audio-draft','image-draft','video-draft'])r.result.createObjectStore(store,{keyPath:'draftId'});};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);}));
    assert.equal((await mod.readXhsDraftBaseline(page)).empty,true);
    await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('draft-database-v1',10);r.onsuccess=()=>{const db=r.result,tx=db.transaction('image-draft','readwrite');tx.objectStore('image-draft').put({draftId:'existing'});tx.oncomplete=()=>{db.close();resolve();};};}));assert.equal((await mod.readXhsDraftBaseline(page)).empty,false,'even a different draft type must block the initial test upload');
  }finally{await browser.close();}
});

test('xhs text is read back exactly and custom cover requires changed displayed image plus the chosen file hash',async t=>{
  const m=await import('../src/main/services/upLoad/xhsEditor.js').catch(()=>({}));assert.equal(typeof m.fillXhsDraftText,'function','editor adapter is missing');const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-cover-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const p=await browser.newPage();await p.setRequestInterception(true);p.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:'<body></body>'}));await p.goto('https://creator.xiaohongshu.com/publish/publish');
    await p.setContent('<div style="background:blue;width:30px;height:30px"></div>');const cover=path.join(dir,'cover.png');await fs.writeFile(cover,await p.screenshot());
    await p.setContent(`<section><h2>设置封面</h2><p>默认截取第一帧作为封面</p><div id="cover" style="width:200px;height:150px;background-image:url(data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2220%22%20height=%2220%22%3E%3Crect%20width=%2220%22%20height=%2220%22%20fill=%22red%22/%3E%3C/svg%3E)" onclick="document.querySelector('#modal').hidden=false"></div><span>智能推荐封面</span></section><input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p><br></p></div><div hidden id="modal"><input id="file" type="file" accept="image/png"><button onclick="document.querySelector('#modal').hidden=true">确定</button></div><button onclick="window.published=true">发布</button><script>document.querySelector('#file').onchange=e=>{const r=new FileReader();r.onload=()=>document.querySelector('#cover').style.backgroundImage='url('+r.result+')';r.readAsDataURL(e.target.files[0]);};</script>`);
    await m.fillXhsDraftText(p,{title:'恰好二十字以内标题',description:'第一行\n第二行'});assert.deepEqual(await p.evaluate(m.readXhsText),{title:'恰好二十字以内标题',description:'第一行\n第二行'});
    const evidence=await m.uploadXhsCustomCover(p,cover);assert.match(evidence.coverIdentity,/^sha256:/);assert.equal(evidence.sourceCoverSha,(await import('node:crypto')).createHash('sha256').update(await fs.readFile(cover)).digest('hex'));assert.equal(await p.evaluate(()=>window.published),undefined);
  }finally{await browser.close();}
});

test('video selection records the actual file digest even when the platform clears its file input',async t=>{
  const m=await import('../src/main/services/upLoad/xhsEditor.js');assert.equal(typeof m.selectXhsVideo,'function','actual video selection proof is missing');const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-select-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'v.mov');await fs.writeFile(file,'video bytes');const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const p=await b.newPage();await p.setRequestInterception(true);p.on('request',r=>r.respond({status:200,contentType:'text/html',body:'<input type="file" class="upload-input" accept=".mov,.mp4" onchange="this.value=\'\'">'}));await p.goto('https://creator.xiaohongshu.com/publish/publish');assert.equal(await m.selectXhsVideo(p,file),'96b050b919f3fca2fc8b6923537136a197ad13c583beb1438d1a12ccbc999c42');assert.equal(await p.$eval('input',e=>e.files.length),0);
  }finally{await b.close();}
});
