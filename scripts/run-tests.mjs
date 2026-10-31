import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));const bundled=path.join(root,'.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node');const node=fs.existsSync(bundled)?bundled:process.execPath;
if(!fs.existsSync(bundled)&&!process.version.startsWith('v20.'))throw Error('当前浏览器夹具需要 Node 20，请使用 Node 20 运行测试。');
const files=fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.mjs')).map(name=>path.join(root,'test',name));
const child=spawn(node,['--test',...files],{cwd:root,stdio:'inherit'});child.on('exit',code=>process.exit(code||0));
