const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('contentOps',Object.freeze({
  invoke:(method,args={})=>ipcRenderer.invoke('desktop:request',method,args),
  onUpdate:listener=>{if(typeof listener!=='function')return ()=>{};const handler=(_,event)=>listener(event);ipcRenderer.on('desktop:update',handler);return ()=>ipcRenderer.removeListener('desktop:update',handler);},
}));

// 路径授权仅来自可信的原生文件拖放，不向 renderer 暴露任意路径登记方法。
const videoZone=event=>event.target?.closest?.('#choose-video');
const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
window.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();const zone=videoZone(event);if(zone&&!zone.disabled){zone.classList.add('drag-over');event.dataTransfer.dropEffect='copy';}});
window.addEventListener('dragleave',event=>videoZone(event)?.classList.remove('drag-over'));
window.addEventListener('drop',async event=>{
  if(!hasFiles(event))return;event.preventDefault();const zone=videoZone(event);zone?.classList.remove('drag-over');
  if(!event.isTrusted||!zone||zone.disabled)return;
  await ipcRenderer.invoke('desktop:drop-video',{paths:Array.from(event.dataTransfer.files||[]).map(file=>file.path)}).catch(()=>{});
});
