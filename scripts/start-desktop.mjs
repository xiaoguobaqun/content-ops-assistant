import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
env.CONTENT_OPS_NODE=process.execPath;
const binaries={darwin:'Electron.app/Contents/MacOS/Electron',win32:'electron.exe',linux:'electron'};
if(!binaries[process.platform])throw Error('当前系统暂不支持');
const executable=path.join(root,'engine/MatrixMedia/node_modules/electron/dist',binaries[process.platform]);
const child=spawn(executable,[path.join(root,'desktop')],{cwd:root,env,stdio:'inherit'});child.on('exit',code=>process.exit(code||0));
