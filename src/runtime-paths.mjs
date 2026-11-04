import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const dataRoot=process.env.CONTENT_OPS_DATA_ROOT||path.join(projectRoot,'.local');
if(!path.isAbsolute(dataRoot))throw Error('本机数据目录必须使用绝对路径');
export function mediaTool(name){
  if(!['ffmpeg','ffprobe'].includes(name))throw Error('媒体工具名称无效');
  const configured=process.env[`CONTENT_OPS_${name.toUpperCase()}`];
  if(configured){if(!path.isAbsolute(configured))throw Error('媒体工具必须使用绝对路径');return configured;}
  return process.platform==='win32'?path.join(projectRoot,'runtime',name+'.exe'):name;
}
