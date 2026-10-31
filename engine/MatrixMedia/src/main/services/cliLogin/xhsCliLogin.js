import fs from 'fs';
import {withLoginCancellation} from './loginCancellation.js';
import path from 'path';
import {app,nativeImage,session} from 'electron';
import {canonicalAccountPartition} from '../../../shared/accountPartition.js';
import {isXhsLoginQrPayload} from '../../../shared/xhsAuth.js';
import {withXhsPage,observeXhsAuth} from '../xhsSession.js';
import {inspectXhsPage,switchXhsLoginToQr} from '../upLoad/xhsDraftPage.js';
import {tryDecodeQrPayloadFromNativeImage,writeLoginQrPngFile,renderQrPayloadWithQrcodeTerminal} from './terminalQrQrcodeTerminal.js';
import ptConfig from '../../config/ptConfig.js';

async function captureQr(page,saveQrPngPath,terminalQr){
  if(new URL(page.url()).pathname!=='/login')return;
  const candidates=await page.$$('img,canvas');
  try{for(const element of candidates){
    const box=await element.boundingBox();if(!box||box.width<100||box.height<100||box.width/box.height<0.8||box.width/box.height>1.2)continue;
    const buf=await element.screenshot({type:'png'}),image=nativeImage.createFromBuffer(buf),payload=tryDecodeQrPayloadFromNativeImage(image);
    if(!isXhsLoginQrPayload(payload))continue;
    if(saveQrPngPath)writeLoginQrPngFile({image,saveQrPngPath});
    if(terminalQr&&process.stdout.isTTY)renderQrPayloadWithQrcodeTerminal(payload);
    return;
  }}finally{await Promise.all(candidates.map(h=>h.dispose()));}
}

export async function runXhsCliLogin({partition,timeoutMs=300000,saveQrPngPath=null,terminalQr=true}){
  const part=canonicalAccountPartition(partition,'小红书');
  const clearQr=()=>{if(saveQrPngPath)try{fs.rmSync(saveQrPngPath,{force:true});}catch{}};
  return withLoginCancellation((signal,onBeforeClose)=>withXhsPage(part,async(page,win)=>{
    const observer=await observeXhsAuth(page,part);let lastCapture=0,qrSwitched=false;
    try{
      await page.goto(ptConfig['小红书'].index,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>document.body&&document.body.innerText.trim().length>20,{timeout:15000}).catch(()=>{});
      qrSwitched=await switchXhsLoginToQr(page).catch(()=>false);
      console.log('请在“小红书账号验证”窗口完成本人扫码或验证；程序不会填写手机号、验证码或同意协议。');
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline&&!win.isDestroyed()&&!page.isClosed()){
        if(!qrSwitched)qrSwitched=await switchXhsLoginToQr(page).catch(()=>false);
        const probe=await observer.read();
        if(probe.ok&&probe.loggedIn===true){console.log('小红书本人信息鉴权通过，会话保留在原引擎分区。');return 0;}
        if(Date.now()-lastCapture>5000){
          lastCapture=Date.now();await captureQr(page,saveQrPngPath,terminalQr).catch(()=>{});
          if(saveQrPngPath){const diagnostic=await page.evaluate(inspectXhsPage).catch(()=>null);try{fs.writeFileSync(path.join(path.dirname(saveQrPngPath),'xhs-login-diagnostic.json'),JSON.stringify({page:diagnostic,responses:observer.diagnostic.slice(-30),probe}),{mode:0o600});}catch{}}
        }
        await page.waitForTimeout(700);
      }
      console.log('小红书本人登录或鉴权尚未完成，未登记为已连接。');return 3;
    }finally{
      clearQr();await observer.dispose();await session.fromPartition(part).cookies.flushStore().catch(()=>{});session.fromPartition(part).flushStorageData();
    }
  },{show:true,signal,onBeforeClose}),clearQr,{app}).catch(error=>{if(error?.code==='LOGIN_CANCELLED'){console.log('小红书本人登录已停止，扫码图已清理。');return 3;}throw error;});
}
