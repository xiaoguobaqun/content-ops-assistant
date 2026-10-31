/** 正常终止信号走可取消的收尾，避免独立CLI直接退出而遗留扫码图。 */
export async function withLoginCancellation(work,cleanup=async()=>{},{app}={}){
  const controller=new AbortController();let result,failure,completing=false;
  const stop=()=>{if(controller.signal.aborted)return;const error=new Error('本人登录已停止');error.name='AbortError';error.code='LOGIN_CANCELLED';controller.abort(error);};
  // 程序自主关闭窗口也可能触发原生退出；业务已结束时仅等待收尾，不改写为取消。
  const beforeQuit=event=>{event.preventDefault();if(!completing)stop();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);app?.on('before-quit',beforeQuit);
  try{result=await work(controller.signal,()=>{completing=true;});}catch(error){failure={error};}
  finally{
    try{await cleanup(controller.signal);}catch(error){if(!failure)failure={error};}
    finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);app?.removeListener('before-quit',beforeQuit);}
  }
  if(controller.signal.aborted)throw controller.signal.reason;
  if(failure)throw failure.error;
  return result;
}
