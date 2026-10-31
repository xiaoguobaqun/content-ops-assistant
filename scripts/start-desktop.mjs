import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const executable=path.join(root,'engine/MatrixMedia/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const child=spawn(executable,[path.join(root,'desktop')],{cwd:root,env,stdio:'inherit'});child.on('exit',code=>process.exit(code||0));
