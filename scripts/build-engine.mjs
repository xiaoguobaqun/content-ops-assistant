import path from 'node:path';
import fs from 'node:fs/promises';
import { runProcess } from '../src/process.mjs';
import {engineRoot,projectRoot} from '../src/engine.mjs';
const bundled=path.join(projectRoot,'.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node');
let node=process.execPath;
try{await fs.access(bundled);node=bundled;}catch{}
const version=await runProcess(node,['--version']);
if(!version.stdout.startsWith('v20.'))throw Error('构建引擎需要 Node 20，请使用 Node 20 执行本脚本');
const env={...process.env,NODE_ENV:'production'};
for(const args of [['scripts/gen-telemetry-secret.js'],['node_modules/webpack-cli/bin/cli.js','--config','.electron-vue/webpack.main.config.js']]){
  const result=await runProcess(node,args,{cwd:engineRoot,env,timeoutMs:120000});
  if(result.code!==0){console.error(result.stderr||result.stdout);process.exit(1);}
  console.log(result.stdout.trim());
}
