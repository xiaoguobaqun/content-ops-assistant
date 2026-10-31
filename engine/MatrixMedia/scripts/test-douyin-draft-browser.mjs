import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

test('recovering a saved draft and preserving it keeps the next recovery available',async t=>{
  const {recoverDyDraft,preserveDyDraft,verifyAndPreserveDyDraft}=await import('../src/main/services/upLoad/dyDraft.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  let page,stage="start";
  try{
    page=await browser.newPage();await page.setRequestInterception(true);
    const home=`<button id="continue" hidden>继续编辑</button><script>if(!localStorage.seed){localStorage.seed='1';localStorage.saved='1'};const b=document.getElementById('continue');b.hidden=!localStorage.saved;b.onclick=()=>{localStorage.removeItem('saved');location.href='/creator-micro/content/post/video'}</script>`;
    const editor=`<input class="semi-input" value="标题"><div class="zone-container editor-kit-container">简介</div><div class="cover"><img src="https://example.test/cover.jpg?signature=fixture"></div><video src="https://douyin.com/fixture.mp4"></video><label><input type="radio" checked>仅自己可见</label><button id="popover-tip-container" onclick="window.published=true">发布</button><button onclick="localStorage.saved='1';location.href='/creator-micro/home'">暂存离开</button>`;
    page.on('request',request=>request.respond({status:200,contentType:'text/html; charset=utf-8',body:request.isNavigationRequest()?(request.url().endsWith('/home')?home:editor):''}));
    const expected={title:'标题',description:'简介',visibility:'private',coverSrcs:['https://example.test/cover.jpg'],requireCover:true,timeoutMs:1000};
    stage="recover"; assert.equal((await recoverDyDraft(page,expected)).ok,true);
    assert.equal(await page.evaluate(()=>localStorage.saved),undefined);
    stage="preserve"; await preserveDyDraft(page);
    assert.equal(await page.evaluate(()=>localStorage.saved),'1');
    stage="recover-again"; assert.equal((await recoverDyDraft(page,expected)).ok,true);
    assert.equal(await page.evaluate(()=>window.published===true),false);
    await preserveDyDraft(page);
    await assert.rejects(verifyAndPreserveDyDraft(page,{...expected,description:'另一份稿',timeoutMs:50}),error=>error.evidence.preserved===true);
    assert.equal(await page.evaluate(()=>localStorage.saved),'1');
    await assert.rejects(verifyAndPreserveDyDraft(page,expected,{capture:async()=>{throw Error('screenshot unavailable');}}),error=>error.evidence.preserved===true);
    assert.equal(await page.evaluate(()=>localStorage.saved),'1');
    assert.equal((await recoverDyDraft(page,expected)).descriptionMatches,true);
  }catch(e){t.diagnostic(JSON.stringify({stage,url:page?.url(),text:await page?.evaluate(()=>document.body?.innerText),storage:await page?.evaluate(()=>({...localStorage}))}));throw e;}finally{await browser.close();}
});
