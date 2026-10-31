import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

function respondSphFixture(request,options){
  if(new URL(request.url()).pathname==='/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft')return new Promise(resolve=>setTimeout(()=>resolve(request.respond({status:201,contentType:'application/json',body:JSON.stringify({errCode:0,data:{objectId:'12345678901234567890',baseResp:{}}})})),250));
  return request.respond(options);
}

test('draft baseline distinguishes an empty draft view from loading and existing content',async()=>{
  const {readSphDraftPage}=await import('../src/main/services/upLoad/sphDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();
    for(const [html,empty]of [['<button aria-selected="true">草稿箱</button><p>暂无草稿</p>',true],['<button aria-selected="true">草稿箱</button><div class="ant-spin-spinning">加载中</div><p>暂无草稿</p>',null],['<button aria-selected="true">草稿箱</button><div class="draft-item">旧内容<button>编辑</button></div>',false],['<p>暂无内容</p>',null]]){
      await page.setContent(`<wujie-app></wujie-app>`);await page.evaluate(value=>document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML=value,html);
      assert.equal((await page.evaluate(readSphDraftPage)).empty,empty);
    }
  }finally{await browser.close();}
});
test('hidden empty-state text cannot prove that the draft slot is empty',async()=>{
  const {readSphDraftPage}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<p hidden>暂无草稿</p><p>正在读取页面</p>');assert.equal((await page.evaluate(readSphDraftPage)).empty,null);}finally{await browser.close();}
});
test('real folded draft menu is discoverable but never itself proves that drafts are empty',async()=>{
  const {readSphDraftPage}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<ul hidden><li class="finder-ui-desktop-sub-menu__item"><span>草稿箱</span></li></ul><p>视频管理</p>');const info=await page.evaluate(readSphDraftPage);assert.equal(info.draftMenu,true);assert.equal(info.empty,null);}finally{await browser.close();}
});
test('WeChat disabled class and modal overlays block saving even without a disabled attribute',async()=>{
  const {clickSphDraftSave}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();
    for(const html of ['<button class="weui-desktop-btn_disabled" onclick="window.saved=true">保存草稿</button>','<button onclick="window.saved=true">保存草稿</button><div role="dialog">未处理弹窗</div>']){await page.setContent(html);await assert.rejects(clickSphDraftSave(page),/草稿|按钮/);assert.equal(await page.evaluate(()=>window.saved),undefined);}
  }finally{await browser.close();}
});
test('real draft manager zero count proves empty only on its own loaded route',async()=>{
  const {readSphDraftPage}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();let count=0,loading=false;await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:`<h1>草稿箱</h1><button>草稿箱 (${count})</button>${loading?'<div class="ant-spin-spinning">加载中</div>':''}`}));
    await page.goto('https://channels.weixin.qq.com/platform/post/draftListManager');assert.equal((await page.evaluate(readSphDraftPage)).empty,true);
    count=1;await page.reload();assert.equal((await page.evaluate(readSphDraftPage)).empty,false);
    count=0;loading=true;await page.reload();assert.equal((await page.evaluate(readSphDraftPage)).empty,null);
    loading=false;await page.goto('https://channels.weixin.qq.com/platform/post/list');assert.equal((await page.evaluate(readSphDraftPage)).empty,null);
  }finally{await browser.close();}
});
test('native shadow input discovery works without deep selectors and never waits indefinitely',async()=>{
  const {waitSphElement}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<wujie-app></wujie-app>');await page.evaluate(()=>document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML='<input type="file" accept="video/*">');
    const input=await waitSphElement(page,'input[type=file]',{timeoutMs:500});assert.equal(await input.evaluate(e=>e.accept),'video/*');await input.dispose();await assert.rejects(waitSphElement(page,'.missing',{timeoutMs:100}),/未找到/);
  }finally{await browser.close();}
});
test('preservation waits for delayed save completion before any list navigation',async()=>{
  const {recoverAndPreserveSphDraft}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);
    const list=`<button aria-selected="true">草稿箱</button><div class="draft-item">标题<img src="https://wx.qpic.cn/fixture/cover"><button onclick="localStorage.removeItem('saved');location.href='/platform/post/create'">编辑</button></div>`;
    const editor=`<div class="post-desc-box"><div class="input-editor">标题</div></div><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><button onclick="fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'}).then(r=>r.json()).then(()=>{localStorage.saved='1'})">保存草稿</button>`;
    page.on('request',r=>respondSphFixture(r,{status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<wujie-app class="wujie_iframe"></wujie-app><script>document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(r.url().includes('/create')?editor:list)};</script>`:''}));
    const expected={clientTaskId:'task',title:'标题',description:'标题',shortTitle:'',mediaId:'sha256:37ff337cb812ee875e3b2be9d03641f789dcae8e8ea1689eae379bc5609c47f5',coverSrc:'sha256:f9bfcc9b3df64926bc2946d34116a40ce81615777c0b6085d63e765f244cd473',baseline:{empty:true}};
    await recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500});assert.equal(await page.evaluate(()=>localStorage.saved),'1');
  }finally{await browser.close();}
});
test('default zero count without a spinner waits for the actual draft-list response',async()=>{
  const {readSphDraftBaseline}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();let mode='existing';await page.setRequestInterception(true);
    page.on('request',async r=>{if(r.url().includes('/get_draft_list')){await new Promise(resolve=>setTimeout(resolve,200));await r.respond({status:mode==='failed'?500:201,contentType:'application/json',body:JSON.stringify(mode==='failed'?{errCode:1}:{errCode:0,data:{totalCount:mode==='existing'?1:0,list:mode==='existing'?[{id:'old'}]:[]}})});return;}
      const manager=r.url().includes('draftListManager');await r.respond({status:200,contentType:'text/html; charset=utf-8',body:manager?`<button>草稿箱 (0)</button><script>fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/get_draft_list',{method:'POST'})</script>`:`<li class="finder-ui-desktop-sub-menu__item" onclick="location.href='/platform/post/draftListManager'">草稿箱</li>`});});
    assert.equal((await readSphDraftBaseline(page,{timeoutMs:1000})).empty,false);
    mode='failed';assert.equal((await readSphDraftBaseline(page,{timeoutMs:600})).empty,null);
    mode='empty';const empty=await readSphDraftBaseline(page,{timeoutMs:1000});assert.equal(empty.empty,true);assert.equal(empty.witness.complete,true);
  }finally{await browser.close();}
});
test('failure diagnostics describe visible cover controls without reading credential values',async()=>{
  const {inspectSphFailurePage}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<input type="password" value="credential-fixture-secret"><h2>编辑个人主页卡片</h2><button>确认</button><input type="file" accept="image/*">');
    const data=await page.evaluate(inspectSphFailurePage);assert.ok(data.labels.some(e=>e.text==='编辑个人主页卡片'));assert.equal(JSON.stringify(data).includes('credential-fixture-secret'),false);assert.equal(data.fileInputs[0].accept,'image/*');
  }finally{await browser.close();}
});
test('editor evidence needs exact text, video, custom cover, and no implicit original declaration',async()=>{
  const {inspectSphEditor}=await import('../src/main/services/upLoad/sphDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:r.isNavigationRequest()?'<wujie-app></wujie-app>':''}));await page.goto('https://channels.weixin.qq.com/fixture');
    await page.evaluate(()=>{const root=document.querySelector('wujie-app').attachShadow({mode:'open'});root.innerHTML='<div class="post-desc-box"><div class="input-editor">标题\n简介</div></div><input placeholder="填写短标题有机会获得更多流量" value="短标题"><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><div class="declare-original-checkbox"><input type="checkbox"></div>';});
    const expected={description:'标题\n简介',shortTitle:'短标题'};const good=await page.evaluate(inspectSphEditor,expected);assert.equal(good.ok,true);assert.ok(good.mediaId);assert.ok(good.coverSrc);
    assert.equal((await page.evaluate(inspectSphEditor,{...expected,description:'同名旧稿'})).ok,false);
    await page.evaluate(()=>document.querySelector('wujie-app').shadowRoot.querySelector('input[type=checkbox]').checked=true);
    assert.equal((await page.evaluate(inspectSphEditor,expected)).ok,false);
  }finally{await browser.close();}
});
test('saving uses a unique semantic enabled draft button and clicks exactly once',async()=>{
  const {clickSphDraftSave}=await import('../src/main/services/upLoad/sphDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<button onclick="window.published=true">发表</button>');
    await assert.rejects(clickSphDraftSave(page),/草稿|按钮/);assert.equal(await page.evaluate(()=>window.published),undefined);
    await page.setContent('<button disabled>保存草稿</button>');await assert.rejects(clickSphDraftSave(page),/草稿|按钮/);
    await page.setContent('<button onclick="window.saved=(window.saved||0)+1">保存草稿</button><button onclick="window.published=true">发表</button>');await clickSphDraftSave(page);
    assert.equal(await page.evaluate(()=>window.saved),1);assert.equal(await page.evaluate(()=>window.published),undefined);
  }finally{await browser.close();}
});
test('recovering a unique draft never uploads and preserves its contents even if capture fails',async()=>{
  const {recoverAndPreserveSphDraft}=await import('../src/main/services/upLoad/sphDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);
    const list=`<button aria-selected="true">草稿箱</button><div class="draft-item">标题<img src="https://wx.qpic.cn/fixture/cover"><button onclick="localStorage.removeItem('saved');location.href='/platform/post/create'">编辑</button></div>`;
    const editor=`<div class="post-desc-box"><div class="input-editor">标题 简介</div></div><input placeholder="填写短标题有机会获得更多流量" value=""><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><input type="file" onchange="localStorage.uploaded='1'"><button onclick="fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'}).then(r=>r.json()).then(()=>{localStorage.saved='1'})">保存草稿</button><button onclick="localStorage.published='1'">发表</button>`;
    page.on('request',r=>respondSphFixture(r,{status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<wujie-app class="wujie_iframe"></wujie-app><script>document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(r.url().includes('/create')?editor:list)};</script>`:''}));
    const expected={clientTaskId:'task',title:'标题',description:'标题 简介',shortTitle:'',mediaId:'sha256:37ff337cb812ee875e3b2be9d03641f789dcae8e8ea1689eae379bc5609c47f5',coverSrc:'sha256:f9bfcc9b3df64926bc2946d34116a40ce81615777c0b6085d63e765f244cd473',baseline:{empty:true}};
    assert.equal((await recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500})).preserved,true);
    await assert.rejects(recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500,capture:async()=>{throw Error('capture unavailable');}}),e=>e.evidence.preserved===true);
    assert.equal(await page.evaluate(()=>localStorage.saved),'1');assert.equal(await page.evaluate(()=>localStorage.uploaded),undefined);assert.equal(await page.evaluate(()=>localStorage.published),undefined);
    await assert.rejects(recoverAndPreserveSphDraft(page,{...expected,description:'其他稿'},{timeoutMs:1500}),e=>e.evidence.ok===false&&e.evidence.preserved===true);
  }finally{await browser.close();}
});

test('shared download paths cannot make different cover assets match',async()=>{
  const {inspectSphEditor}=await import('../src/main/services/upLoad/sphDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:r.isNavigationRequest()?'<div class="input-editor">test</div><div class="vertical-cover-wrap"><img class="cover-img-vertical vertical-img-size cover-img-horizontal-center" src="https://finder.video.qq.com/251/20304/stodownload?asset=A"></div><video src="https://video.weixin.qq.com/file?asset=A"></video>':''}));
    await page.goto('https://channels.weixin.qq.com/fixture');const expected={description:'test',shortTitle:''};const before=await page.evaluate(inspectSphEditor,expected);assert.equal(before.ok,true);
    await page.evaluate(()=>document.querySelector('img').src='https://finder.video.qq.com/251/20304/stodownload?asset=B');
    const after=await page.evaluate(inspectSphEditor,{...expected,coverSrc:before.coverSrc,mediaId:before.mediaId});assert.equal(after.coverMatches,false);assert.equal(after.ok,false);assert.match(before.coverSrc,/^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(before).includes('?asset='),false);
  }finally{await browser.close();}
});

test('observed finder resource key survives signing and thumbnail transforms without merging distinct files',async()=>{
  const {inspectSphEditor}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html',body:r.isNavigationRequest()?'<div class="input-editor">test</div><img class="cover-img-vertical" src="https://finder.video.qq.com/251/20304/stodownload?encfilekey=file-A&amp;token=one&amp;picformat=jpg"><video src="https://video.weixin.qq.com/file"></video>':''}));await page.goto('https://channels.weixin.qq.com/fixture');
    const expected={description:'test',shortTitle:''},before=await page.evaluate(inspectSphEditor,expected);assert.equal(before.ok,true);
    await page.evaluate(()=>document.querySelector('img').src='https://finder.video.qq.com/251/20304/stodownload?token=two&picformat=webp&encfilekey=file-A');assert.equal((await page.evaluate(inspectSphEditor,{...expected,coverSrc:before.coverSrc})).ok,true);
    await page.evaluate(()=>document.querySelector('img').src='https://finder.video.qq.com/251/20304/stodownload?encfilekey=file-B&token=one');assert.equal((await page.evaluate(inspectSphEditor,{...expected,coverSrc:before.coverSrc})).coverMatches,false);
  }finally{await browser.close();}
});

test('live post-draft rows reveal a unique edit operation only on hover',async()=>{
  const {recoverAndPreserveSphDraft}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);
    const list=`<style>.opr{visibility:hidden}.post-draft-item:hover .opr{visibility:visible}</style><button>草稿箱 (1)</button><div class="post-draft-item"><img width="80" height="100" src="https://wx.qpic.cn/fixture/cover"><div class="post-title">标题</div><div class="opr"><div class="opr-item" onclick="location.href='/platform/post/create'"><span>编辑</span></div><div class="opr-item" onclick="localStorage.deleted='1'"><span>删除</span></div></div></div>`;
    const editor=`<div class="input-editor">标题</div><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><button onclick="fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'}).then(r=>r.json()).then(()=>{localStorage.saved='1'})">保存草稿</button>`;
    page.on('request',r=>respondSphFixture(r,{status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?(r.url().includes('/create')?editor:list):''}));
    const expected={clientTaskId:'task',title:'标题',description:'标题',shortTitle:'',mediaId:'sha256:37ff337cb812ee875e3b2be9d03641f789dcae8e8ea1689eae379bc5609c47f5',coverSrc:'sha256:f9bfcc9b3df64926bc2946d34116a40ce81615777c0b6085d63e765f244cd473',baseline:{empty:true}};
    assert.equal((await recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500})).preserved,true);assert.equal(await page.evaluate(()=>localStorage.saved),'1');assert.equal(await page.evaluate(()=>localStorage.deleted),undefined);
  }finally{await browser.close();}
});

test('trusted upload metadata can match the restored remote video but a known different remote asset cannot',async()=>{
  const {inspectSphEditor}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?'<div class="input-editor">test</div><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/restored.mp4"></video>':''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.evaluate(()=>Object.defineProperties(document.querySelector('video'),{videoWidth:{value:1920},videoHeight:{value:1080},duration:{value:29.698005}}));
    const expected={description:'test',shortTitle:'',mediaId:'1920x1080@29.70'};assert.equal((await page.evaluate(inspectSphEditor,expected)).ok,true);assert.equal((await page.evaluate(inspectSphEditor,{...expected,mediaId:'1080x1920@29.70'})).mediaMatches,false);assert.equal((await page.evaluate(inspectSphEditor,{...expected,mediaId:'sha256:different-remote-file'})).mediaMatches,false);
  }finally{await browser.close();}
});
test('successful post_draft response allows preservation without navigating the editor or clicking twice',async()=>{
  const {recoverAndPreserveSphDraft}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);const list=`<button>草稿箱 (1)</button><div class="draft-item">标题<img src="https://wx.qpic.cn/fixture/cover"><button onclick="location.href='/platform/post/create'">编辑</button></div>`;
    const editor=`<div class="input-editor">标题</div><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><button onclick="localStorage.clicks=String(Number(localStorage.clicks||0)+1);fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'}).then(()=>localStorage.saved='1')">保存草稿</button>`;
    page.on('request',r=>r.url().includes('/post/post_draft')?setTimeout(()=>r.respond({status:201,contentType:'application/json',body:JSON.stringify({errCode:0,data:{objectId:'12345678901234567890',baseResp:{}}})}),250):r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?(r.url().includes('/create')?editor:list):''}));
    const expected={clientTaskId:'task',title:'标题',description:'标题',shortTitle:'',mediaId:'sha256:37ff337cb812ee875e3b2be9d03641f789dcae8e8ea1689eae379bc5609c47f5',coverSrc:'sha256:f9bfcc9b3df64926bc2946d34116a40ce81615777c0b6085d63e765f244cd473',baseline:{empty:true}};
    assert.equal((await recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500})).preserved,true);assert.equal(await page.evaluate(()=>localStorage.clicks),'1');assert.equal(await page.evaluate(()=>localStorage.saved),'1');
  }finally{await browser.close();}
});

test('a stale successful save cannot hide the failure of the single current save',async()=>{
  const {saveSphDraftOnce}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>{if(r.url().includes('/post/post_draft')){const prior=r.url().includes('prior=1');setTimeout(()=>r.respond({status:201,contentType:'application/json',body:JSON.stringify({errCode:prior?0:1,data:{objectId:prior?'old-id':''}})}),prior?250:500);}else r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<button onclick="window.clicks=(window.clicks||0)+1;fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'})">保存草稿</button>`:''});});await page.goto('https://channels.weixin.qq.com/platform/post/create');
    const prior=page.waitForRequest(r=>r.url().includes('prior=1'));await page.evaluate(()=>{void fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft?prior=1',{method:'POST'});});await prior;
    await assert.rejects(saveSphDraftOnce(page,{timeoutMs:1500}),/没有确认/);assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(new URL(page.url()).pathname,'/platform/post/create');
  }finally{await browser.close();}
});

test('navigation without the current save response cannot prove preservation',async()=>{
  const {saveSphDraftOnce}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<button onclick="localStorage.clicks=String(Number(localStorage.clicks||0)+1);location.href='/platform/post/list'">保存草稿</button>`:''}));await page.goto('https://channels.weixin.qq.com/platform/post/create');
    await assert.rejects(saveSphDraftOnce(page,{timeoutMs:700}),/保存|响应/);assert.equal(await page.evaluate(()=>localStorage.clicks),'1');
  }finally{await browser.close();}
});
test('a platform route transition may abort one read-only draft navigation without authorizing an upload',async()=>{
  const {readSphDraftBaseline}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();let attempts=0;await page.setRequestInterception(true);page.on('request',r=>{if(r.isNavigationRequest()&&attempts++===0)return r.abort('aborted');if(r.url().includes('/post/get_draft_list'))return r.respond({status:201,contentType:'application/json',body:JSON.stringify({errCode:0,data:{list:[],totalCount:0}})});return r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<button>草稿箱 (0)</button><script>fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/get_draft_list')</script>`:''});});const result=await readSphDraftBaseline(page,{timeoutMs:1500});assert.equal(result.empty,true);assert.equal(result.witness.complete,true);assert.equal(attempts,2);
  }finally{await browser.close();}
});

test('preservation can be verified in a separate same-account page when the editor refuses unloading',async()=>{
  const {recoverAndPreserveSphDraft}=await import('../src/main/services/upLoad/sphDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const list=`<button>草稿箱 (1)</button><div class="draft-item">标题<img src="https://wx.qpic.cn/fixture/cover"><button onclick="location.href='/platform/post/create'">编辑</button></div>`;
    const editor=`<div class="input-editor">标题</div><img class="cover-img-vertical" src="https://wx.qpic.cn/fixture/cover"><video src="https://video.weixin.qq.com/fixture/video.mp4"></video><button onclick="onbeforeunload=()=>true;fetch('/micro/content/cgi-bin/mmfinderassistant-bin/post/post_draft',{method:'POST'}).then(r=>r.json()).then(()=>localStorage.saved='1')">保存草稿</button>`;
    const open=async()=>{const p=await browser.newPage();await p.setRequestInterception(true);p.on('dialog',d=>d.dismiss());p.on('request',r=>respondSphFixture(r,{status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?(r.url().includes('/create')?editor:list):''}));return p;};const page=await open();let separateReads=0;
    const expected={clientTaskId:'task',title:'标题',description:'标题',shortTitle:'',mediaId:'sha256:37ff337cb812ee875e3b2be9d03641f789dcae8e8ea1689eae379bc5609c47f5',coverSrc:'sha256:f9bfcc9b3df64926bc2946d34116a40ce81615777c0b6085d63e765f244cd473',baseline:{empty:true}};
    const result=await recoverAndPreserveSphDraft(page,expected,{timeoutMs:1500,withListPage:async read=>{separateReads++;const other=await open();try{return await read(other);}finally{await other.close();}}});assert.equal(result.preserved,true);assert.equal(separateReads,1);assert.equal(new URL(page.url()).pathname,'/platform/post/create');assert.equal(await page.evaluate(()=>localStorage.saved),'1');
  }finally{await browser.close();}
});
