import { validDouyinWorkId } from "../../shared/douyinWork.js";

export function parseDouyinWorksArgs(args = []) {
  if (args.includes("--help") || args.includes("-h")) return { ok: true, value: { help: true } };
  const value = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") continue;
    const key = { "--phone": "phone", "--work-id": "workId" }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith("--")) return { ok: false, error: `参数无效：${args[i]}` };
    value[key] = args[++i];
  }
  if (!value.phone) return { ok: false, error: "需要 --phone <账号分组>" };
  if (value.workId != null && !validDouyinWorkId(value.workId)) return { ok: false, error: "作品编号必须为 10–24 位数字字符串" };
  return { ok: true, value };
}

export function douyinWorksHelpText() {
  return "用法: <应用> cli douyin-works --phone <账号分组> [--work-id <作品编号>] [--json]\n只读查询作品；输出完整分页标记和可观测的可见范围。未找到不等于发布失败。";
}
