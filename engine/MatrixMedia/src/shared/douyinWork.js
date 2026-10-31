// 作品编号不能经过浮点转换，否则 19 位编号会丢失精度。
export function validDouyinWorkId(value) {
  return typeof value === "string" && /^\d{10,24}$/.test(value);
}

export function matchDouyinWork(input) {
  const { works = [], workId, title, description, visibility } = input;
  const unknown = (reason) => ({ status: "unknown", reason });
  if (workId != null && !validDouyinWorkId(workId)) return unknown("invalid_work_id");
  let candidates = works.filter((w) => validDouyinWorkId(w.workId));
  if (workId) {
    candidates = candidates.filter((w) => w.workId === workId);
  } else {
    if (!input.complete || !input.baselineComplete || !Array.isArray(input.baselineIds)) return unknown("incomplete_list");
    if (!Number.isFinite(input.since) || !Number.isFinite(input.now)) return unknown("missing_time_window");
    const old = new Set(input.baselineIds);
    candidates = candidates.filter((w) => !old.has(w.workId) && Number.isFinite(w.publishTime) && w.publishTime > 0 && w.publishTime >= input.since && w.publishTime <= input.now);
  }
  candidates = candidates.filter(w => {
    if (typeof w.combinedText === "string" && title != null && description != null) return w.combinedText === [title, description].filter(Boolean).join(" ");
    return (title == null || w.title === title) && (description == null || w.description === description);
  });
  if (visibility != null) candidates = candidates.filter((w) => w.visibility === visibility);
  return candidates.length === 1 ? { status: "confirmed", work: candidates[0] } : unknown(candidates.length > 1 ? "ambiguous" : "not_found_or_not_verified");
}
