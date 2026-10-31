const SAVE_LABEL='暂存离开';
const walk=node=>[node,...(node.children||[]).flatMap(walk),...(node.shadowRoots||[]).flatMap(walk)];

/** 只取closed shadow tree中真实按钮；坐标由该按钮当次几何计算，不使用偏移或重试。 */
export async function clickXhsSaveOnce(page,{checkCancelled=()=>{},beforeClick=async()=>{}}={}){
  checkCancelled();const client=await page.target().createCDPSession();
  try{
    await client.send('DOM.enable');const {root}=await client.send('DOM.getDocument',{depth:-1,pierce:true});
    const hosts=walk(root).filter(n=>n.nodeName==='XHS-PUBLISH-BTN');if(hosts.length!==1)throw Error('未找到唯一小红书暂存宿主');
    const attrs=Object.fromEntries((hosts[0].attributes||[]).reduce((a,v,i,all)=>i%2?a:[...a,[v,all[i+1]]],[]));
    if(attrs['save-text']!==SAVE_LABEL||attrs['save-disabled']!=='false'||attrs['is-save-draft']!=='true')throw Error('小红书暂存状态未确认可用');
    const candidates=[];
    for(const n of walk(hosts[0]).filter(n=>n.nodeName==='BUTTON')){
      const {object}=await client.send('DOM.resolveNode',{backendNodeId:n.backendNodeId});
      const {result}=await client.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return (this.textContent||"").replace(/\\s+/g," ").trim();}',returnByValue:true});
      if(result.value===SAVE_LABEL)candidates.push({node:n,objectId:object.objectId});
    }
    if(candidates.length!==1)throw Error('未找到唯一真实暂存按钮');const target=candidates[0];
    const {nodes:ax}=await client.send('Accessibility.getPartialAXTree',{backendNodeId:target.node.backendNodeId,fetchRelatives:false});
    const button=ax.find(n=>n.role?.value==='button'&&n.name?.value===SAVE_LABEL);if(!button||button.properties?.some(p=>p.name==='disabled'&&p.value?.value===true))throw Error('暂存按钮可访问身份或禁用状态不匹配');
    await client.send('DOM.scrollIntoViewIfNeeded',{backendNodeId:target.node.backendNodeId});
    const inspect=async()=>{
      const {result}=await client.send('Runtime.callFunctionOn',{objectId:target.objectId,functionDeclaration:'function(){const r=this.getBoundingClientRect(),s=getComputedStyle(this);return {enabled:!this.disabled&&this.getAttribute("aria-disabled")!=="true"&&s.display!=="none"&&s.visibility!=="hidden"&&s.pointerEvents!=="none"&&r.width>0&&r.height>0,text:(this.textContent||"").replace(/\\s+/g," ").trim(),x:r.x+r.width/2,y:r.y+r.height/2};}',returnByValue:true});
      if(result.value?.enabled!==true||result.value.text!==SAVE_LABEL)throw Error('暂存按钮不可用');return result.value;
    };
    const box=await inspect(),point={x:Math.round(box.x),y:Math.round(box.y)};
    const assertHit=async()=>{
      const hit=await client.send('DOM.getNodeForLocation',{...point,includeUserAgentShadowDOM:true,ignorePointerEventsNone:false});const {object:hitObject}=await client.send('DOM.resolveNode',{backendNodeId:hit.backendNodeId});
      const {result:matched}=await client.send('Runtime.callFunctionOn',{objectId:target.objectId,arguments:[{objectId:hitObject.objectId},{value:point.x},{value:point.y}],functionDeclaration:'function(hit,x,y){if(hit===this||this.contains(hit))return true;const root=this.getRootNode();if(root.host!==hit||!root.elementFromPoint)return false;const inner=root.elementFromPoint(x,y);return inner===this||this.contains(inner);}',returnByValue:true});
      if(matched.value!==true)throw Error('小红书暂存按钮被遮挡或命中身份不匹配');
    };
    await assertHit();
    await beforeClick();checkCancelled();const fresh=await inspect();if(Math.abs(fresh.x-box.x)>1||Math.abs(fresh.y-box.y)>1)throw Error('暂存按钮位置发生变化，停止提交');
    await assertHit();checkCancelled();
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  }finally{await client.detach().catch(()=>{});}
}
export function createXhsSaveAction(page,options){
  let attempted=false;return async()=>{if(attempted)throw Error('禁止再次点击小红书暂存');attempted=true;return clickXhsSaveOnce(page,options);};
}
