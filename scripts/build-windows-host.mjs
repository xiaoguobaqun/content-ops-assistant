import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));

export async function buildWindowsHost({outputPath=path.join(root,'runtime','windows-host.exe'),projectRoot=root}={}){
  if(process.platform!=='win32')throw Error('Windows 原生保护程序需要在 Windows 上构建');
  const windows=process.env.WINDIR||process.env.SystemRoot||'C:\\Windows';
  let compiler;
  for(const framework of ['Framework64','Framework']){
    const candidate=path.join(windows,'Microsoft.NET',framework,'v4.0.30319','csc.exe');
    try{await fs.access(candidate);compiler=candidate;break;}catch{}
  }
  if(!compiler)throw Error('未找到 Windows 自带的 .NET Framework 编译器');
  outputPath=path.resolve(outputPath);await fs.mkdir(path.dirname(outputPath),{recursive:true});
  const args=['/nologo','/target:exe','/platform:x64','/optimize+','/utf8output','/reference:System.Web.Extensions.dll',`/out:${outputPath}`,path.join(projectRoot,'native','windows-host.cs')];
  await new Promise((resolve,reject)=>{
    const child=spawn(compiler,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let diagnostics='';
    const capture=chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-16384);};child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.once('error',()=>reject(Error('Windows 原生保护程序编译器无法启动')));
    child.once('close',code=>code===0?resolve():reject(Error(`Windows 原生保护程序编译失败：${diagnostics.trim()}`)));
  });
  return outputPath;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  buildWindowsHost(process.argv[2]?{outputPath:process.argv[2]}:{}).then(file=>console.log(file),error=>{console.error(error.message);process.exitCode=1;});
}
