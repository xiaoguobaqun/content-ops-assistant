import readline from 'node:readline';
// stdout 只用于协议，诊断信息留在 stderr。
console.log=(...args)=>console.error(...args);
const {createDesktopService}=await import('./service-core.mjs');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const controller=new AbortController();
const service=createDesktopService({signal:controller.signal,onEvent:event=>send({event})});const requests=new Set();let closing=false;
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  if(closing)return;
  if(line.length>1024*1024){send({id:null,error:'请求过大'});return;}
  let request;try{request=JSON.parse(line);}catch{send({id:null,error:'无法读取请求'});return;}
  const promise=Promise.resolve().then(()=>service.handle(request.method,request.args)).then(result=>send({id:request.id,result})).catch(error=>send({id:request.id,error:error.message})).finally(()=>requests.delete(promise));requests.add(promise);
});
async function shutdown(){if(closing)return;closing=true;controller.abort(Error('操作已停止，未完成的任务请先回查'));await Promise.allSettled([...requests]);await service.waitForIdle();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);lines.on('close',shutdown);
send({ready:true,protocolVersion:1});
