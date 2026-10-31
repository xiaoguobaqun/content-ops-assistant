"use strict";

import {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getVideoLinkTypeCapability,
  normalizeVideoLinkValue,
  validateVideoLinkValue,
} from "./videoLink.js";

/**
 * 视频号「小程序短剧」挂载能力。
 * 与 videoProduct.js 同构：CLI / HTTP / MCP 只依赖这里的规范化与校验，
 * 真正的页面自动化在 main/services/upLoad/sphDrama.js。
 */
export function getVideoDramaCapability(platform) {
  const capability = getVideoLinkTypeCapability(
    platform,
    VIDEO_LINK_TYPES.MINI_DRAMA
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

export function platformSupportsVideoDrama(platform) {
  const capability = getVideoDramaCapability(platform);
  return Boolean(capability && capability.implemented);
}

export function normalizeVideoDramaId(value) {
  return normalizeVideoLinkValue(value);
}

export function validateVideoDramaId(value) {
  const normalized = normalizeVideoDramaId(value);
  // 空值表示未配置短剧；真正启用时由 validateVideoLinkValue 强制非空。
  if (!normalized) return { ok: true, dramaId: "" };
  const checked = validateVideoLinkValue(
    "视频号",
    VIDEO_LINK_TYPES.MINI_DRAMA,
    normalized
  );
  return checked.ok
    ? { ok: true, dramaId: checked.value }
    : { ok: false, dramaId: checked.value, error: checked.error };
}

export function buildVideoDramaOption(platform, value) {
  if (!platformSupportsVideoDrama(platform)) {
    return {
      ok: true,
      value: {
        enabled: false,
        type: "video_drama",
        selectionMode: "drama_id",
        dramaId: "",
        failurePolicy: "save_draft",
      },
    };
  }
  const link = buildVideoLinkOption(
    platform,
    VIDEO_LINK_TYPES.MINI_DRAMA,
    value
  );
  if (!link.ok) {
    return {
      ok: false,
      dramaId: link.value,
      error: link.error,
    };
  }
  return {
    ok: true,
    value: {
      enabled: link.value.enabled,
      type: "video_drama",
      selectionMode: "drama_id",
      dramaId: link.value.value,
      failurePolicy: "save_draft",
    },
  };
}
