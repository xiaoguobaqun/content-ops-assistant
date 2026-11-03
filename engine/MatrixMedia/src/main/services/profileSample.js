// 现有统计适配器未建立作品响应与本人身份的可靠绑定。默认关闭，绝不回退到弱鉴权。
const REASONS = Object.freeze({
  dy: '现有作品列表未验证作品响应归属与本人身份的绑定。',
  sph: '现有鉴权探测未提供可绑定作品列表的本人标识。',
  xhs: '现有本人鉴权与笔记列表之间尚未验证响应归属绑定。',
});
export function profileSampleCapabilities() {
  return {channel:'profile-sample-capabilities',ok:true,platforms:Object.fromEntries(Object.entries(REASONS).map(([key,reason])=>[key,{available:false,liveVerified:false,reason}]))};
}
export async function sampleProfile({platform,phone,limit=20,signal} = {}) {
  const reason = signal?.aborted ? 'cancelled' : 'identity_unverified';
  return {
    channel:'profile-sample',ok:false,platform,phone,
    identity:{verified:false,ownerHash:null},account:{nickname:null,bio:null},works:[],overview:null,
    coverage:{limit,returned:0,complete:false,reason},collectedAt:Date.now(),
    message:signal?.aborted ? '采样已取消。' : (REASONS[platform] || '不支持的平台。'),
  };
}
