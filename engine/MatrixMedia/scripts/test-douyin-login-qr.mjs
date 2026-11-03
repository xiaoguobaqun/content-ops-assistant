import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),build=require('esbuild').buildSync;
const payload='https://sso.douyin.com/scan_qr/?token=offline-synthetic-test';
// 模拟NativeImage编解码边界；二维码模块生成与jsQR解码使用真实实现。
function nativeImage(bytes,width,height){return {isEmpty:()=>!width||!height,getSize:()=>({width,height}),toBitmap:()=>bytes,toPNG:()=>Buffer.from(JSON.stringify({width,height,rgba:bytes.toString('base64')}))};}
const native={createFromBitmap:(bytes,{width,height})=>nativeImage(bytes,width,height),createFromBuffer:buffer=>{try{const data=JSON.parse(buffer.toString());return nativeImage(Buffer.from(data.rgba,'base64'),data.width,data.height);}catch{return nativeImage(Buffer.alloc(0),0,0);}}};
function loadModule(relative){
  const result=build({entryPoints:[fileURLToPath(new URL(relative,import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']});const module={exports:{}};
  vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='electron'?{nativeImage:native}:require(name),Buffer,URL,process:{platform:process.platform,pid:process.pid,stdout:{isTTY:false},env:{}},console,setTimeout,clearTimeout});return module.exports;
}
const qr=loadModule('../src/main/services/cliLogin/terminalQrQrcodeTerminal.js');
const capture=loadModule('../src/main/services/cliLogin/terminalQrFromCapture.js');
const invalid=nativeImage(Buffer.alloc(120*200*4,255),120,200);
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dy-qr-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'login.png');}
test('非二维码截图及不可解码原图均不得作为扫码图写入',t=>{
  const file=temporary(t);
  assert.equal(qr.writeLoginQrPngFile({image:invalid,saveQrPngPath:file}),false);assert.equal(fs.existsSync(file),false);
  assert.equal(qr.writeLoginQrPngFile({image:invalid,saveQrPngPath:file,fromDataUrl:true,rawBuf:invalid.toPNG()}),false);assert.equal(fs.existsSync(file),false);
});
test('可解码二维码被重绘成带白边的正方形，内容保持一致',t=>{
  const file=temporary(t),image=native.createFromBuffer(qr.renderQrPayloadToPngBuffer(payload));
  assert.equal(qr.writeLoginQrPngFile({image,saveQrPngPath:file}),true);
  const result=native.createFromBuffer(fs.readFileSync(file)),size=result.getSize();assert.equal(size.width,size.height);assert.equal(qr.tryDecodeQrPayloadFromNativeImage(result),payload);
});
test('错误裁剪时回退整页寻找真实二维码，输出仍只有干净二维码',async t=>{
  const file=temporary(t),full=qr.renderQrPayloadToPngBuffer(payload),calls=[];
  const page={isClosed:()=>false,evaluate:async script=>script.includes('var vw =')?{x:700,y:0,width:300,height:500}:null,screenshot:async options=>{calls.push(options);return options.clip?invalid.toPNG():full;}};
  assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(page,{saveQrPngPath:file,partitionLabel:'synthetic'}),true);
  assert.equal(qr.tryDecodeQrPayloadFromNativeImage(native.createFromBuffer(fs.readFileSync(file))),payload);assert.equal(calls.length,2);
});
test('没有二维码或已停止时不生成页面截图冒充扫码图',async t=>{
  const file=temporary(t),page={isClosed:()=>false,evaluate:async()=>null,screenshot:async()=>invalid.toPNG()};
  assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(page,{saveQrPngPath:file}),false);assert.equal(fs.existsSync(file),false);
  const stopped={isClosed:()=>false,evaluate:async()=>null,screenshot:async()=>qr.renderQrPayloadToPngBuffer(payload)};
  assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(stopped,{saveQrPngPath:file,isActive:()=>false}),false);assert.equal(fs.existsSync(file),false);
});
test('下载推广码及伪造抖音域名即使能解码也不得当成登录码',async t=>{
  const file=temporary(t);
  for(const value of ['https://example.com/download-app','https://www.douyin.com/download','https://sso.douyin.com.evil.test/scan_qr/','https://user:password@sso.douyin.com/scan_qr/']){
    const page={isClosed:()=>false,evaluate:async()=>null,screenshot:async()=>qr.renderQrPayloadToPngBuffer(value)};
    assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(page,{saveQrPngPath:file}),false);assert.equal(fs.existsSync(file),false);
  }
});
test('官方登录容器中的新版amemv跳转码可用，同类地址出现在页面其他位置时不冒充登录码',async t=>{
  const file=temporary(t),value='https://sso.amemv.com/native-route/v2/aweme/connect?token=offline-synthetic',png=qr.renderQrPayloadToPngBuffer(value);
  const inside={isClosed:()=>false,evaluate:async script=>script.includes('payloadFromDataUrl')?png.toString('base64'):null,screenshot:async()=>{throw Error('原始登录图可用时无需截图');}};
  assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(inside,{saveQrPngPath:file}),true);assert.equal(qr.tryDecodeQrPayloadFromNativeImage(native.createFromBuffer(fs.readFileSync(file))),value);
  fs.rmSync(file);const outside={isClosed:()=>false,evaluate:async()=>null,screenshot:async()=>png};assert.equal(await capture.paintLoginQrToTerminalFromPuppeteerPage(outside,{saveQrPngPath:file}),false);assert.equal(fs.existsSync(file),false);
});
test('二维码抓取立即开始、串行运行，停止后晚到结果不重启循环',async()=>{
  const {startLoginQrLoop}=await import('../src/main/services/cliLogin/loginQrLoop.js');let release,calls=0;const queue=[];
  const stop=startLoginQrLoop({capture:()=>{calls++;return new Promise(r=>release=r);},setTimer:(fn,delay)=>{const entry={fn,delay};queue.push(entry);return entry;},clearTimer:entry=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);}});
  assert.ok(queue[0].delay<=1000);const running=queue.shift().fn();assert.equal(calls,1);assert.equal(queue.length,0);stop();release(true);await running;assert.equal(queue.length,0);
});
test('DOM就绪即可抓二维码，不等待慢资源全部加载，关闭时移除监听',async()=>{
  const {loadLoginDocument}=await import('../src/main/services/cliLogin/loginQrLoop.js');const win=new EventEmitter();win.webContents=new EventEmitter();win.loadURL=()=>new Promise(()=>{});
  const ready=loadLoginDocument(win,'https://creator.douyin.com/');win.webContents.emit('dom-ready');await ready;assert.equal(win.webContents.listenerCount('dom-ready'),0);assert.equal(win.listenerCount('closed'),0);
});
test('登录组件下载失败时只重新加载一次，普通报错不触发恢复，重复失败及时结束',async()=>{
  const {createLoginPageRecovery}=await import('../src/main/services/cliLogin/loginQrLoop.js');
  assert.equal(typeof createLoginPageRecovery,'function');let reloads=0,failures=0;
  const recovery=createLoginPageRecovery({reload:async()=>{reloads++;},onFailure:()=>{failures++;}});
  recovery.onConsoleMessage('unrelated analytics error');await recovery.afterCapture(false);assert.equal(reloads,0);
  recovery.onConsoleMessage('ChunkLoadError: Loading chunk 744 failed.');recovery.onConsoleMessage('Uncaught ChunkLoadError: Loading chunk 744 failed.');
  await recovery.afterCapture(false);assert.equal(reloads,1);assert.equal(failures,0);
  recovery.onConsoleMessage('ChunkLoadError: Loading chunk 744 failed.');await recovery.afterCapture(false);await recovery.afterCapture(false);assert.equal(reloads,1);assert.equal(failures,1);
});
test('二维码已就绪或操作已停止时，组件报错也不会刷新页面打断扫码',async()=>{
  const {createLoginPageRecovery}=await import('../src/main/services/cliLogin/loginQrLoop.js');
  assert.equal(typeof createLoginPageRecovery,'function');let reloads=0,active=true;
  const recovery=createLoginPageRecovery({reload:async()=>{reloads++;},onFailure:()=>assert.fail('不应结束已扫码流程'),isActive:()=>active});
  assert.equal(await recovery.afterCapture(true),true);recovery.onConsoleMessage('ChunkLoadError');await recovery.afterCapture(false);assert.equal(reloads,0);
  const stopped=createLoginPageRecovery({reload:async()=>{reloads++;},onFailure:()=>assert.fail('不应影响停止后的操作'),isActive:()=>active});
  stopped.onConsoleMessage('ChunkLoadError');active=false;await stopped.afterCapture(false);assert.equal(reloads,0);
});
test('绕过失败资源缓存重新加载时等待新DOM，关闭后释放监听',async()=>{
  const {loadLoginDocument}=await import('../src/main/services/cliLogin/loginQrLoop.js');const win=new EventEmitter();win.webContents=new EventEmitter();let reloads=0,done=false;
  win.loadURL=()=>assert.fail('恢复应绕过缓存');win.webContents.reloadIgnoringCache=()=>{reloads++;};
  const ready=loadLoginDocument(win,null,{reload:true}).then(()=>{done=true;});await Promise.resolve();assert.equal(reloads,1);assert.equal(done,false);
  win.webContents.emit('dom-ready');await ready;assert.equal(win.webContents.listenerCount('dom-ready'),0);assert.equal(win.listenerCount('closed'),0);
});
test('无头模式的启动和页面加载共用同一等待预算，不在加载后额外等待',async()=>{
  let clock=0,launchOptions,gotoOptions;const timers=[];
  const page={setUserAgent:async()=>{},setViewport:async()=>{},goto:async(_url,options)=>{gotoOptions=options;clock=6000;}};
  const browser={pages:async()=>[page],close:async()=>{}};
  const driver={use(){},launch:async options=>{launchOptions=options;clock=2000;return browser;}};
  const result=build({entryPoints:[fileURLToPath(new URL('../src/main/services/cliLogin/douyinPuppeteerHeadlessLogin.js',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['electron','puppeteer-core','puppeteer-extra','puppeteer-extra-plugin-stealth']});const module={exports:{}};
  class ClockDate extends Date{static now(){return clock;}}
  const electron={nativeImage:native,session:{fromPartition:()=>({getStoragePath:()=>'/synthetic-profile',cookies:{get:async()=>[]}})}};
  vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='electron'?electron:name==='puppeteer-core'?driver:name==='puppeteer-extra'?{addExtra:()=>driver}:name==='puppeteer-extra-plugin-stealth'?()=>({}):name==='fs'?{...fs,existsSync:()=>true}:require(name),Buffer,URL,Date:ClockDate,process:{platform:process.platform,pid:process.pid,stdout:{isTTY:false},env:{PUPPETEER_EXECUTABLE_PATH:'synthetic-chrome'}},console:{log(){},warn(){},error(){}},setTimeout:(fn,ms)=>{const item={fn,ms};timers.push(item);if(ms>0)queueMicrotask(fn);return item;},clearTimeout(){},setInterval:()=>({}),clearInterval(){}});
  assert.equal(await module.exports.runDouyinPuppeteerHeadlessLogin({partition:'persist:合成抖音',terminalQr:false,saveQrPngPath:'/synthetic-login.png',timeoutMs:10000}),3);
  assert.ok(launchOptions.timeout<=10000);assert.equal(gotoOptions.timeout,8000);assert.equal(timers.find(t=>t.ms>0).ms,4000);
});
