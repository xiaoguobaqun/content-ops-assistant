---
title: 需求墙 · 社区
description: 矩媒 MatrixMedia 需求墙——提交你希望支持的平台与功能，数据基于 GitHub Gist。
---

# 社区 · 需求墙

<div class="community-tabs">
  <a href="/community" class="community-tab">打开统计</a>
  <a href="/feature-wall" class="community-tab community-tab-active">需求墙</a>
</div>

你希望矩媒支持哪些平台、增加哪些功能？点击左上角**「我要提需求」**提交你的想法。所有需求存储在一个公开 GitHub Gist 中，任何人都可以查看。

<FeatureWall />

## 数据说明

- 需求列表存储在统计 Gist 的 `requirements.json` 文件中，每次读取走 CDN raw + 本地 5 分钟缓存。
- 每条需求包含：标题、类型、涉及平台、详细描述、昵称、联系方式（列表中脱敏展示）、状态。
- 状态含义：**待评估**（新提交）→ **已排期**（确认要做）→ **已完成** / **已拒绝**（由维护者更新）。

## 提交方式

1. **GitHub Issue（推荐）**：表单填完后一键打开预填好的 Issue，登录 GitHub 点击 Submit 即可，无需任何 Token。维护者确认后会同步到需求墙。
2. **直接写入 Gist（维护者）**：使用 Gist 所有者的 GitHub Token（需 `gist` 权限）直接写入，提交后立即显示。Token 仅保存在当前浏览器会话中。

## 维护者：同步 Issue 到需求墙

1. 在 Issue 页面展开「结构化数据」折叠块，复制其中的 JSON。
2. 打开需求墙页面，点击「我要提需求」，选择「直接写入 Gist」并填入 Token（或自行编辑 Gist 的 `requirements.json`，粘贴 JSON 后按 `status` 更新状态）。
3. 提交后列表立即刷新。
