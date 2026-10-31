import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {desktopManifest} from '../desktop/package-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin')throw Error('当前桌面打包脚本面向本机 macOS');
const source=path.join(root,'engine/MatrixMedia/node_modules/electron/dist/Electron.app');
const sourceNode=path.join(root,'.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node');
await fs.access(source);await fs.access(sourceNode);
const output=path.join(root,'dist/内容运营助手.app'),resources=path.join(output,'Contents/Resources');
await fs.mkdir(path.dirname(output),{recursive:true});await fs.rm(output,{recursive:true,force:true});await fs.cp(source,output,{recursive:true,verbatimSymlinks:true});
const runtimeNode=path.join(resources,'runtime/node');await fs.mkdir(path.dirname(runtimeNode),{recursive:true});await fs.copyFile(sourceNode,runtimeNode);await fs.chmod(runtimeNode,0o755);
const manifest=desktopManifest(root,runtimeNode);const appRoot=path.join(resources,'app');await fs.mkdir(appRoot,{recursive:true});
await fs.cp(path.join(root,'desktop'),path.join(appRoot,'desktop'),{recursive:true});await fs.copyFile(path.join(root,'LICENSE'),path.join(appRoot,'LICENSE'));
await fs.mkdir(path.join(appRoot,'src'),{recursive:true});await fs.copyFile(path.join(root,'src/platforms.mjs'),path.join(appRoot,'src/platforms.mjs'));
await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify(manifest.package,null,2));await fs.writeFile(path.join(appRoot,'desktop-config.json'),JSON.stringify(manifest.config,null,2));
const plist=path.join(output,'Contents/Info.plist');
for(const [key,value]of Object.entries(manifest.info)){
  try{execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist],{stdio:'ignore'});}
  catch{execFileSync('/usr/libexec/PlistBuddy',['-c',`Add :${key} string ${value}`,plist],{stdio:'ignore'});}
}
const buildRoot=path.join(root,'.validation/desktop-build');await fs.mkdir(buildRoot,{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(source,'Contents/MacOS/Electron'),[path.join(root,'desktop/render-icon.cjs'),path.join(root,'desktop/app-icon.svg'),buildRoot],{env,stdio:'pipe',timeout:60000});
const iconset=path.join(buildRoot,'content-ops.iconset');await fs.mkdir(iconset,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),path.join(buildRoot,'app-icon.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(resources,'content-ops.icns')]);
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',output],{stdio:'pipe',timeout:60000});
console.log(JSON.stringify({app:output,projectRoot:root,version:manifest.package.version},null,2));
