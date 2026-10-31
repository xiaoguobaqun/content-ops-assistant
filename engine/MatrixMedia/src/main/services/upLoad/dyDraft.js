export function inspectDyRecoveredDraft(expected) {
  const norm = text => String(text || "").replace(/[\u200B\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const title = document.querySelector(".semi-input");
  const description = document.querySelector(".zone-container.editor-kit-container");
  const hasVideo = Array.from(document.querySelectorAll("video")).some(v => /douyin\.com/.test(v.currentSrc || v.getAttribute("src") || ""));
  const coverId = src => String(src || "").replace(/[?#].*$/, "");
  const images = Array.from(document.querySelectorAll("[class*='cover'] img,[class*='Cover'] img")).map(img=>coverId(img.src));
  const cover = !expected.coverSrcs.length ? !expected.requireCover : expected.coverSrcs.map(coverId).every(src=>images.includes(src));
  const label = {private:"仅自己可见",friends:"好友可见",public:"公开"}[expected.visibility];
  const visibility = !label || Array.from(document.querySelectorAll("label")).some(el => norm(el.textContent) === label && el.querySelector("input") && el.querySelector("input").checked);
  const titleMatches = !!title && norm(title.value) === norm(expected.title);
  const descriptionMatches = !!description && norm(description.innerText) === norm(expected.description);
  return { ok: titleMatches && descriptionMatches && hasVideo && cover && visibility, hasVideo, cover, visibility, titleMatches, descriptionMatches };
}

// 打开草稿会进入编辑态；核验后原样暂存，保持下次仍有「继续编辑」。不重新上传、不发布作品。
export async function preserveDyDraft(page) {
  const available=()=>Array.from(document.querySelectorAll('button,a,span,div')).some(e=>e.getBoundingClientRect().width>0&&(e.textContent||'').trim()==='继续编辑');
  if(await page.evaluate(available))return;
  const button=await page.waitForSelector('#popover-tip-container+button',{timeout:15000});
  if(!await page.evaluate(el=>/^(暂存离开|存草稿|保存草稿)$/.test((el.textContent||'').trim()),button))throw Error('未确认草稿暂存按钮，停止操作');
  await button.click({delay:200});
  try { await page.waitForFunction(available,{timeout:15000}); }
  catch (_) {
    // 暂存可能不跳转；只有目标状态明确存在才确认保存。导航被平台自身跳转取消时继续等该状态。
    try { await page.goto('https://creator.douyin.com/creator-micro/home',{waitUntil:'domcontentloaded'}); }
    catch(e) { if(!String(e.message).includes('ERR_ABORTED'))throw e; }
    await page.waitForFunction(available,{timeout:30000});
  }
}

export async function verifyAndPreserveDyDraft(page,expected,{capture}={}) {
  let evidence, failure, preserved=false;
  try { evidence=await recoverDyDraft(page,expected); if(capture)await capture(); }
  catch(error) { failure=error;evidence=error.evidence||evidence; }
  try {
    const editor=await page.evaluate(()=>!!document.querySelector('.semi-input')&&document.querySelectorAll('video').length>0);
    if(editor){await preserveDyDraft(page);preserved=true;}
  }catch(error){if(!failure)failure=error;}
  if(failure||!preserved){
    const error=failure||Error('草稿核验后未确认重新暂存');
    error.evidence={...evidence,preserved};throw error;
  }
  return {...evidence,preserved};
}

export async function recoverDyDraft(page, expected) {
  await page.goto("https://creator.douyin.com/creator-micro/home", {waitUntil:"domcontentloaded"});
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button,a,span,div")).some(el => el.getBoundingClientRect().width > 0 && (el.textContent || "").trim() === "继续编辑"), {timeout:30000});
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button,a,span,div")).filter(el => el.getBoundingClientRect().width > 0 && (el.textContent || "").trim() === "继续编辑");
    if (!els.length) return false;
    els.sort((a,b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0].click();
    return true;
  });
  if (!clicked) throw Error("未找到草稿恢复入口");
  const deadline = Date.now() + (expected.timeoutMs || 45000);
  let evidence;
  do {
    try { evidence = await page.evaluate(inspectDyRecoveredDraft, expected); }
    catch(e) { if(!/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(e.message))throw e; }
    if (evidence && evidence.ok) return { ...evidence, recoveredAt: Date.now(), url: page.url() };
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);
  const error = Error("草稿恢复内容未核实");
  error.evidence = evidence;
  throw error;
}
