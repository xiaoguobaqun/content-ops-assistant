import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {openXhsStoredEditor} from '../src/main/services/upLoad/xhsRecovery.js';

async function fixture(t,extra=''){
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:1200,height:860});
  await page.setContent('<style>body{overflow:hidden}.drawer{position:fixed;left:600px;top:80px;width:600px;transform:translateX(600px);transition:transform .35s}.draft-actions{margin-left:456px}.btn{width:24px}span{display:block;width:24px;height:20px}</style><p>草稿箱(1) 视频笔记(1) 目标标题</p><section class="drawer"><div class="draft-actions"><div class="btn"><span id="edit" onclick="window.edited=(window.edited||0)+1;document.body.innerHTML=\'&lt;input placeholder=&quot;填写标题会有更多赞哦&quot;&gt;&lt;div class=&quot;video-plugin-title-action&quot;&gt;重新上传&lt;/div&gt;\'">编辑</span></div><span onclick="window.deleted=true">删除</span></div></section>'+extra);
  return page;
}

test('draft entry waits for the drawer transition before its single edit click',async t=>{
  const page=await fixture(t);
  // 实测抽屉刚打开时编辑文字x=1656，在1200宽视口外；展开后x=1056。
  assert.equal(await page.$eval('#edit',e=>e.getBoundingClientRect().x),1656);
  await page.evaluate(()=>setTimeout(()=>document.querySelector('.drawer').style.transform='translateX(0)',150));
  await openXhsStoredEditor(page,{title:'目标标题'});
  assert.equal(await page.evaluate(()=>window.edited),1);
  assert.equal(await page.evaluate(()=>window.deleted),undefined);
});

test('an obstructed draft entry stops without clicking edit or delete',async t=>{
  const page=await fixture(t,'<div style="position:fixed;inset:0;background:#eee;z-index:99">未知遮挡</div>');
  await page.$eval('.drawer',e=>{e.style.transition='none';e.style.transform='translateX(0)';});
  await assert.rejects(openXhsStoredEditor(page,{title:'目标标题'}),/遮挡/);
  assert.equal(await page.evaluate(()=>window.edited||window.deleted),undefined);
});

test('ordinary recovery keeps requiring the matching title before opening any editor',async t=>{
  const page=await fixture(t);
  await assert.rejects(openXhsStoredEditor(page,{title:'其他标题'}),/唯一目标不匹配/);
  assert.equal(await page.evaluate(()=>window.edited||window.deleted),undefined);
});
