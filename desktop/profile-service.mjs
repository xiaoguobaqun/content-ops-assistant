import {createProfileStore} from '../src/profiles.mjs';
import {contentDigest} from '../src/local-store.mjs';
import {currentSignal,throwIfCancelled} from '../src/cancellation.mjs';
import {analyzeWithProvider} from '../src/ai-client.mjs';

export const profileMethods=new Set(['profileGet','profileSave','profilePreview','profileCapabilities','profileCollect','profileAnalyze','profileConfirm']);
export function createProfileService({root,people,engine,idle,start,emit,analyze=analyzeWithProvider}){
  const profiles=createProfileStore({root,people});
  let capabilityRequest;
  const decorate=async profile=>({...profile,currentBindingsDigest:contentDigest((await people.get(profile.personId)).bindings)});
  const publish=async profile=>{const value=await decorate(profile);emit({type:'profileUpdated',profile:value});return value;};
  async function capabilities(){
    if(typeof engine.profileCapabilities==='function'){if(!capabilityRequest)capabilityRequest=Promise.resolve().then(()=>engine.profileCapabilities()).catch(error=>{capabilityRequest=null;throw error;});return capabilityRequest;}
    return Object.fromEntries(['dy','sph','xhs'].map(id=>[id,{available:false,liveVerified:false,reason:'账号资料读取尚未完成验收'}]));
  }
  return {async handle(method,args){
    if(method==='profileGet')return decorate(await profiles.get(args.personId));
    if(method==='profileCapabilities')return capabilities();
    if(method==='profilePreview')return profiles.preview(args.personId);
    if(method==='profileSave'){idle();return publish(await profiles.save(args));}
    if(method==='profileConfirm'){idle();return publish(await profiles.confirm(args));}
    if(method==='profileCollect'){
      idle();const p=await profiles.get(args.personId),person=await people.get(args.personId);
      if(p.mode!=='accounts'||!p.selectedPlatforms.length)throw Error('请先选择人员与账号来源并保存');
      if(p.revision!==args.expectedRevision||args.bindingsDigest!==contentDigest(person.bindings))throw Error('资料或账号绑定已变化，请刷新');
      const supported=await capabilities();
      for(const id of p.selectedPlatforms)if(supported[id]?.available!==true)throw Error(supported[id]?.reason||'账号资料读取尚未完成验收');
      return start('profileCollect',{personId:p.personId,label:'正在只读获取本人账号样本'},async()=>{
        const samples=[];
        for(const id of p.selectedPlatforms){throwIfCancelled();const current=await people.get(p.personId),binding=current.bindings[id];if(current.revision!==person.revision||!binding||binding.phone!==person.bindings[id]?.phone)throw Error('账号绑定发生变化，停止读取');const sample=await engine.profileSample(binding.phone,id);if(sample?.ok!==true)throw Error(sample?.message||'账号样本尚未核实');samples.push(sample);}
        throwIfCancelled();if((await people.get(p.personId)).revision!==person.revision)throw Error('读取期间人员或账号绑定发生变化，旧样本未采用');
        await publish(await profiles.saveSamples({...args,samples,expectedPersonRevision:person.revision}));return {message:'账号样本已准备，请检查本次分析材料'};
      });
    }
    if(method==='profileAnalyze'){
      idle();
      // provider只由原生主进程注入；不查找环境密钥，也不将其写入画像或事件。
      const provider=args.provider;
      if(!provider?.apiKey||!provider.model||!['openai','anthropic'].includes(provider.protocol))throw Error('请先完整配置 AI 服务');
      if(typeof args.expectedSourceDigest!=='string'||!args.expectedSourceDigest)throw Error('请先预览本次分析材料');
      const preview=await profiles.preview(args.personId);
      if(preview.sourceDigest!==args.expectedSourceDigest||preview.revision!==args.expectedRevision||preview.bindingsDigest!==args.bindingsDigest)throw Error('分析材料发生变化，请重新预览');
      return start('profileAnalyze',{personId:args.personId,label:'正在生成画像建议'},async()=>{
        let begun;
        try{
          throwIfCancelled();begun=await profiles.beginAnalysis({...args,provider:{id:provider.id,model:provider.model}});throwIfCancelled();
          const result=await analyze(provider,begun.materials,{signal:currentSignal()});throwIfCancelled();
          await publish(await profiles.finishAnalysis({personId:args.personId,requestId:begun.requestId,result}));return {message:'画像建议已生成，请检查并确认'};
        }catch(error){
          const cancelled=!!currentSignal()?.aborted,message=cancelled?'画像分析已停止，原确认版本保留':'画像分析未完成，请检查接口或资料是否发生变化；原确认版本保留';
          if(begun)try{await publish(await profiles.failAnalysis({personId:args.personId,requestId:begun.requestId,message,cancelled}));}catch{}
          throw Error(message);
        }
      });
    }
    throw Error('不支持这项画像操作');
  }};
}
