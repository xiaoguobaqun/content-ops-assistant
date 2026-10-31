// 通过比例文案关联唯一封面槽，拒绝落到另一个方向或 AI 参考图。
export function inspectDyCoverSlot({orientation,click=false}) {
  const norm=s=>String(s||'').replace(/\s+/g,'');
  const label=orientation==='vertical'?'竖封面3:4':'横封面4:3';
  const other=orientation==='vertical'?'横封面4:3':'竖封面3:4';
  const labels=Array.from(document.querySelectorAll('div,span,p')).filter(e=>norm(e.textContent)===label&&!Array.from(e.children).some(c=>norm(c.textContent)===label));
  if(labels.length!==1)return {found:false,src:''};
  let root=labels[0].parentElement;
  for(let depth=0;root&&depth<6;depth++,root=root.parentElement){
    if(norm(root.textContent).includes(other))break;
    const images=Array.from(root.querySelectorAll('img'));
    const actions=Array.from(root.querySelectorAll('div,span,button')).filter(e=>['选择封面','编辑封面'].includes(norm(e.textContent)));
    if(images.length>1)break;
    if(!images.length&&!actions.length)continue;
    if(click){
      const action=actions.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0] || images[0]?.parentElement;
      if(!action)return {found:false,src:''};action.click();
    }
    return {found:true,src:(images[0]?.src||'').replace(/[?#].*$/,'')};
  }
  return {found:false,src:''};
}
