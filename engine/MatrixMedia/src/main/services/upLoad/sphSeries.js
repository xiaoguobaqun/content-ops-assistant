"use strict";

import { validateVideoSeriesId } from "../../../shared/videoSeries.js";
import {
  SPH_LINK_ACTION_TIMEOUT_MS,
  createSphEntityAttacher,
  normalizeEntityText,
  resolveEntityRowKey,
  resolveMenuLabel,
} from "./sphEntityLink.js";

export { SPH_LINK_ACTION_TIMEOUT_MS };

/**
 * 视频号「剧集」挂载配置（视频号原生剧集，区别于小程序短剧）。
 *
 * 流程与 sphDrama.js 完全一致，共用 sphEntityLink.js 的工厂。
 * 平台改版时只需调整下面的常量。
 */

/** 链接类型菜单文案候选（按优先级匹配，比较时忽略空白） */
export const SERIES_LINK_LABELS = ["视频号剧集", "剧集"];

/** 选择弹窗标题关键词 */
export const SERIES_DIALOG_HINTS = [
  "选择需要关联的视频号剧集",
  "需要关联",
  "视频号剧集",
];

/** 弹窗内搜索框 placeholder 关键词（剧集弹窗为通用的「搜索内容」） */
export const SERIES_SEARCH_INPUT_HINTS = [
  "搜索内容",
  "请输入剧集名称",
  "剧集名称",
  "搜索剧集",
];

/** 弹窗主按钮文案候选 */
export const SERIES_PRIMARY_BUTTON_LABELS = ["确定", "添加", "完成", "确认"];

export const normalizeSeriesText = normalizeEntityText;

/** 从页面实际菜单文案里挑出命中的剧集选项（纯函数，便于单测） */
export function resolveSeriesMenuLabel(
  actualLabels,
  candidates = SERIES_LINK_LABELS
) {
  return resolveMenuLabel(actualLabels, candidates);
}

/** 从弹窗候选行里按名称挑出目标行（纯函数，便于单测） */
export function resolveSeriesRowKey(rows, seriesId) {
  return resolveEntityRowKey(rows, seriesId);
}

const seriesAttacher = createSphEntityAttacher({
  kind: "series",
  errorPrefix: "series",
  entityLabel: "剧集",
  idField: "seriesId",
  titleField: "seriesTitle",
  menuLabels: SERIES_LINK_LABELS,
  dialogHints: SERIES_DIALOG_HINTS,
  searchInputHints: SERIES_SEARCH_INPUT_HINTS,
  primaryButtonLabels: SERIES_PRIMARY_BUTTON_LABELS,
  validateId: validateVideoSeriesId,
});

/**
 * 视频号挂载剧集
 * @param {import("puppeteer-core").Page} page
 * @param {{ enabled?: boolean, seriesId?: string }} option
 * @returns {Promise<{ seriesId: string, seriesTitle: string } | null>}
 */
export const attachSphVideoSeries = seriesAttacher.attach;
