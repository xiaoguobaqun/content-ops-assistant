import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const exec = promisify(execFile);
const ownRoot=fileURLToPath(new URL('../',import.meta.url));
const excludedDirectories=/^(?:\.git|\.local|\.validation|\.cache|\.github|\.agents|\.codex|node_modules|test|tests|__tests__|fixtures?|screenshots?|logs?|coverage|examples?|docs|private|sessions?|partitions?|crashpad|cache)$/i;
const excludedFiles=/^(?:cookies?(?:\.json|\.sqlite)?|settings\.json|ai-providers\.json|people\.json|desktop-state\.json|.*\.(?:log|tmp|dmp|sqlite|db)|.*\.bak(?:\..*)?|(?:test|spec|example)(?:[-.].*)?|.*\.(?:test|spec)\.[cm]?js)$/i;
const code=/\.(?:[cm]?js|json)$/i, desktopAsset=/\.(?:[cm]?js|json|html|css|svg|woff2?)$/i;
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));

async function regular(file,label=file) {
  let stat;try{stat=await fs.lstat(file);}catch{throw Error(`缺少 Windows 运行文件：${label}`);}
  if(!stat.isFile()||stat.isSymbolicLink())throw Error(`运行文件必须是普通文件，禁止符号链接：${label}`);
  return stat;
}
async function copyFile(source,dest) {
  const stat=await regular(source);await fs.mkdir(path.dirname(dest),{recursive:true});
  await fs.copyFile(source,dest);await fs.utimes(dest,stat.atime,stat.mtime);
}
async function copyTree(source,dest,{accept=()=>true,ignoreMissing=false}={}) {
  let entries;try{
    if((await fs.lstat(source)).isSymbolicLink())throw Error(`安装包禁止符号链接：${source}`);
    entries=await fs.readdir(source,{withFileTypes:true});
  }catch(error){if(ignoreMissing&&error.code==='ENOENT')return;throw error;}
  for(const entry of entries){
    if(entry.name.startsWith('.')||entry.isDirectory()&&excludedDirectories.test(entry.name)||excludedFiles.test(entry.name))continue;
    const from=path.join(source,entry.name),to=path.join(dest,entry.name),stat=await fs.lstat(from);
    if(stat.isSymbolicLink())throw Error(`安装包禁止符号链接：${from}`);
    if(stat.isDirectory())await copyTree(from,to,{accept});
    else if(stat.isFile()&&accept(entry.name))await copyFile(from,to);
  }
}
async function findPackage(name,from) {
  if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))throw Error('依赖名称无效');
  let dir=from;
  while(true){
    const candidate=path.join(dir,'node_modules',...name.split('/'));
    try{await regular(path.join(candidate,'package.json'));return candidate;}catch(error){if(!error.message.startsWith('缺少'))throw error;}
    const parent=path.dirname(dir);if(parent===dir)throw Error(`找不到生产依赖 ${name}`);dir=parent;
  }
}
async function copyProductionDependencies(engineRoot,destRoot,manifest) {
  const copied=new Set();
  async function visit(name,from,optional=false){
    let source;try{source=await findPackage(name,from);}catch(error){if(optional&&error.message.startsWith('找不到'))return;throw error;}
    const relative=path.relative(engineRoot,source);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error(`生产依赖不在引擎内：${name}`);
    if(copied.has(source))return;copied.add(source);
    const manifest=await readJson(path.join(source,'package.json'));
    await copyTree(source,path.join(destRoot,relative));
    const optionalNames=new Set(Object.keys(manifest.optionalDependencies||{}));
    for(const dep of Object.keys({...manifest.dependencies,...manifest.optionalDependencies}))await visit(dep,source,optionalNames.has(dep));
    // npm bundledDependencies may be present without being listed as dependencies.
    for(const dep of Array.isArray(manifest.bundledDependencies)?manifest.bundledDependencies:[])await visit(dep,source);
  }
  const optionalNames=new Set(Object.keys(manifest.optionalDependencies||{}));
  for(const name of Object.keys({...manifest.dependencies,...manifest.optionalDependencies}))await visit(name,engineRoot,optionalNames.has(name));
}

/** Build a clean, path-independent app tree. Never copies a whole checkout or node_modules. */
export async function stageWindowsApp({projectRoot,stageRoot,runtime,licenses}) {
  projectRoot=path.resolve(projectRoot);stageRoot=path.resolve(stageRoot);
  if(stageRoot===projectRoot||projectRoot.startsWith(stageRoot+path.sep))throw Error('安装暂存目录不能覆盖源码目录');
  const manifest=await readJson(path.join(projectRoot,'package.json'));
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version||''))throw Error('安装包版本无效');
  for(const name of ['node','ffmpeg','ffprobe','windowsHost'])await regular(runtime?.[name]||'',name);
  for(const name of ['node','ffmpeg','ffprobe'])await regular(licenses?.[name]||'',`${name} license`);
  const engineRoot=path.join(projectRoot,'engine/MatrixMedia'),engineDest=path.join(stageRoot,'engine/MatrixMedia');
  const engineManifest=await readJson(path.join(engineRoot,'package.json'));
  for(const file of ['desktop/main.cjs','desktop/service.mjs','src/engine.mjs','engine/MatrixMedia/dist/electron/main.js','engine/MatrixMedia/src/main/index.js','engine/MatrixMedia/src/shared/accountPartition.js','engine/MatrixMedia/.electron-vue/webpack.main.config.js','engine/MatrixMedia/node_modules/electron/dist/electron.exe'])await regular(path.join(projectRoot,file));
  await fs.rm(stageRoot,{recursive:true,force:true});await fs.mkdir(stageRoot,{recursive:true});
  await copyTree(path.join(projectRoot,'desktop'),path.join(stageRoot,'desktop'),{accept:name=>desktopAsset.test(name)&&!['package-config.mjs','render-icon.cjs','windows-builder.cjs'].includes(name)});
  await copyTree(path.join(projectRoot,'src'),path.join(stageRoot,'src'),{accept:code.test.bind(code)});
  await copyTree(path.join(projectRoot,'bin'),path.join(stageRoot,'bin'),{accept:code.test.bind(code),ignoreMissing:true});
  await copyFile(path.join(projectRoot,'LICENSE'),path.join(stageRoot,'LICENSE'));
  await fs.writeFile(path.join(stageRoot,'package.json'),JSON.stringify({name:'content-ops-desktop',productName:'内容运营助手',version:manifest.version,main:'desktop/main.cjs',private:true,license:manifest.license||'GPL-2.0-only'},null,2));
  await fs.writeFile(path.join(stageRoot,'desktop-config.json'),JSON.stringify({portable:true},null,2));
  for(const dir of ['src/main','src/shared'])await copyTree(path.join(engineRoot,dir),path.join(engineDest,dir),{accept:code.test.bind(code)});
  await copyTree(path.join(engineRoot,'dist/electron'),path.join(engineDest,'dist/electron'),{accept:code.test.bind(code)});
  for(const file of ['static/logo.png','static/loader.html','lib/icons/icon.ico','lib/icons/icon.png']){
    const source=path.join(engineRoot,file);try{await fs.access(source);}catch{continue;}
    await copyFile(source,path.join(engineDest,file));
  }
  await copyFile(path.join(engineRoot,'.electron-vue/webpack.main.config.js'),path.join(engineDest,'.electron-vue/webpack.main.config.js'));
  await copyFile(path.join(engineRoot,'LICENSE'),path.join(engineDest,'LICENSE'));
  await fs.writeFile(path.join(engineDest,'package.json'),JSON.stringify({name:engineManifest.name,version:engineManifest.version,main:'./dist/electron/main.js',license:engineManifest.license||'GPL-2.0-only',dependencies:engineManifest.dependencies},null,2));
  await copyProductionDependencies(engineRoot,engineDest,engineManifest);
  // The engine must launch another Electron executable; the UI executable embeds its own app.
  await copyTree(path.join(engineRoot,'node_modules/electron/dist'),path.join(engineDest,'node_modules/electron/dist'));
  await copyFile(path.join(engineRoot,'node_modules/electron/package.json'),path.join(engineDest,'node_modules/electron/package.json'));
  for(const [name,filename] of Object.entries({node:'node.exe',ffmpeg:'ffmpeg.exe',ffprobe:'ffprobe.exe',windowsHost:'windows-host.exe'}))await copyFile(runtime[name],path.join(stageRoot,'runtime',filename));
  for(const name of ['node','ffmpeg','ffprobe'])await copyFile(licenses[name],path.join(stageRoot,'runtime/licenses',`${name}-LICENSE.txt`));
  return {stageRoot,version:manifest.version};
}

async function download(url,destination){
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`无法下载许可证：${url} (${response.status})`);
  await fs.writeFile(destination,await response.text());return destination;
}

export async function ensureToolsProject(toolsRoot){
  await fs.mkdir(toolsRoot,{recursive:true});const file=path.join(toolsRoot,'package.json');
  try{await fs.access(file);}catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(file,JSON.stringify({name:'content-ops-media-tools',version:'0.0.0',private:true},null,2));}
}
export async function prepareWindowsTools({projectRoot=ownRoot}={}) {
  if(process.platform!=='win32'||process.arch!=='x64'||!process.version.startsWith('v20.'))throw Error('Windows 构建需要 Windows x64 和 Node 20');
  const toolsRoot=path.join(projectRoot,'.validation/windows-tools');await ensureToolsProject(toolsRoot);
  // Exact npm versions are isolated from application dependencies. npm verifies registry integrity.
  const ffmpegRoot=path.join(toolsRoot,'node_modules/ffmpeg-static'),ffprobeRoot=path.join(toolsRoot,'node_modules/@ffprobe-installer/win32-x64');
  await exec(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm install --no-audit --no-fund --save-exact ffmpeg-static@5.2.0 @ffprobe-installer/win32-x64@5.1.0'],{cwd:toolsRoot,windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,npm_config_arch:'x64',npm_config_platform:'win32',FFMPEG_BIN:path.join(ffmpegRoot,'ffmpeg.exe'),FFMPEG_BINARY_RELEASE:'b6.0',FFMPEG_BINARIES_URL:'https://github.com/eugeneware/ffmpeg-static/releases/download'}});
  const nodeLicense=path.join(toolsRoot,'Node-LICENSE.txt');
  try{await copyFile(path.join(path.dirname(process.execPath),'LICENSE'),nodeLicense);}catch{await download(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,nodeLicense);}
  const gplLicense=path.join(ffmpegRoot,'LICENSE');await regular(gplLicense,'FFmpeg GPL license');
  // Missing binary notices cannot silently become an incomplete redistribution.
  for(const name of ['ffmpeg.exe.README','ffmpeg.exe.LICENSE'])await regular(path.join(ffmpegRoot,name),name);
  const runtime={node:process.execPath,ffmpeg:path.join(ffmpegRoot,'ffmpeg.exe'),ffprobe:path.join(ffprobeRoot,'ffprobe.exe'),windowsHost:path.join(projectRoot,'runtime/windows-host.exe')};
  const licenses={node:nodeLicense,ffmpeg:path.join(ffmpegRoot,'ffmpeg.exe.LICENSE'),ffprobe:gplLicense};
  return {toolsRoot,runtime,licenses,ffmpegRoot,ffprobeRoot};
}

export async function buildWindows({projectRoot=ownRoot}={}) {
  const tools=await prepareWindowsTools({projectRoot});
  const {buildWindowsHost}=await import('./build-windows-host.mjs');
  tools.runtime.windowsHost=await buildWindowsHost({projectRoot,outputPath:tools.runtime.windowsHost});
  const stageRoot=path.join(projectRoot,'.validation/windows-stage'),outputRoot=path.join(projectRoot,'dist');
  const staged=await stageWindowsApp({projectRoot,stageRoot,...tools});
  const notices=path.join(stageRoot,'runtime/licenses');
  for(const [label,dir] of [['ffmpeg',tools.ffmpegRoot],['ffprobe',tools.ffprobeRoot]])for(const file of await fs.readdir(dir)){
    if(/^(?:readme|license|copying|notice)|\.LICENSE$|\.README$/i.test(file))await copyFile(path.join(dir,file),path.join(notices,`${label}-${file}`));
  }
  await fs.writeFile(path.join(notices,'SOURCES.txt'),`Node ${process.versions.node}: https://nodejs.org/dist/v${process.versions.node}/\nElectron: see engine/MatrixMedia/node_modules/electron/package.json and dist/LICENSES.chromium.html\nffmpeg-static 5.2.0 (binary release b6.0): https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0\nOriginal Windows FFmpeg build/source information: https://www.gyan.dev/ffmpeg/builds/\nSee ffmpeg-ffmpeg.exe.README and ffmpeg-ffmpeg.exe.LICENSE for the pinned binary's build notices.\nffprobe installer 5.1.0: https://www.npmjs.com/package/@ffprobe-installer/win32-x64/v/5.1.0\nFFprobe distribution source/build information: https://www.gyan.dev/ffmpeg/builds/\nMedia tools are separate GPL-3.0 programs; see their full license and bundled build notices.\n`);
  const require=createRequire(path.join(projectRoot,'engine/MatrixMedia/package.json'));
  const {windowsBuilderConfig}=createRequire(import.meta.url)('../desktop/windows-builder.cjs');
  const electronVersion=(await readJson(path.join(projectRoot,'engine/MatrixMedia/node_modules/electron/package.json'))).version;
  const builder=require('electron-builder');
  const artifacts=await builder.build({targets:builder.Platform.WINDOWS.createTarget(['nsis'],builder.Arch.x64),projectDir:projectRoot,config:windowsBuilderConfig({projectRoot,stageRoot,outputRoot,electronVersion}),publish:'never'});
  const installer=path.join(outputRoot,`Content-Ops-Assistant-${staged.version}-win-x64-setup.exe`);await regular(installer);
  const checksum=createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  await fs.writeFile(installer+'.sha256',`${checksum}  ${path.basename(installer)}\n`);
  return {installer,checksum,version:staged.version,artifacts};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    if(process.argv.includes('--prepare-tools')){
      const {runtime}=await prepareWindowsTools();
      if(process.env.GITHUB_ENV)await fs.appendFile(process.env.GITHUB_ENV,`CONTENT_OPS_FFMPEG=${runtime.ffmpeg}\nCONTENT_OPS_FFPROBE=${runtime.ffprobe}\n`);
      console.log(JSON.stringify({ffmpeg:runtime.ffmpeg,ffprobe:runtime.ffprobe}));
    }else console.log(JSON.stringify(await buildWindows(),null,2));
  }catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
