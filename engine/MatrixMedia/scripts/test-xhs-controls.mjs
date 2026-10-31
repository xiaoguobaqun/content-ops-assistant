import test from 'node:test';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';

test('xhs closed-root save targets the actual enabled draft button once and never the adjacent publish button',async()=>{
  const m=await import('../src/main/services/upLoad/xhsControls.js').catch(()=>({}));assert.equal(typeof m.clickXhsSaveOnce,'function','safe closed-root control is missing');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const p=await browser.newPage();await p.setContent('<xhs-publish-btn save-text="暂存离开" save-disabled="false" is-save-draft="true"></xhs-publish-btn><script>const host=document.querySelector("xhs-publish-btn"),root=host.attachShadow({mode:"closed"});root.innerHTML=`<style>button{width:160px;height:55px;margin:20px}</style><button class="ce-btn white"><span>暂存离开</span></button><button><span>发布</span></button>`;root.querySelectorAll("button")[0].onclick=()=>window.saved=(window.saved||0)+1;root.querySelectorAll("button")[1].onclick=()=>window.published=true;</script>');
    const save=m.createXhsSaveAction(p);await save();await assert.rejects(save(),/再次|重复/);assert.equal(await p.evaluate(()=>window.saved),1);assert.equal(await p.evaluate(()=>window.published),undefined);
  }finally{await browser.close();}
});
test('xhs disabled, obscured, ambiguous, or renamed draft controls fail before any click',async()=>{
  const m=await import('../src/main/services/upLoad/xhsControls.js').catch(()=>({}));assert.equal(typeof m.createXhsSaveAction,'function');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const p=await browser.newPage();for(const kind of ['disabled','overlay','ambiguous','renamed']){await p.setContent(`<xhs-publish-btn save-text="暂存离开" save-disabled="false" is-save-draft="true"></xhs-publish-btn><script>const r=document.querySelector('xhs-publish-btn').attachShadow({mode:'closed'});r.innerHTML='<button style="width:160px;height:55px" ${kind==='disabled'?'disabled':''}>${kind==='renamed'?'发布':'暂存离开'}</button>${kind==='ambiguous'?'<button>暂存离开</button>':''}';for(const b of r.querySelectorAll('button'))b.onclick=()=>window.clicked=true;</script>${kind==='overlay'?'<div style="position:fixed;inset:0;z-index:999;background:#fff"></div>':''}`);await assert.rejects(m.createXhsSaveAction(p)());assert.equal(await p.evaluate(()=>window.clicked),undefined,kind);}
  }finally{await browser.close();}
});

test('an overlay appearing during pre-submit work blocks the click even when the original save button has not moved',async()=>{
  const {createXhsSaveAction}=await import('../src/main/services/upLoad/xhsControls.js');const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const p=await b.newPage();await p.setContent('<xhs-publish-btn save-text="暂存离开" save-disabled="false" is-save-draft="true"></xhs-publish-btn><script>const r=document.querySelector("xhs-publish-btn").attachShadow({mode:"closed"});r.innerHTML=`<button style="width:160px;height:55px">暂存离开</button>`;r.querySelector("button").onclick=()=>window.saved=true;</script>');
    const save=createXhsSaveAction(p,{beforeClick:()=>p.evaluate(()=>{const overlay=document.createElement('button');overlay.textContent='发布';overlay.style='position:fixed;inset:0;width:100vw;height:100vh;z-index:999';overlay.onclick=()=>window.overlayClicked=true;document.body.append(overlay);})});await assert.rejects(save(),/遮挡|命中/);assert.equal(await p.evaluate(()=>window.saved||window.overlayClicked),undefined);
  }finally{await b.close();}
});
