"use strict";

import {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getVideoLinkTypeCapability,
  normalizeVideoLinkValue,
  validateVideoLinkValue,
} from "./videoLink.js";

/**
 * 视频号「剧集」挂载能力（视频号原生剧集，区别于小程序短剧）。
 * 与 videoDrama.js 同构：CLI / HTTP / MCP 只依赖这里的规范化与校验，
 * 真正的页面自动化在 main/services/upLoad/sphSeries.js（由 sphEntityLink.js 工厂生成）。
 */
export function getVideoSeriesCapability(platform) {
  const capability = getVideoLinkTypeCapability(
    platform,
    VIDEO_LINK_TYPES.SPH_SERIES
  );
  if (!capability) return null;
  return {
    implemented: capability.automationSupported,
    maxItems: 1,
    selectionMode: capability.selectionMode,
    placeholder: capability.placeholder,
    maxLength: capability.maxLength,
  };
}

export function platformSupportsVideoSeries(platform) {
  const capability = getVideoSeriesCapability(platform);
  return Boolean(capability && capability.implemented);
}

export function normalizeVideoSeriesId(value) {
  return normalizeVideoLinkValue(value);
}

export function validateVideoSeriesId(value) {
  const normalized = normalizeVideoSeriesId(value);
  // 空值表示未配置剧集；真正启用时由 validateVideoLinkValue 强制非空。
  if (!normalized) return { ok: true, seriesId: "" };
  const checked = validateVideoLinkValue(
    "视频号",
    VIDEO_LINK_TYPES.SPH_SERIES,
    normalized
  );
  return checked.ok
    ? { ok: true, seriesId: checked.value }
    : { ok: false, seriesId: checked.value, error: checked.error };
}

export function buildVideoSeriesOption(platform, value) {
  if (!platformSupportsVideoSeries(platform)) {
    return {
      ok: true,
      value: {
        enabled: false,
        type: "video_series",
        selectionMode: "series_id",
        seriesId: "",
        failurePolicy: "save_draft",
      },
    };
  }
  const link = buildVideoLinkOption(
    platform,
    VIDEO_LINK_TYPES.SPH_SERIES,
    value
  );
  if (!link.ok) {
    return {
      ok: false,
      seriesId: link.value,
      error: link.error,
    };
  }
  return {
    ok: true,
    value: {
      enabled: link.value.enabled,
      type: "video_series",
      selectionMode: "series_id",
      seriesId: link.value.value,
      failurePolicy: "save_draft",
    },
  };
}
