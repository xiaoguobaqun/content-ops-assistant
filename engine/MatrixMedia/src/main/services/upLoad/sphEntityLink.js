"use strict";

import {
  SPH_LINK_ACTION_TIMEOUT_MS,
  clearSphOverlaysForFooter,
  dumpSphLinkDiagnostics,
  ensureSphLinkType,
  openSphLinkChooser,
  pollSphPageUntil,
  sphLinkError,
} from "./sphLinkDom.js";

export { SPH_LINK_ACTION_TIMEOUT_MS };

/**
 * 视频号「按名称挂载实体」的自动化工厂。
 *
 * 小程序短剧（sphDrama.js）与视频号剧集（sphSeries.js）是同一条流程：
 * 链接类型菜单选中文案 → 打开选择弹窗 → 按名称搜索 → 选行 → 回显校验。
 * 差异只在文案候选与校验函数，因此抽成工厂，避免每个类型复制一份流程。
 *
 * 约束：下面「浏览器端」函数会被 page.evaluate 序列化后执行，不能引用模块作用域。
 */

/** 归一化页面文案（去所有空白字符） */
export function normalizeEntityText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "");
}

/** 从页面实际菜单文案里挑出命中的候选选项（纯函数，便于单测） */
export function resolveMenuLabel(actualLabels, candidates) {
  const normalized = (Array.isArray(actualLabels) ? actualLabels : []).map(
    normalizeEntityText
  );
  const list = Array.isArray(candidates) ? candidates : [];
  return (
    list
      .map(normalizeEntityText)
      .find((label) => normalized.includes(label)) || ""
  );
}

/** 从弹窗候选行里按名称挑出目标行（纯函数；先匹配 data-row-key，再匹配文本包含） */
export function resolveEntityRowKey(rows, entityId) {
  const id = String(entityId == null ? "" : entityId).trim();
  if (!id) return null;
  const list = Array.isArray(rows) ? rows : [];
  const byKey = list.find((row) => String((row && row.key) || "") === id);
  if (byKey) return byKey;
  return (
    list.find((row) => String((row && row.text) || "").includes(id)) || null
  );
}

/* ------------------------------------------------------------------ *
 * 浏览器端函数（page.evaluate 序列化执行，仅依赖参数与浏览器全局）
 * ------------------------------------------------------------------ */

/** 浏览器端：发布页当前已挂载内容的展示名 */
export function entityChosenName() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const node = root.querySelector(
    ".post-with-link .post-component-choose-wrap .choose-content .name"
  );
  const name = String((node && node.textContent) || "").trim();
  return { ok: Boolean(name), name };
}

/** 浏览器端：目标弹窗是否已就绪（可见且搜索框已渲染），用于替代盲等 */
export function entityDialogReady(payload) {
  const hints = (payload && payload.hints) || [];
  const dialogHints = (payload && payload.dialogHints) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialogText = (item) =>
    String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (dialogHints.length
      ? dialogs.find((item) =>
          dialogHints.some((hint) => dialogText(item).includes(hint))
        )
      : null) ||
    dialogs[dialogs.length - 1] ||
    null;
  if (!dialog) return { ok: false, reason: "dialog_not_found" };
  const input = Array.from(dialog.querySelectorAll("input")).find((item) => {
    const placeholder = String(item.getAttribute("placeholder") || "");
    return hints.some((hint) => placeholder.includes(hint));
  });
  if (!input) return { ok: false, reason: "search_input_not_ready" };
  return { ok: true };
}

/** 浏览器端：在弹窗搜索框填写内容并触发搜索（独立搜索按钮存在则点一下）。
 * dialogHints 用于从多个可见弹窗中定位目标弹窗（发布页常驻多个常显弹窗，
 * 不能直接用“最后一个可见弹窗”）。 */
export function fillEntityDialogSearch(payload) {
  const hints = payload && payload.hints ? payload.hints : [];
  const dialogHints = (payload && payload.dialogHints) || [];
  const value = String((payload && payload.value) || "");
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  // 弹窗可见性必须沿祖先链检查：隐藏弹窗自身 computed display 仍是
  // inline-block，只有祖先 .weui-desktop-dialog__wrp 是 display:none。
  // 发布页常驻 30+ 个残留弹窗实例，不这样判断会误选中隐藏实例。
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialogText = (item) =>
    String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (dialogHints.length
      ? dialogs.find((item) =>
          dialogHints.some((hint) => dialogText(item).includes(hint))
        )
      : null) ||
    dialogs[dialogs.length - 1] ||
    null;
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  // 只在「可见」输入框里挑：同一弹窗内存在多个隐藏面板的输入框
  // （例如剧集弹窗里隐藏的小游戏/小程序/短剧搜索框，占位符各不相同但
  // 通用的「搜索内容」会出现多次），不筛可见性会填错到隐藏输入框上。
  const visibleInput = (input) => {
    let node = input;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(dialog.querySelectorAll("input")).filter(
    (input) =>
      String(input.getAttribute("type") || "text") !== "radio" &&
      String(input.getAttribute("type") || "text") !== "number" &&
      visibleInput(input)
  );
  let input = null;
  // 按 hints 的优先级顺序匹配 placeholder（顺序即优先级）
  for (const hint of hints) {
    input = candidates.find((item) =>
      String(item.getAttribute("placeholder") || "").includes(hint)
    );
    if (input) break;
  }
  if (!input) {
    input =
      dialog.querySelector(
        ".search-wrap input, .search input, .weui-desktop-search input, .ant-input"
      ) ||
      candidates[0] ||
      null;
  }
  if (!input) return { ok: false, reason: "search_input_not_found" };

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // 有独立搜索按钮就点一下；没有则依赖 input 触发的联想搜索
  const button =
    dialog.querySelector(".search-btn button") ||
    Array.from(dialog.querySelectorAll("button")).find((item) =>
      /^(搜索|查询)$/.test(String(item.textContent || "").replace(/\s+/g, ""))
    );
  if (button) button.click();
  return {
    ok: true,
    placeholder: String(input.getAttribute("placeholder") || ""),
    searched: Boolean(button),
  };
}

/** 浏览器端：按名称选中弹窗内的目标行并读取标题（先精确 data-row-key，再文本包含） */
export function selectEntityDialogRowById(payload) {
  const id = String((payload && payload.id) || "");
  const dialogHints = (payload && payload.dialogHints) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  // 沿祖先链判断可见性（详见 fillEntityDialogSearch 中的说明）
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialogText = (item) =>
    String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (dialogHints.length
      ? dialogs.find((item) =>
          dialogHints.some((hint) => dialogText(item).includes(hint))
        )
      : null) ||
    dialogs[dialogs.length - 1] ||
    null;
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(id) : id;
  // antd 表格会为固定列渲染一份隐藏克隆行（同一部短剧出现两次），
  // 必须优先选"真正可见"的那一行，否则点击落在隐藏克隆上不生效。
  const rowVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(
    dialog.querySelectorAll(
      "tr, .ant-table-row, .list-item, .drama-item, .card-item, li"
    )
  ).filter((item) => String(item.textContent || "").includes(id));
  const byKey = dialog.querySelector(`[data-row-key="${escaped}"]`);
  const row =
    (byKey && rowVisible(byKey) ? byKey : null) ||
    candidates.find(rowVisible) ||
    byKey ||
    candidates[0] ||
    null;
  if (!row) return { ok: false, reason: "row_not_found" };

  const clickable =
    row.querySelector("input.ant-radio-input, input.ant-checkbox-input") ||
    row.querySelector(".title, .name, .commodity-info-wrap") ||
    row;
  clickable.click();

  // 注意：这里不能同步校验选中结果。Vue 的响应式更新是异步的（nextTick），
  // 点击瞬间「确定」按钮的禁用 class 尚未更新，同步断言必然失败并导致上层
  // 反复重点。选中与否交给下一步的轮询判断。
  const titleNode = row.querySelector(
    ".commodity-info-wrap .title, .title, .name"
  );
  const title = String(
    (titleNode && titleNode.textContent) ||
      String(row.textContent || "").replace(/\s+/g, " ").trim()
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { ok: true, title };
}

/** 浏览器端：点击弹窗主按钮（添加 / 确定 / 完成） */
export function clickEntityDialogPrimary(payload) {
  const labels = (payload && payload.labels) || [];
  const dialogHints = (payload && payload.dialogHints) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialogText = (item) =>
    String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (dialogHints.length
      ? dialogs.find((item) =>
          dialogHints.some((hint) => dialogText(item).includes(hint))
        )
      : null) ||
    dialogs[dialogs.length - 1] ||
    null;
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  // 按 labels 的优先级顺序找按钮：不能按 DOM 顺序 find，
  // 否则会先命中排在「确定」前面的「添加」。
  const buttons = Array.from(
    dialog.querySelectorAll("button, .weui-desktop-btn")
  );
  let target = null;
  for (const label of labels) {
    target = buttons.find((button) => {
      const text = String(button.textContent || "").replace(/\s+/g, "");
      return new RegExp(`^${label}(\\(\\d+\\))?$`).test(text);
    });
    if (target) break;
  }
  if (!target) return { ok: false, reason: "primary_button_not_found" };
  if (
    target.disabled ||
    target.classList.contains("weui-desktop-btn_disabled")
  ) {
    return { ok: false, reason: "primary_button_disabled" };
  }
  target.focus();
  target.click();
  return { ok: true };
}

/** 浏览器端：关闭「选择短剧/剧集出现时机」附加弹窗（选完内容后平台常弹出，
 * 默认「视频开始播放出现」已选中，直接点确认）。找不到该弹窗视为成功（可选步骤）。 */
export function clickEntityTimingConfirm() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialog = dialogs.find((item) =>
    /出现时机/.test(String(item.textContent || ""))
  );
  if (!dialog) return { ok: false, reason: "timing_dialog_not_found" };
  const button = Array.from(dialog.querySelectorAll("button")).find(
    (item) => String(item.textContent || "").replace(/\s+/g, "") === "确认"
  );
  if (!button) return { ok: false, reason: "timing_confirm_not_found" };
  button.click();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * 工厂
 * ------------------------------------------------------------------ */

/**
 * @param {object} config
 * @param {string} config.kind            日志前缀，如 drama / series
 * @param {string} config.errorPrefix     错误码前缀，如 drama / series
 * @param {string} config.entityLabel     中文名：短剧 / 剧集
 * @param {string} config.idField         返回对象字段：dramaId / seriesId
 * @param {string} config.titleField      返回对象标题字段：dramaTitle / seriesTitle
 * @param {string[]} config.menuLabels    链接类型菜单文案候选
 * @param {string[]} config.dialogHints   选择弹窗标题关键词
 * @param {string[]} config.searchInputHints 弹窗搜索框 placeholder 关键词
 * @param {string[]} config.primaryButtonLabels 确认按钮文案候选
 * @param {(value: string) => { ok: boolean, error?: string }} config.validateId 名称校验
 */
export function createSphEntityAttacher(config) {
  const {
    kind,
    errorPrefix,
    entityLabel,
    idField,
    titleField,
    menuLabels,
    dialogHints,
    searchInputHints,
    primaryButtonLabels,
    validateId,
  } = config || {};

  function entityError(suffix, message) {
    return sphLinkError(`${errorPrefix}_${suffix}`, message);
  }

  async function searchEntity(page, entityId) {
    const filled = await page
      .evaluate(fillEntityDialogSearch, {
        dialogHints,
        hints: searchInputHints,
        value: entityId,
      })
      .catch(() => null);
    if (!filled || !filled.ok) {
      await dumpSphLinkDiagnostics(page, `${kind}-search`, dialogHints);
      throw entityError(
        "search_input_not_found",
        `未找到视频号${entityLabel}搜索框，无法按名称搜索`
      );
    }
    console.log(
      `[sph][${kind}] 搜索框 placeholder=${filled.placeholder} 触发搜索=${filled.searched}`
    );
    return filled;
  }

  async function selectEntityRow(page, entityId) {
    const selected = await pollSphPageUntil(
      page,
      selectEntityDialogRowById,
      { dialogHints, id: entityId },
      `${entityLabel}列表中未找到「${entityId}」`,
      300
    ).catch(async (error) => {
      await dumpSphLinkDiagnostics(page, `${kind}-row`, dialogHints);
      throw entityError("row_not_found", error.message);
    });
    return selected;
  }

  async function confirmEntityRow(page, title) {
    // 点击候选行即完成挂载，发布页回显会立刻更新；弹窗内的「确定」按钮
    // 在该模式下恒为 disabled（属平台另一种选择模式），且弹窗数秒后自动关闭。
    // 因此成功判据只能是「发布页回显」，「确定」仅在恰好可用时顺手点一下。
    await pollSphPageUntil(
      page,
      clickEntityDialogPrimary,
      { dialogHints, labels: primaryButtonLabels },
      `${entityLabel}已选中，但弹窗「确定」按钮仍不可用`,
      300,
      3000
    ).catch(() => null);

    // 选完内容后平台可能弹「选择出现时机」附加弹窗（默认已选"视频开始播放出现"）
    await pollSphPageUntil(
      page,
      clickEntityTimingConfirm,
      null,
      "出现时机弹窗未自动关闭",
      250,
      4000
    ).catch(() => null);

    await pollSphPageUntil(
      page,
      entityChosenName,
      null,
      `${entityLabel}已提交（${title || "未知名称"}），但发布页未显示已挂${entityLabel}`,
      300
    ).catch(async (error) => {
      await dumpSphLinkDiagnostics(page, `${kind}-attach-verify`, dialogHints);
      throw entityError("not_attached", error.message);
    });
  }

  /**
   * 挂载实体（名称校验 + 完整页面自动化）。
   *
   * 成功 → 返回结果；失败 → 先关闭本流程打开的弹窗，再抛原始错误。
   * 平台只在成功选中后才自动关闭选择弹窗；失败时弹窗遮罩会盖住底部
   * 「保存草稿」按钮，导致下游转存草稿的点击被吞掉。
   *
   * @param {import("puppeteer-core").Page} page
   * @param {{ enabled?: boolean }} option
   * @returns {Promise<object | null>}
   */
  async function attach(page, option = {}) {
    if (!option || option.enabled !== true) return null;

    const checked = validateId(option[idField]);
    if (!checked.ok || !checked[idField]) {
      throw entityError(
        "invalid_id",
        checked.error || `请填写视频号${entityLabel}名称`
      );
    }

    // 从这里开始会打开弹窗，后续任一步失败都要负责清理
    try {
      const matchedLabel = await ensureSphLinkType(page, menuLabels);
      console.log(`[sph][${kind}] 链接类型已选中：${matchedLabel}`);

      await openSphLinkChooser(
        page,
        dialogHints,
        `视频号${entityLabel}选择入口未出现`
      );
      // 弹窗内容区是懒加载的：等搜索框真正渲染出来再操作，替代此前的盲等。
      await pollSphPageUntil(
        page,
        entityDialogReady,
        { hints: searchInputHints, dialogHints },
        `视频号${entityLabel}选择弹窗内容未就绪`,
        300
      ).catch(async (error) => {
        await dumpSphLinkDiagnostics(page, `${kind}-dialog-ready`, dialogHints);
        throw entityError("dialog_not_ready", error.message);
      });
      await searchEntity(page, checked[idField]);
      const row = await selectEntityRow(page, checked[idField]);
      await confirmEntityRow(page, row.title);

      console.log(
        `[sph][${kind}] 已挂载${entityLabel} ${checked[idField]}: ${row.title || ""}`
      );
      return { [idField]: checked[idField], [titleField]: row.title || "" };
    } catch (error) {
      // 失败：清理自己打开的弹窗/遮罩，避免遮挡下游的「保存草稿」按钮。
      // 清场本身失败**不能覆盖原始错误**，只追加到日志，保证诊断信息不丢。
      try {
        const cleared = await clearSphOverlaysForFooter(page);
        console.log(
          `[sph][${kind}] 失败善后: 关闭弹窗=${cleared.closedDialogs} 移除遮罩=${cleared.removedMasks}(强制${cleared.forced}) 底部按钮可点=${cleared.clickable}${
            cleared.reason ? ` (${cleared.reason})` : ""
          }`
        );
      } catch (cleanupError) {
        console.warn(
          `[sph][${kind}] 失败善后清场异常（不影响原始错误上报）: ${
            (cleanupError && cleanupError.message) || cleanupError
          }`
        );
      }
      throw error;
    }
  }

  return { attach };
}
