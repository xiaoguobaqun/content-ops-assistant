/** 此函数会在平台页面内执行，不能引用模块闭包。 */
export function inspectDyVisibility({ label, click = false }) {
  const norm = value => String(value || "").replace(/\s+/g, "");
  const candidates = Array.from(document.querySelectorAll("label")).filter(
    el => norm(el.textContent) === norm(label)
  );
  if (candidates.length !== 1) return { found: false, checked: false };
  const el = candidates[0];
  const input = el.querySelector('input[type="radio"],input[type="checkbox"]');
  if (!input || input.disabled) return { found: false, checked: false };
  if (click && !input.checked) el.click();
  return { found: true, checked: input.checked === true };
}

/** 只有读回正确的选中项后，调用方才可进入提交边界。 */
export async function setDyVisibility(page, visibility, { timeoutMs = 8000 } = {}) {
  if (visibility == null) return;
  const label = { private: "仅自己可见", friends: "好友可见", public: "公开" }[visibility];
  if (!label) throw new Error("无效的抖音可见范围");
  const selected = await page.evaluate(inspectDyVisibility, { label, click: true });
  if (!selected.found) throw new Error(`找不到可用的可见范围控件：${label}`);
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await page.evaluate(inspectDyVisibility, { label });
    if (result.found && result.checked) return;
    await page.waitForTimeout(Math.min(100, timeoutMs));
  } while (Date.now() < deadline);
  throw new Error(`无法确认可见范围已设为${label}，停止提交`);
}
