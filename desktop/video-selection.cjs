const fs=require('node:fs/promises');const path=require('node:path');
async function selectVideo(paths,{selected,media}){
  if(!Array.isArray(paths)||paths.length!==1||typeof paths[0]!=='string'||!path.isAbsolute(paths[0]))throw Error('请一次拖入一个本机视频文件');
  let file,stat;try{file=await fs.realpath(paths[0]);stat=await fs.stat(file);}catch{throw Error('视频文件无法读取，请重新选择');}
  if(!stat.isFile()||!stat.size)throw Error('请选择非空的视频文件，不能拖入文件夹');
  if(!/\.(mp4|mov|m4v|mkv|avi|webm)$/i.test(file))throw Error('请选择 MP4、MOV 等支持的视频文件');
  const url=await media.issue(file);selected.add(file);return {path:file,name:path.basename(file),size:stat.size,url};
}
module.exports={selectVideo};
