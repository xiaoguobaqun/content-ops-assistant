"use strict";

import { validateVideoDramaId } from "../../../shared/videoDrama.js";
import {
  SPH_LINK_ACTION_TIMEOUT_MS,
  createSphEntityAttacher,
  normalizeEntityText,
  resolveEntityRowKey,
  resolveMenuLabel,
} from "./sphEntityLink.js";

export { SPH_LINK_ACTION_TIMEOUT_MS };

/**
 * 视频号「小程序短剧」挂载配置。
 *
 * 流程由 sphEntityLink.js 的工厂统一实现，这里只配置短剧专属的
 * 文案候选与校验函数。平台改版时只需调整下面的常量。
 */

/** 链接类型菜单文案候选（按优先级匹配，比较时忽略空白） */
export const DRAMA_LINK_LABELS = ["小程序短剧", "微短剧", "短剧"];

/** 选择弹窗标题关键词（发布页常驻多个弹窗，须按标题定位） */
export const DRAMA_DIALOG_HINTS = ["选择需要关联的短剧", "需要关联"];

/** 弹窗内搜索框 placeholder 关键词（按名称搜索；具体文案放前面，避免误中其他面板） */
export const DRAMA_SEARCH_INPUT_HINTS = [
  "请输入短剧名称",
  "短剧名称",
  "请输入短剧",
  "搜索短剧",
];

/** 弹窗主按钮文案候选 */
export const DRAMA_PRIMARY_BUTTON_LABELS = ["确定", "添加", "完成", "确认"];

export const normalizeMenuText = normalizeEntityText;

/** 从页面实际菜单文案里挑出命中的短剧选项（纯函数，便于单测） */
export function resolveDramaMenuLabel(
  actualLabels,
  candidates = DRAMA_LINK_LABELS
) {
  return resolveMenuLabel(actualLabels, candidates);
}

/** 从弹窗候选行里按名称挑出目标行（纯函数，便于单测） */
export function resolveDramaRowKey(rows, dramaId) {
  return resolveEntityRowKey(rows, dramaId);
}

const dramaAttacher = createSphEntityAttacher({
  kind: "drama",
  errorPrefix: "drama",
  entityLabel: "短剧",
  idField: "dramaId",
  titleField: "dramaTitle",
  menuLabels: DRAMA_LINK_LABELS,
  dialogHints: DRAMA_DIALOG_HINTS,
  searchInputHints: DRAMA_SEARCH_INPUT_HINTS,
  primaryButtonLabels: DRAMA_PRIMARY_BUTTON_LABELS,
  validateId: validateVideoDramaId,
});

/**
 * 视频号挂载小程序短剧
 * @param {import("puppeteer-core").Page} page
 * @param {{ enabled?: boolean, dramaId?: string }} option
 * @returns {Promise<{ dramaId: string, dramaTitle: string } | null>}
 */
export const attachSphVideoMiniDrama = dramaAttacher.attach;
