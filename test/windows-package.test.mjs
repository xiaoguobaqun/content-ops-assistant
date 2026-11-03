import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-ops-package-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const projectRoot = path.join(dir, '源码 中文'), stageRoot = path.join(dir, '安装暂存');
  const write = async (file, value='runtime code') => {
    const target=path.join(projectRoot,file); await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,typeof value==='string'?value:JSON.stringify(value)); return target;
  };
  await write('package.json',{name:'content-ops-assistant',version:'0.6.0',license:'GPL-2.0-only'});
  for (const file of ['LICENSE','desktop/main.cjs','desktop/preload.cjs','desktop/installed-check.cjs','desktop/runtime-config.cjs','desktop/service.mjs','desktop/ui/index.html','desktop/ui/app.mjs','desktop/ui/styles.css','desktop/ui/icons.svg','src/engine.mjs','src/runtime-paths.mjs','bin/content-ops.mjs']) await write(file);
  const engine='engine/MatrixMedia/';
  await write(engine+'package.json',{name:'matrix-video',version:'0.13.3',main:'./dist/electron/main.js',dependencies:{external:'1.0.0'},devDependencies:{'build-only':'1.0.0'},scripts:{postinstall:'never run'}});
  for (const file of ['LICENSE','dist/electron/main.js','dist/electron/990.js','src/main/index.js','src/shared/accountPartition.js','.electron-vue/webpack.main.config.js','static/logo.png','lib/icons/icon.ico']) await write(engine+file);
  await write(engine+'node_modules/external/package.json',{name:'external',version:'1.0.0',main:'lib/index.js',dependencies:{nested:'2.0.0'},optionalDependencies:{'missing-optional':'1.0.0'}});
  await write(engine+'node_modules/external/lib/index.js','module.exports = require("nested");');
  await write(engine+'node_modules/external/LICENSE','MIT');
  await write(engine+'node_modules/external/templates/view.html');
  await write(engine+'node_modules/external/node_modules/nested/package.json',{name:'nested',version:'2.0.0',main:'index.js'});
  await write(engine+'node_modules/external/node_modules/nested/index.js','module.exports = 42;');
  await write(engine+'node_modules/build-only/package.json',{name:'build-only',version:'1.0.0'});
  for (const file of ['electron.exe','ffmpeg.dll','resources/default_app.asar','locales/zh-CN.pak','LICENSE','LICENSES.chromium.html']) await write(engine+'node_modules/electron/dist/'+file);
  await write(engine+'node_modules/electron/package.json',{name:'electron',version:'24.8.8'});
  const runtime={},licenses={};
  for(const [name,filename] of Object.entries({node:'node.exe',ffmpeg:'ffmpeg.exe',ffprobe:'ffprobe.exe',windowsHost:'windows-host.exe'}))runtime[name]=await write('toolchain/'+filename);
  for(const name of ['node','ffmpeg','ffprobe'])licenses[name]=await write('toolchain/'+name+'-LICENSE.txt','full license '+name);
  return {dir,projectRoot,stageRoot,runtime,licenses,write};
}

test('Windows stage runs with all runtime entrypoints and only the production dependency closure',async t=>{
  const f=await fixture(t);
  const {stageWindowsApp}=await import('../scripts/build-windows.mjs');
  await stageWindowsApp(f);
  for(const file of ['desktop/main.cjs','desktop/installed-check.cjs','desktop/runtime-config.cjs','desktop/service.mjs','desktop/ui/index.html','src/runtime-paths.mjs','bin/content-ops.mjs','runtime/node.exe','runtime/ffmpeg.exe','runtime/ffprobe.exe','runtime/windows-host.exe','runtime/licenses/node-LICENSE.txt','runtime/licenses/ffmpeg-LICENSE.txt','runtime/licenses/ffprobe-LICENSE.txt','engine/MatrixMedia/dist/electron/main.js','engine/MatrixMedia/dist/electron/990.js','engine/MatrixMedia/src/shared/accountPartition.js','engine/MatrixMedia/src/main/index.js','engine/MatrixMedia/.electron-vue/webpack.main.config.js','engine/MatrixMedia/node_modules/electron/dist/electron.exe','engine/MatrixMedia/node_modules/electron/dist/LICENSES.chromium.html','engine/MatrixMedia/node_modules/external/templates/view.html','engine/MatrixMedia/node_modules/external/LICENSE'])await fs.access(path.join(f.stageRoot,file));
  const loaded=await import('node:module');
  assert.equal(loaded.createRequire(path.join(f.stageRoot,'engine/MatrixMedia/package.json'))('external'),42);
  await assert.rejects(fs.access(path.join(f.stageRoot,'engine/MatrixMedia/node_modules/build-only')),{code:'ENOENT'});
  const manifest=JSON.parse(await fs.readFile(path.join(f.stageRoot,'package.json'),'utf8'));
  assert.equal(manifest.main,'desktop/main.cjs');assert.equal(manifest.version,'0.6.0');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.stageRoot,'desktop-config.json'),'utf8')),{portable:true});
  const engineManifest=JSON.parse(await fs.readFile(path.join(f.stageRoot,'engine/MatrixMedia/package.json'),'utf8'));
  assert.equal(engineManifest.main,'./dist/electron/main.js');assert.equal(engineManifest.scripts,undefined);
});

test('Windows stage excludes private files even when they appear inside allowed app and dependency directories',async t=>{
  const f=await fixture(t);
  const privateFiles=['.local/people.json','.validation/private.log','.env','desktop/ui/.env','desktop/ui/cookies.json','desktop/ui/screenshots/private.png','desktop/ui/private.png','desktop/ui/settings.json','desktop/test/fixture.mjs','desktop/windows-builder.cjs','desktop/render-icon.cjs','src/private.txt','engine/MatrixMedia/env/.env','engine/MatrixMedia/src/main/logs/private.log','engine/MatrixMedia/src/shared/cookies.json','engine/MatrixMedia/dist/electron/secret.log','engine/MatrixMedia/dist/electron/private.png','engine/MatrixMedia/static/private.png','engine/MatrixMedia/node_modules/external/test/fixture.js','engine/MatrixMedia/node_modules/external/bin/test.js','engine/MatrixMedia/node_modules/external/.npmrc','engine/MatrixMedia/node_modules/external/.env','engine/MatrixMedia/node_modules/external/cookies.json','engine/MatrixMedia/node_modules/external/screenshots/private.png'];
  for(const file of privateFiles)await f.write(file,'PRIVATE MUST NEVER SHIP');
  const {stageWindowsApp}=await import('../scripts/build-windows.mjs');await stageWindowsApp(f);
  for(const file of privateFiles)await assert.rejects(fs.access(path.join(f.stageRoot,file)),{code:'ENOENT'});
});

test('Windows stage refuses missing runtime tools and runtime source symlinks',async t=>{
  const f=await fixture(t);const {stageWindowsApp}=await import('../scripts/build-windows.mjs');
  await fs.rm(f.runtime.ffprobe);
  await assert.rejects(stageWindowsApp(f),/ffprobe/);
  await f.write('toolchain/ffprobe.exe');
  const target=await f.write('.local/private.mjs','private');
  if(process.platform==='win32'){
    await fs.mkdir(path.join(f.projectRoot,'private-code'));
    await fs.symlink(path.join(f.projectRoot,'private-code'),path.join(f.projectRoot,'desktop/ui/leaked'),'junction');
  } else await fs.symlink(target,path.join(f.projectRoot,'src/leaked.mjs'));
  await assert.rejects(stageWindowsApp(f),/symbolic|symlink|链接/i);
});

test('Windows installer configuration retains nested engine dependencies outside electron-builder app pruning',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const {windowsBuilderConfig}=require('../desktop/windows-builder.cjs');
  const config=windowsBuilderConfig({projectRoot:'/project',stageRoot:'/staged',outputRoot:'/output',electronVersion:'24.8.8'});
  assert.equal(config.asar,false);assert.equal(config.executableName,'Content-Ops-Assistant');
  assert.equal(config.directories.app,'/staged');assert.equal(config.electronVersion,'24.8.8');
  assert.equal(config.artifactName,'Content-Ops-Assistant-${version}-win-${arch}-setup.${ext}');
  assert.deepEqual(config.extraResources.map(r=>({...r,from:r.from.replaceAll('\\','/')})),[{from:'/staged/engine/MatrixMedia/node_modules',to:'app/engine/MatrixMedia/node_modules',filter:['**/*']}]);
  assert.equal(config.nsis.oneClick,false);assert.equal(config.nsis.perMachine,false);assert.equal(config.nsis.allowElevation,false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory,true);assert.equal(config.nsis.deleteAppDataOnUninstall,false);
});

test('packaged freshness validation survives packager copy timestamps',async t=>{
  const f=await fixture(t),{createRequire}=await import('node:module');
  const {windowsBuilderConfig}=createRequire(import.meta.url)('../desktop/windows-builder.cjs');
  const appOutDir=path.join(f.dir,'packaged'),engine=path.join(appOutDir,'resources/app/engine/MatrixMedia');
  await fs.cp(path.join(f.projectRoot,'engine/MatrixMedia'),engine,{recursive:true});
  const newer=new Date(Date.now()+3000);await fs.utimes(path.join(engine,'src/shared/accountPartition.js'),newer,newer);
  const config=windowsBuilderConfig({projectRoot:f.projectRoot,stageRoot:f.stageRoot,outputRoot:path.join(f.dir,'out'),electronVersion:'24.8.8'});
  await config.afterPack({appOutDir});
  assert.ok((await fs.stat(path.join(engine,'dist/electron/main.js'))).mtimeMs>=(await fs.stat(path.join(engine,'src/shared/accountPartition.js'))).mtimeMs);
});

test('installer smoke accepts only a complete isolated installed-app report',async()=>{
  const {validateInstalledReport}=await import('../scripts/windows-smoke.mjs');
  const installDir=path.resolve('/tmp/安装'),dataRoot=path.resolve('/tmp/工作资料'),projectRoot=path.join(installDir,'resources/app');
  const report={ok:true,checks:{renderer:true,worker:true,engine:true,media:true},dataRoot,projectRoot};
  assert.doesNotThrow(()=>validateInstalledReport(report,{installDir,dataRoot}));
  for(const changed of [{ok:false},{checks:{renderer:true,worker:true,engine:false,media:true}},{dataRoot:installDir},{projectRoot:path.resolve('/source-checkout')}])assert.throws(()=>validateInstalledReport({...report,...changed},{installDir,dataRoot}));
});

test('installed check waits for the initial refresh even when activity has not started yet',async()=>{
 const {createRequire}=await import('node:module');const {waitForStartup}=createRequire(import.meta.url)('../desktop/installed-check.cjs');
 let state={checkedAt:null,activity:null};const worker={request:async()=>state};let finished=false;
 const check=waitForStartup(worker,{timeoutMs:1000,pollMs:5}).then(data=>{finished=true;return data;});
 await new Promise(r=>setTimeout(r,20));assert.equal(finished,false);state={checkedAt:123,activity:{status:'running'}};
 await new Promise(r=>setTimeout(r,20));assert.equal(finished,false);state={checkedAt:123,activity:{status:'completed'}};
 assert.equal((await check).checkedAt,123);
});

test('media tool preparation creates an isolated npm project instead of resolving the parent package',async t=>{
 const {ensureToolsProject}=await import('../scripts/build-windows.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ops-tools-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const original='{"name":"parent-project","version":"1.0.0"}';await fs.writeFile(path.join(root,'package.json'),original);
 const tools=path.join(root,'.validation/windows-tools');await ensureToolsProject(tools);
 assert.equal(JSON.parse(await fs.readFile(path.join(tools,'package.json'),'utf8')).private,true);
 assert.equal(await fs.readFile(path.join(root,'package.json'),'utf8'),original);
});

test('installed self-check delegates engine diagnostics to the Node worker rather than importing backend into Electron',async t=>{
 const {createRequire}=await import('node:module');const {checkInstalledApp}=createRequire(import.meta.url)('../desktop/installed-check.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ops-install-check-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const report=path.join(directory,'report.json');const worker={request:async method=>{if(method==='dashboard')return {protocolVersion:1,checkedAt:123,activity:null};if(method==='runtimeCheck')return {health:{ok:true,checks:[{name:'ffmpeg',ok:true},{name:'ffprobe',ok:true}]},engineHelp:'publish --help'};throw Error('unexpected request');}};
 const window={webContents:{isLoading:()=>false,executeJavaScript:async()=>true}};
 const result=await checkInstalledApp({window,worker,projectRoot:path.join(directory,'no-source-code'),dataRoot:path.join(directory,'data'),reportPath:report});
 assert.equal(result.ok,true);assert.equal(JSON.parse(await fs.readFile(report,'utf8')).checks.engine,true);
});
