import test from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
const editor='<input placeholder="填写标题会有更多赞哦"><div style="margin-top:25px;width:500px;height:180px" class="tiptap ProseMirror" contenteditable="true"><p><br></p></div><button onclick="window.published=true">发布</button>';
async function fixture(t){const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});t.after(()=>browser.close());return browser.newPage();}
test('known PK-cover guide is dismissed before typing and cannot steal description input',async t=>{
 const page=await fixture(t),m=await import('../src/main/services/upLoad/xhsEditor.js');
 await page.setContent(editor+'<div id="guide" style="position:fixed;inset:0;z-index:99;background:#eee"><p>视频可以PK封面啦，快来试试吧</p><button class="pk-cover-guide-confirm" onclick="window.dismissed=true;document.querySelector(\'#guide\').remove()">我知道了</button></div>');
 await m.fillXhsDraftText(page,{title:'测试标题',description:'测试正文'});assert.deepEqual(await page.evaluate(m.readXhsText),{title:'测试标题',description:'测试正文'});assert.equal(await page.evaluate(()=>window.dismissed),true);assert.equal(await page.evaluate(()=>window.published),undefined);
});
test('an unknown obstruction stops before typing into any field',async t=>{
 const page=await fixture(t),m=await import('../src/main/services/upLoad/xhsEditor.js');await page.setContent(editor+'<div style="position:fixed;inset:0;z-index:99;background:#eee">未知遮挡</div>');
 await assert.rejects(m.fillXhsDraftText(page,{title:'测试标题',description:'正文'}),/遮挡/);assert.deepEqual(await page.evaluate(m.readXhsText),{title:'',description:''});
});
test('completion fills only missing fields and never overwrites conflicting existing text',async t=>{
 const page=await fixture(t),m=await import('../src/main/services/upLoad/xhsEditor.js');assert.equal(typeof m.fillMissingXhsDraftText,'function');
 await page.setContent(editor);await page.type('input','测试标题');await m.fillMissingXhsDraftText(page,{title:'测试标题',description:'正文第一行\n第二行'});assert.deepEqual(await page.evaluate(m.readXhsText),{title:'测试标题',description:'正文第一行\n第二行'});
 await assert.rejects(m.fillMissingXhsDraftText(page,{title:'不同标题',description:'另一段正文'}),/不匹配|不同/);assert.deepEqual(await page.evaluate(m.readXhsText),{title:'测试标题',description:'正文第一行\n第二行'});
});
