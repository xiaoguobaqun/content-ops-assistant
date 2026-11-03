function createAccountRemovalHandler({request,confirm}){
  let pending=false;
  return async function removeAccount(args){
    if(pending)throw Error('正在确认移除账号，请先完成当前操作');
    const {platform,phone}=args||{};
    if(!['dy','sph','xhs'].includes(platform)||typeof phone!=='string'||!phone.trim()||phone!==phone.trim()||phone.length>80||/[\x00-\x1f\x7f/\\]/.test(phone))throw Error('平台或账号名称无效');
    pending=true;
    try{
      const preview=await request('accountRemovalPreview',{platform,phone});
      if(preview?.ok!==true||preview.platform!==platform||preview.phone!==phone||!/^sha256:[a-f0-9]{64}$/.test(preview.digest||''))throw Error('账号信息已变化，请刷新后重试');
      if(!await confirm(preview))return {canceled:true};
      return await request('removeAccount',{platform,phone,expectedDigest:preview.digest});
    }finally{pending=false;}
  };
}
module.exports={createAccountRemovalHandler};
