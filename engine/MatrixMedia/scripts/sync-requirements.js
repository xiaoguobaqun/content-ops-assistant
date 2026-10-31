"use strict";

/**
 * 需求墙同步（GitHub Issue → Gist requirements.json）
 *
 * 需求墙官网页面的「GitHub Issue（推荐）」提交方式会打开预填 Issue，其中附带
 * 结构化 JSON。本脚本把仓库里所有 [需求墙] 开头的 Issue 同步进 Gist 的
 * requirements.json，让官网需求墙立即可见。
 *
 * 同步规则：
 * - 以 Issue JSON 中的 id 为唯一键：新 Issue 追加，已存在的更新内容
 * - 已存在的需求若在 Gist 里被维护者改过 status，不会被覆盖（保留维护状态）
 * - Gist 里有、Issue 里没有的条目保留（直接写入 Gist 的需求不经过 Issue）
 *
 * Token 来源优先级（与遥测一致）：
 *   1. 环境变量 MATRIXMEDIA_GIST_TOKEN
 *   2. scripts/telemetry-secret.json（gitignored）
 *   3. src/main/services/telemetrySecret.generated.js（构建期生成，gitignored）
 *   4. ~/.matrixmedia/gist-token
 *
 * 用法：
 *   node scripts/sync-requirements.js          # 同步并写入
 *   node scripts/sync-requirements.js --dry    # 只看会同步什么，不写入
 *
 * pushall.js 每次发布会自动调用本脚本（--skip-sync-req 可跳过）。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const REPO = "hanliang97/MatrixMedia"; // 与 website/.vitepress/theme 中保持一致
const GIST_FILENAME = "requirements.json";
const DEFAULT_GIST_ID = "9bd67e622baa655abf30cc151f0fcf5a";

const DRY = process.argv.includes("--dry");

// -------- 配置读取 --------

function readEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function readTelemetrySecretJson() {
  try {
    const p = path.join(ROOT, "scripts", "telemetry-secret.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function readGeneratedSecret() {
  try {
    const p = path.join(
      ROOT,
      "src",
      "main",
      "services",
      "telemetrySecret.generated.js"
    );
    const src = fs.readFileSync(p, "utf8");
    const grab = (k) => {
      const m = src.match(new RegExp(`${k}\\s*=\\s*"([^"]*)"`));
      return m ? m[1] : "";
    };
    return { gistId: grab("GIST_ID"), gistToken: grab("GIST_TOKEN") };
  } catch {
    return {};
  }
}

function readTokenFile() {
  try {
    const p = path.join(os.homedir(), ".matrixmedia", "gist-token");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch {}
  return "";
}

function getConfig() {
  const local = readTelemetrySecretJson();
  const generated = readGeneratedSecret();
  return {
    gistId:
      readEnv("MATRIXMEDIA_GIST_ID") ||
      local.gistId ||
      generated.gistId ||
      DEFAULT_GIST_ID,
    token:
      readEnv("MATRIXMEDIA_GIST_TOKEN") ||
      local.gistToken ||
      local.gist_token ||
      generated.gistToken ||
      readTokenFile(),
  };
}

// -------- GitHub API --------

function githubRequest(pathname, token, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: "api.github.com",
        path: pathname,
        method,
        headers: {
          "User-Agent": "MatrixMedia-sync-requirements",
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `GitHub API ${res.statusCode} ${pathname}: ${
                  (json && json.message) || data.slice(0, 200)
                }`
              )
            );
          } else {
            resolve(json);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// -------- 同步逻辑 --------

function extractEntry(issue) {
  // Issue 模板里 ```json ... ``` 包着结构化数据
  const m = String(issue.body || "").match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!m) return null;
  let entry;
  try {
    entry = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!entry || !entry.id || !entry.title) return null;
  entry.issueNumber = issue.number;
  entry.issueUrl = issue.html_url;
  entry.issueState = issue.state; // open / closed，仅记录
  return entry;
}

async function main() {
  const { gistId, token } = getConfig();
  if (!token) {
    throw new Error(
      "未找到 Gist Token（env MATRIXMEDIA_GIST_TOKEN / scripts/telemetry-secret.json / telemetrySecret.generated.js / ~/.matrixmedia/gist-token）"
    );
  }

  // 1. 拉取仓库 Issue（含 PR，按标题过滤掉）
  console.log("拉取 Issue 列表...");
  const issues = await githubRequest(
    `/repos/${REPO}/issues?state=all&per_page=100`,
    token
  );
  const reqIssues = issues.filter(
    (i) =>
      !i.pull_request &&
      String(i.title || "").trim().startsWith("[需求墙]")
  );
  console.log(`  [需求墙] Issue 共 ${reqIssues.length} 条`);

  // 2. 解析每条 Issue 的结构化 JSON
  const fromIssues = [];
  const skipped = [];
  for (const issue of reqIssues) {
    const entry = extractEntry(issue);
    if (entry) {
      fromIssues.push(entry);
    } else {
      skipped.push(`#${issue.number} ${issue.title}（缺少/损坏结构化 JSON）`);
    }
  }
  if (skipped.length) {
    console.warn("  ⚠️ 跳过无法解析的 Issue:");
    skipped.forEach((s) => console.warn("     -", s));
  }

  // 3. 读取 Gist 当前 requirements.json
  console.log("读取 Gist requirements.json...");
  const gist = await githubRequest(`/gists/${gistId}`, token);
  const file = gist.files && gist.files[GIST_FILENAME];
  let current = [];
  if (file && file.content) {
    try {
      const arr = JSON.parse(file.truncated ? "" : file.content);
      if (Array.isArray(arr)) current = arr;
    } catch {}
  }
  const byId = new Map(current.filter((e) => e && e.id).map((e) => [e.id, e]));

  // 4. 合并：Issue 条目覆盖同 id 条目，但保留 Gist 中已维护的 status
  let added = 0;
  let updated = 0;
  for (const entry of fromIssues) {
    const old = byId.get(entry.id);
    if (old) {
      const keptStatus = old.status && old.status !== "open" ? old.status : entry.status;
      byId.set(entry.id, { ...entry, status: keptStatus });
      updated++;
    } else {
      byId.set(entry.id, entry);
      added++;
    }
  }
  const merged = [...byId.values()].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );

  console.log(`  新增 ${added} 条，更新 ${updated} 条，共 ${merged.length} 条`);
  if (DRY) {
    console.log("[dry] 不写入，预览：");
    merged.forEach((e) =>
      console.log(`  - [${e.status || "open"}] ${e.title} (${e.id})`)
    );
    return;
  }

  if (added === 0 && updated === 0) {
    console.log("无变化，跳过写入。");
    return;
  }

  // 5. 写回 Gist
  console.log("写入 Gist...");
  await githubRequest(`/gists/${gistId}`, token, "PATCH", {
    files: { [GIST_FILENAME]: { content: JSON.stringify(merged, null, 2) } },
  });
  console.log("✅ 需求墙同步完成（官网有 5 分钟 raw 缓存，稍后可见）");
}

main().catch((e) => {
  console.error("❌ 需求墙同步失败:", e.message || e);
  process.exit(1);
});
