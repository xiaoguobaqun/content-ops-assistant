import { app, BrowserWindow } from 'electron';
import pie from 'puppeteer-in-electron';
import puppeteer from 'puppeteer-core';
import { buildAccountPartition } from '../../shared/accountPartition.js';
import { verifyAndPreserveDyDraft } from './upLoad/dyDraft.js';

export async function queryDouyinDraft({phone,expected,screenshot}) {
  const browser=await pie.connect(app,puppeteer);
  const win=new BrowserWindow({show:false,width:1300,height:900,webPreferences:{partition:buildAccountPartition(phone,'抖音'),backgroundThrottling:false,nodeIntegration:false,contextIsolation:true}});
  let page;
  try {
    page=await pie.getPage(browser,win);
    const evidence=await verifyAndPreserveDyDraft(page,expected,{capture:screenshot?()=>page.screenshot({path:screenshot,fullPage:true}):undefined});
    return {ok:true,evidence,screenshot};
  } catch(e) {
    if(screenshot&&page)await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
    const diagnostic=page ? await page.evaluate(()=>({
      title:document.querySelector('.semi-input')?.value,
      description:document.querySelector('.zone-container.editor-kit-container')?.innerText,
      coverSrcs:Array.from(document.querySelectorAll("[class*='cover'] img,[class*='Cover'] img")).map(i=>i.src.replace(/[?#].*$/,'')),
      selectedLabels:Array.from(document.querySelectorAll('label')).filter(l=>l.querySelector('input:checked')).map(l=>l.textContent),
      videoCount:document.querySelectorAll('video').length,
      previewLabels:Array.from(document.querySelectorAll('button,span')).filter(e=>/预览|重新上传/.test(e.textContent||'')).map(e=>(e.textContent||'').slice(0,40)).slice(0,10),
    })).catch(()=>null):null;
    return {ok:false,evidence:e.evidence||null,message:e.message,diagnostic,screenshot};
  } finally {if(!win.isDestroyed())win.destroy();}
}
