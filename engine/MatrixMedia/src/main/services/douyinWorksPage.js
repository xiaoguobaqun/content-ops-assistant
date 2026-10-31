// 完全在平台页执行，不导出登录凭证、不生成签名；只调用已有的只读作品接口。
export async function collectDyWorksInPage() {
  const out = { works: [], complete: false };
  const seen = new Set();
  const cursors = new Set();
  let cursor = "0";
  try {
    for (let page = 0; page < 50; page++) {
      if (cursors.has(String(cursor))) throw Error("repeated_cursor");
      cursors.add(String(cursor));
      const res = await fetch("/janus/douyin/creator/pc/work_list?scene=star_atlas&device_platform=android&status=0&count=12&max_cursor=" + encodeURIComponent(cursor) + "&aid=1128&support_h265=1", { credentials: "include", signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw Error("work_list_http");
      // 在 JSON.parse 前保留长整数；同时匹配完整字符串以免改写文案里的数字。
      const raw = await res.text();
      const j = JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => /^-?\d{16,}$/.test(token) ? JSON.stringify(token) : token));
      if (j.status_code !== 0 || !Array.isArray(j.items)) throw Error("work_list_unavailable");
      for (const it of j.items) {
        if (typeof it.id !== "string" || !/^\d{10,24}$/.test(it.id)) {
          out.diagnostic = { idType:typeof it.id, fieldNames:Object.keys(it).filter(k => !/token|cookie|secret|sign/i.test(k)) };
          throw Error("unsafe_work_id");
        }
        if (seen.has(it.id)) throw Error("duplicate_work_id");
        seen.add(it.id);
        // 仅采用明确文字；数值隐私枚举没有平台证据时不猜测。
        const readLabels = (value, depth=0) => {
          if(depth>5)return [];
          if(typeof value==='string')return /^(公开|私密|仅自己可见|好友可见|private|public|friends)$/.test(value)?[value]:[];
          return value&&typeof value==='object'?Object.values(value).flatMap(child=>readLabels(child,depth+1)):[];
        };
        const names={公开:'public',私密:'private',仅自己可见:'private',好友可见:'friends',private:'private',public:'public',friends:'friends'};
        const observed=Array.from(new Set([it.visibility,it.permission,it.privacy_label].flatMap(value=>readLabels(value)).map(label=>names[label])));
        const visibility=observed.length===1?observed[0]:null;
        out.works.push({
          workId: it.id,
          title: String(it.item_title || it.title || ""),
          description: String(it.description || ""),
          ...(!it.item_title && !it.title ? {combinedText:String(it.description || "")} : {}),
          publishTime: Number(it.create_time) * 1000 || 0,
          visibility,
          visibilityEvidence: visibility ? "work_list_explicit_label" : null,
          moderation: "unknown",
          url: "https://creator.douyin.com/creator-micro/content/post/video?mid=" + it.id + "&enter_from=edit_item",
          fieldNames: Object.keys(it).filter(k => !/token|cookie|secret|sign/i.test(k)),
        });
      }
      if (j.has_more === false || j.has_more === 0) { out.complete = true; break; }
      if (!j.has_more || j.max_cursor == null) throw Error("missing_cursor");
      cursor = j.max_cursor;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (e) { out.reason = String(e.message || "work_list_failed").slice(0, 100); }
  return out;
}

