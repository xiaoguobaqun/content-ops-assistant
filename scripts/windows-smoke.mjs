import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const normalized=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);

export function validateInstalledReport(report,{installDir,dataRoot}){
  assert.equal(report?.ok,true,'安装应用自检未通过');
  for(const name of ['renderer','worker','engine','media'])assert.equal(report.checks?.[name],true,`安装应用缺少有效检查：${name}`);
  assert.equal(normalized(report.projectRoot),normalized(path.join(installDir,'resources/app')),'运行的是源码目录而非安装应用');
  assert.equal(normalized(report.dataRoot),normalized(dataRoot),'未使用隔离工作资料目录');
  assert.ok(!normalized(dataRoot).startsWith(normalized(installDir)+path.sep)&&normalized(dataRoot)!==normalized(installDir),'工作资料不能保存在安装目录');
}

function run(file,args,{timeoutMs=120000,env=process.env,verbatim=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:false,windowsVerbatimArguments:verbatim});
    let output='',settled=false;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-65536);});
    const timer=setTimeout(async()=>{
      if(settled)return;settled=true;
      try{await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});}catch{}
      reject(Error(`验证进程超时：${path.basename(file)}\n${output}`));
    },timeoutMs);
    child.on('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
    child.on('exit',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);code===0?resolve({code,output}):reject(Error(`验证进程失败：${path.basename(file)} (${code??signal})\n${output}`));});
  });
}
async function waitUntil(check,message,timeoutMs=30000){
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){if(await check())return;await pause(250);}
  throw Error(message);
}
async function installedProcesses(installDir){
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:CONTENT_OPS_SMOKE_INSTALL,[System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name); ConvertTo-Json -InputObject $rows -Compress"],{env:{...process.env,CONTENT_OPS_SMOKE_INSTALL:installDir},windowsHide:true,timeout:20000});
  return JSON.parse(stdout.replace(/^\uFEFF/,'').trim()||'[]');
}

export async function smokeWindowsInstaller({installer,reportPath=path.join(root,'dist/windows-smoke.json')}={}){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('安装验证必须在原生 Windows x64 上运行');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  installer=path.resolve(installer||path.join(root,`dist/Content-Ops-Assistant-${manifest.version}-win-x64-setup.exe`));
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'content-ops-win-smoke-'));
  const installDir=path.join(temporary,'安装 目录'),dataRoot=path.join(temporary,'工作 资料');
  const internalReport=path.join(temporary,'installed-report.json'),sentinel=path.join(dataRoot,'uninstall-preserve.txt');
  const report={ok:false,version:manifest.version,platform:'win32-x64',livePlatformAcceptance:false,checks:{}};
  let uninstaller;
  try{
    await fs.mkdir(dataRoot,{recursive:true});await fs.writeFile(sentinel,'仅用于卸载保留验证');
    // NSIS /D consumes the final command-line remainder and must not be wrapped in quotes.
    await run(installer,['/S','/currentuser',`/D=${installDir}`],{verbatim:true,timeoutMs:180000});
    const executable=path.join(installDir,'Content-Ops-Assistant.exe');await fs.access(executable);
    report.checks.installed=true;
    const names=await fs.readdir(installDir);uninstaller=names.find(name=>/^uninstall.*\.exe$/i.test(name));
    assert.ok(uninstaller,'安装器未提供卸载入口');uninstaller=path.join(installDir,uninstaller);
    for(const tool of ['node.exe','ffmpeg.exe','ffprobe.exe','windows-host.exe'])await fs.access(path.join(installDir,'resources/app/runtime',tool));
    const cleanEnv={...process.env,CONTENT_OPS_SMOKE_REPORT:internalReport,CONTENT_OPS_DATA_ROOT:dataRoot,CONTENT_OPS_DOCUMENTS:path.join(dataRoot,'engine-documents'),CONTENT_OPS_ENGINE_USER_DATA:path.join(dataRoot,'engine-user-data'),APPDATA:path.join(temporary,'应用数据'),LOCALAPPDATA:path.join(temporary,'本地数据'),PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`};
    // The installed app must find its packaged tools even without developer PATH entries.
    for(const key of ['CONTENT_OPS_FFMPEG','CONTENT_OPS_FFPROBE','CONTENT_OPS_WINDOWS_HOST','ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH'])delete cleanEnv[key];
    await run(executable,[],{env:cleanEnv,timeoutMs:120000});
    const appReport=JSON.parse(await fs.readFile(internalReport,'utf8'));
    validateInstalledReport(appReport,{installDir,dataRoot});report.checks={...report.checks,...appReport.checks,normalExit:true};
    await waitUntil(async()=>!(await installedProcesses(installDir)).length,'正常退出后仍有安装目录下的程序在运行');
    report.checks.noRemainingProcesses=true;
    await run(uninstaller,['/S','/currentuser'],{timeoutMs:120000});
    await waitUntil(async()=>{try{await fs.access(executable);return false;}catch{return true;}},'卸载未移除程序');
    assert.equal(await fs.readFile(sentinel,'utf8'),'仅用于卸载保留验证','卸载删除了用户资料');
    report.checks.uninstalled=true;report.checks.dataPreserved=true;report.ok=true;
    return report;
  }catch(error){report.error=error.message;throw error;}
  finally{
    await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));
    if(!report.checks.uninstalled&&uninstaller)try{await run(uninstaller,['/S','/currentuser'],{timeoutMs:60000});}catch{}
    if(report.ok)await fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250});
  }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  smokeWindowsInstaller({installer:process.argv[2]}).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
}
