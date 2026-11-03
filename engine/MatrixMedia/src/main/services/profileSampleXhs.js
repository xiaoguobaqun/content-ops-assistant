import {createHash} from 'crypto';
import {classifyXhsAuthResponse} from '../../shared/xhsAuth.js';

// 此核心只接受带独立归属证据的页，不把“本人接口”名称当作归属证明。
// 现有线上响应没有可靠的 ownerId 提取契约，故尚未接入任何实际请求。
export async function collectXhsProfilePages({auth,fetchPage,limit=20,signal}={}) {
  const failed = reason => ({ok:false,identity:{verified:false,ownerHash:null},works:[],overview:null,coverage:{limit,returned:0,complete:false,reason}});
  if (!Number.isInteger(limit) || limit<1 || limit>20 || typeof fetchPage!=='function') return failed('invalid_arguments');
  if (signal?.aborted) return failed('cancelled');
  const verdict=classifyXhsAuthResponse(auth || {});
  if (!verdict.ok || verdict.loggedIn!==true) return failed('identity_unverified');
  const owner=auth.expectedUserId;
  const works=[],seenIds=new Set(),seenPages=new Set();
  let page=0,complete=false,reason='page_limit';
  const metric=value => typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
  try {
    for (let count=0;count<3;count++) {
      if (signal?.aborted) return failed('cancelled');
      if (seenPages.has(page)) return failed('invalid_pagination');
      seenPages.add(page);
      const result=await fetchPage(page,signal);
      if (signal?.aborted) return failed('cancelled');
      if (!result || result.ownerId!==owner) return failed('identity_unverified');
      if (!Array.isArray(result.notes) || !Number.isInteger(result.nextPage) || result.nextPage < -1) return failed('invalid_page');
      const remaining=limit-works.length;
      for (const note of result.notes) {
        if (works.length===limit) {reason='limit';break;}
        if (typeof note?.id!=='string' || !note.id || seenIds.has(note.id)) return failed('invalid_work');
        seenIds.add(note.id);
        works.push({id:note.id,title:typeof note.display_title==='string'?note.display_title:'',description:null,publishedAt:null,metrics:{play:metric(note.view_count),like:metric(note.likes),comment:metric(note.comments_count),share:metric(note.shared_count),favorite:metric(note.collected_count)}});
      }
      if (result.notes.length>remaining) {reason='limit';break;}
      if (result.nextPage===-1) {complete=true;reason='end';break;}
      if (works.length===limit) {reason='limit';break;}
      page=result.nextPage;
    }
  } catch { return failed(signal?.aborted?'cancelled':'page_failed'); }
  return {ok:true,identity:{verified:true,ownerHash:'sha256:'+createHash('sha256').update('xhs:'+owner).digest('hex')},account:{nickname:null,bio:null},works,overview:null,coverage:{limit,returned:works.length,complete,reason}};
}
