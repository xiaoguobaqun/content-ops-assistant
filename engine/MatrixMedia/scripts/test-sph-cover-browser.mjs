import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

test('current personal-home card dialog uploads the requested cover and reads the changed slot',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=','base64'));
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent('<wujie-app class="wujie_iframe"></wujie-app>');
    await page.evaluate(()=>{document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML=`<img class="cover-img-vertical" width="100" height="120" src="https://wx.qpic.cn/original"><button class="vertical-cover-wrap" onclick="this.getRootNode().querySelector('.weui-desktop-dialog').hidden=false">编辑</button><div class="weui-desktop-dialog" hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><div class="single-cover-uploader-wrap"><input type="file" accept="image/*" onchange="window.selectedFile=this.files[0].name"></div><button onclick="window.confirmed=(window.confirmed||0)+1;this.getRootNode().querySelector('.cover-img-vertical').src='https://wx.qpic.cn/custom-cover';this.closest('.weui-desktop-dialog').hidden=true">确认</button></div>`;});
    await uploadSphCustomCover(page,file);
    assert.equal(await page.evaluate(()=>window.selectedFile),'cover.png');assert.equal(await page.evaluate(()=>window.confirmed),1);assert.equal(await page.evaluate(()=>document.querySelector('wujie-app').shadowRoot.querySelector('.cover-img-vertical').src),'https://wx.qpic.cn/custom-cover');
  }finally{await browser.close();}
});
test('a changed cover preview with an unclosed modal is not accepted as saved',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-open-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent('<wujie-app class="wujie_iframe"></wujie-app>');
    await page.evaluate(()=>{document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML=`<img class="cover-img-vertical" width="100" height="120" src="https://wx.qpic.cn/original"><button class="vertical-cover-wrap" onclick="this.getRootNode().querySelector('.weui-desktop-dialog').hidden=false">编辑</button><div class="weui-desktop-dialog" hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><div class="single-cover-uploader-wrap"><input type="file" accept="image/*"></div><button onclick="this.getRootNode().querySelector('.cover-img-vertical').src='https://wx.qpic.cn/preview'">确认</button></div>`;});
    await assert.rejects(uploadSphCustomCover(page,file),/弹窗尚未确认保存/);
  }finally{await browser.close();}
});
test('redesigned card editor may be portaled outside the uploader shadow and has no legacy dialog class',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-portal-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent('<wujie-app class="wujie_iframe"></wujie-app><section id="new-card" hidden><header><h2>编辑个人主页卡片</h2><p>将会用在视频号个人主页</p></header><button>上传封面</button><input type="file" accept="image/*" onchange="window.coverFile=this.files[0].name"><button onclick="document.querySelector(\'wujie-app\').shadowRoot.querySelector(\'.cover-img-vertical\').src=\'https://wx.qpic.cn/portal-cover\';this.closest(\'section\').hidden=true">确认</button></section>');
    await page.evaluate(()=>document.querySelector('wujie-app').attachShadow({mode:'open'}).innerHTML='<img class="cover-img-vertical" width="100" height="120" src="https://wx.qpic.cn/original"><button class="vertical-cover-wrap" onclick="document.querySelector(\'#new-card\').hidden=false">编辑</button>');
    await uploadSphCustomCover(page,file);assert.equal(await page.evaluate(()=>window.coverFile),'cover.png');assert.equal(await page.evaluate(()=>document.querySelector('wujie-app').shadowRoot.querySelector('.cover-img-vertical').src),'https://wx.qpic.cn/portal-cover');
  }finally{await browser.close();}
});

test('live nested cover entry and current vertical image classes select one card',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-live-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent(`<div class="cover-preview-wrap"><div class="vertical-cover-wrap img-popover-wrap" onclick="document.querySelector('section').hidden=false"><div class="vertical-img-wrap"><img class="vertical-img-size cover-img-horizontal-center" width="100" height="120" src="https://finder.video.qq.com/251/20304/stodownload?asset=old"></div></div></div><section hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><input type="file" accept="image/*" onchange="window.coverFile=this.files[0].name"><button onclick="document.querySelector('img').src='https://finder.video.qq.com/251/20304/stodownload?asset=new';this.closest('section').hidden=true">确认</button></section>`);
    await uploadSphCustomCover(page,file);assert.equal(await page.evaluate(()=>window.coverFile),'cover.png');assert.equal(await page.evaluate(()=>document.querySelector('section').hidden),true);
  }finally{await browser.close();}
});

test('card image may appear after the upload completion label and must be awaited',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-late-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent('<wujie-app></wujie-app>');await page.evaluate(()=>{const root=document.querySelector('wujie-app').attachShadow({mode:'open'});setTimeout(()=>root.innerHTML=`<div class="cover-preview-wrap"><button class="vertical-cover-wrap" onclick="this.getRootNode().querySelector('section').hidden=false"><img class="vertical-img-size cover-img-horizontal-center" width="100" height="120" src="https://wx.qpic.cn/old"></button></div><section hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><input type="file" accept="image/*"><button onclick="this.getRootNode().querySelector('img').src='https://wx.qpic.cn/new';this.closest('section').hidden=true">确认</button></section>`,400);});
    await uploadSphCustomCover(page,file);assert.equal(await page.evaluate(()=>document.querySelector('wujie-app').shadowRoot.querySelector('section').hidden),true);
  }finally{await browser.close();}
});

test('decorative images in the same card are not counted as the selected cover',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-icons-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:''}));await page.goto('https://channels.weixin.qq.com/fixture');await page.setContent(`<div class="cover-preview-wrap"><div class="vertical-cover-wrap" onclick="document.querySelector('section').hidden=false"><img width="10" height="10" src="https://wx.qpic.cn/icon-one"><div class="vertical-img-wrap"><img class="vertical-img-size cover-img-horizontal-center" width="100" height="120" src="https://wx.qpic.cn/old"></div><img width="10" height="10" src="https://wx.qpic.cn/icon-two"></div></div><section hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><input type="file" accept="image/*"><button onclick="document.querySelector('.vertical-img-size').src='https://wx.qpic.cn/new';this.closest('section').hidden=true">确认</button></section>`);
    await uploadSphCustomCover(page,file);assert.equal(await page.evaluate(()=>document.querySelector('.vertical-img-size').src),'https://wx.qpic.cn/new');
  }finally{await browser.close();}
});

test('closing a cover modal after only an access-token change does not prove a custom cover was applied',async t=>{
  const {uploadSphCustomCover}=await import('../src/main/services/upLoad/sphCover.js');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sph-cover-token-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const file=path.join(directory,'cover.png');await fs.writeFile(file,'fixture');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<button class="vertical-cover-wrap" onclick="document.querySelector('section').hidden=false"><img class="vertical-img-size" width="100" height="120" src="https://finder.video.qq.com/251/20304/stodownload?encfilekey=old&amp;token=one"></button><section hidden><h2>编辑个人主页卡片</h2><button>上传封面</button><input type="file" accept="image/*"><button onclick="document.querySelector('img').src='https://finder.video.qq.com/251/20304/stodownload?encfilekey=old&token=two';this.closest('section').hidden=true">确认</button></section>`:''}));await page.goto('https://channels.weixin.qq.com/fixture');
    await assert.rejects(uploadSphCustomCover(page,file),/未确认保存/);
  }finally{await browser.close();}
});
