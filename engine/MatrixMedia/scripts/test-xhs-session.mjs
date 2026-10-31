import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

test('xhs login uses an isolated standard partition and requires a visible personal verification window',async()=>{
  const {parseLoginArgs}=await import('../src/main/cli/parseLoginArgs.js');
  const {parseAccountsArgs}=await import('../src/main/cli/parseAccountsArgs.js');
  const login=parseLoginArgs(['--platform','xhs','--phone','测试-备注']);assert.equal(login.ok,true);assert.equal(login.value.partition,'persist:测试小红书');assert.equal(login.value.show,true);
  assert.equal(parseAccountsArgs(['--platform','小红书']).value?.platform,'小红书');
  for(const extra of [['--browser','chrome'],['--force'],['--puppeteer-headless'],['--partition','persist:其他小红书']])assert.equal(parseLoginArgs(['-p','xhs','--phone','测试',...extra]).ok,false);
});
test('xhs page inspection never reads password, hidden-input values, or signed image URLs',async()=>{
  const {inspectXhsPage}=await import('../src/main/services/upLoad/xhsDraftPage.js');
  const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setContent('<h1>小红书登录</h1><input type="password" value="password-secret"><input type="hidden" value="token-secret"><input placeholder="手机号" value="private-number"><img width="100" height="100" src="https://creator.xiaohongshu.com/qr?secret=signed-secret"><button>扫码登录</button><script>window.sensitive="script-secret"</script>');const result=await page.evaluate(inspectXhsPage);const text=JSON.stringify(result);for(const secret of ['password-secret','token-secret','private-number','signed-secret','script-secret'])assert.equal(text.includes(secret),false);assert.ok(text.includes('扫码登录'));assert.ok(result.images.some(i=>i.width===100));
  }finally{await browser.close();}
});

test('only an observed own-account response can confirm xhs authentication',async()=>{
  const {classifyXhsAuthResponse}=await import('../src/shared/xhsAuth.js');
  const response={url:'https://creator.xiaohongshu.com/api/galaxy/user/info',status:200,payload:{code:0,success:true,data:{userId:'owner-id'}},expectedUserId:'owner-id'};
  assert.equal(classifyXhsAuthResponse(response).loggedIn,true);
  for(const changed of [{fromCache:true},{fromServiceWorker:true},{expectedUserId:''},{expectedUserId:'other'},{payload:{code:0,data:{}}},{payload:{code:0,data:{userId:'other'}}},{url:'https://other.example/api/galaxy/creator/user/info'},{url:'https://creator.xiaohongshu.com/api/public/user/info'},{status:500}])assert.equal(classifyXhsAuthResponse({...response,...changed}).ok,false);
  assert.equal(classifyXhsAuthResponse({...response,status:401}).loggedIn,false);
});

test('unverified xhs cookies remain unknown while explicit server evidence is authoritative',async()=>{
  const {resolveXhsAccountLogin}=await import('../src/shared/loginState.js');
  assert.equal(resolveXhsAccountLogin({loggedIn:true},{ok:false}).loggedIn,null);
  assert.equal(resolveXhsAccountLogin({loggedIn:true},{ok:true,loggedIn:false}).loggedIn,false);
  assert.equal(resolveXhsAccountLogin({loggedIn:false},{ok:true,loggedIn:true}).loggedIn,true);
});
test('xhs QR export requires a decoded platform login URL',async()=>{
  const {isXhsLoginQrPayload}=await import('../src/shared/xhsAuth.js');assert.equal(isXhsLoginQrPayload('https://www.xiaohongshu.com/website-login/qr-code?code=fixture'),true);
  for(const value of ['https://example.com/login','https://xiaohongshu.com.evil/login','https://www.xiaohongshu.com/explore','https://user:secret@www.xiaohongshu.com/login','avatar'])assert.equal(isXhsLoginQrPayload(value),false);
});

test('switching to xhs QR mode never submits credentials or accepts the agreement',async()=>{
  const {switchXhsLoginToQr}=await import('../src/main/services/upLoad/xhsDraftPage.js');const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new'});
  try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,contentType:'text/html; charset=utf-8',body:r.isNavigationRequest()?`<p id="mode">短信登录</p><img class="css-wemwzq" width="64" height="64" onclick="document.querySelector('#mode').textContent='扫码登录';window.switched=(window.switched||0)+1"><input type="checkbox"><button onclick="window.submitted=true">登录</button>`:''}));await page.goto('https://creator.xiaohongshu.com/login');
    assert.equal(await switchXhsLoginToQr(page),true);assert.equal(await switchXhsLoginToQr(page),false);assert.equal(await page.evaluate(()=>window.switched),1);assert.equal(await page.$eval('input',e=>e.checked),false);assert.equal(await page.evaluate(()=>window.submitted),undefined);
  }finally{await browser.close();}
});

test('conflicting legacy xhs metadata never selects another account or platform partition',async()=>{
  const {resolveXhsAccountPartition}=await import('../src/shared/xhsAuth.js');
  for(const partition of ['persist:其他小红书','persist:品牌抖音']){const result=resolveXhsAccountPartition({phone:'品牌-备注',partition});assert.equal(result.ok,false);assert.equal(result.partition,'persist:品牌小红书');}
  assert.equal(resolveXhsAccountPartition({phone:'品牌-备注',partition:'persist:品牌-旧备注小红书'}).ok,true);assert.equal(resolveXhsAccountPartition({phone:'品牌'}).partition,'persist:品牌小红书');
});
test('normal login CLI interruption cleans its QR file for both termination signals',async t=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{spawn}=await import('node:child_process');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-cancel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const stopSignal of ['SIGINT','SIGTERM']){
    const file=path.join(dir,stopSignal+'.png');const module=new URL('../src/main/services/cliLogin/loginCancellation.js',import.meta.url).href;
    const code=`import fs from 'node:fs/promises';import {withLoginCancellation} from ${JSON.stringify(module)};const file=${JSON.stringify(file)};await fs.writeFile(file,'fixture-qr');const keepAlive=setInterval(()=>{},1000);try{await withLoginCancellation(signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});process.stdout.write('READY\\n');}),()=>fs.rm(file,{force:true}));}catch(error){if(error.code==='LOGIN_CANCELLED')process.exitCode=3;else throw error;}finally{clearInterval(keepAlive);}`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let output='',errors='',sent=false;child.stdout.on('data',chunk=>{output+=chunk;if(!sent&&output.includes('READY')){sent=true;child.kill(stopSignal);}});child.stderr.on('data',chunk=>errors+=chunk);
    const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('child failed to clean up'));},5000);child.once('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});assert.equal(exit.code,3,errors);assert.equal(sent,true);await assert.rejects(fs.access(file));
  }
});
