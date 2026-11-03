import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import vm from 'node:vm';const require=createRequire(import.meta.url);
test('native video selection accepts one nonempty video and authorizes only its real file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'drop-video-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const {selectVideo}=require('../desktop/video-selection.cjs'),selected=new Set(),media={issue:async()=> 'app-media://synthetic'};const file=path.join(root,'合成.MP4');await fs.writeFile(file,'synthetic');
 const result=await selectVideo([file],{selected,media});assert.equal(result.path,await fs.realpath(file));assert.equal(result.name,'合成.MP4');assert.ok(selected.has(result.path));
 for(const paths of [[],[file,file],[root],[path.join(root,'missing.mp4')]])await assert.rejects(selectVideo(paths,{selected,media}));const empty=path.join(root,'empty.mov');await fs.writeFile(empty,'');const bad=path.join(root,'page.html');await fs.writeFile(bad,'<html>');for(const f of [empty,bad]){await assert.rejects(selectVideo([f],{selected,media}));assert.equal(selected.has(f),false);}
});
test('preload only forwards real drop events on the video zone, never a scripted drop',async()=>{
 const listeners={},calls=[];const target={disabled:false,classList:{add(){},remove(){}},closest:()=>target};
 vm.runInNewContext(await fs.readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{invoke:async(...args)=>calls.push(args),on(){},removeListener(){}}}),window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{querySelector:()=>target},console});
 assert.equal(typeof listeners.drop,'function');const event={target,isTrusted:false,dataTransfer:{types:['Files'],files:[{path:'/synthetic/video.mp4'}]},preventDefault(){}};await listeners.drop(event);assert.equal(calls.length,0);await listeners.drop({...event,isTrusted:true});assert.equal(calls.length,1);assert.equal(calls[0][0],'desktop:drop-video');
});
