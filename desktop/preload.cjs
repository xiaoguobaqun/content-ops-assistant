const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('contentOps',Object.freeze({
  invoke:(method,args={})=>ipcRenderer.invoke('desktop:request',method,args),
  onUpdate:listener=>{if(typeof listener!=='function')return ()=>{};const handler=(_,event)=>listener(event);ipcRenderer.on('desktop:update',handler);return ()=>ipcRenderer.removeListener('desktop:update',handler);},
}));
