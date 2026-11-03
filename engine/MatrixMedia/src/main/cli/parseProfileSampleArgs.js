export function parseProfileSampleArgs(args = []) {
  if (!Array.isArray(args)) return { ok:false, error:'参数无效' };
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { ok:true, value:{help:true} };
  if (args.length === 1 && args[0] === '--capabilities') return { ok:true, value:{capabilities:true} };
  const value = {};
  for (let i=0; i<args.length; i++) {
    const key = {'--platform':'platform','--phone':'phone','--limit':'limit'}[args[i]];
    if (!key || Object.prototype.hasOwnProperty.call(value,key) || typeof args[i+1] !== 'string' || args[i+1].startsWith('-')) return {ok:false,error:`参数无效: ${args[i]}`};
    value[key] = args[++i];
  }
  if (!['dy','sph','xhs'].includes(value.platform)) return {ok:false,error:'平台须为 dy、sph 或 xhs'};
  if (!value.phone || !value.phone.trim()) return {ok:false,error:'需要 --phone <账号分组>'};
  value.phone = value.phone.trim();
  if (value.limit === undefined) value.limit = 20;
  else if (!/^(?:[1-9]|1[0-9]|20)$/.test(value.limit)) return {ok:false,error:'--limit 须为 1 到 20 的整数'};
  else value.limit = Number(value.limit);
  return {ok:true,value};
}
export function profileSampleHelpText() {
  return '用法: <应用> cli profile-sample --platform dy|sph|xhs --phone <分组> [--limit 1..20]\n       <应用> cli profile-sample --capabilities\n仅本人账号只读样本；无法核验身份或作品归属时拒绝采集。';
}
