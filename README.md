# 内容运营助手 · v0.4.0

本机桌面内容发布工作台，复用 MatrixMedia v0.13.3，遵循 GPL-2.0-only。

本私有仓库提供净化源码：桌面程序、完整引擎、必要界面资源和测试代码。账号、人员资料、Cookie、任务、用户素材、日志、截图、本机验证手记及原主项目历史不随源码上传。

## 本版功能

- 每人每平台绑定一个账号，同一账号只能归属一个人。
- 选择人员后自动带出其平台账号，共用视频、标题、简介与封面，一次原生确认后顺序保存草稿。
- 同一批次汇总各平台独立结果；取消或未知结果停止后续平台，已开始的子任务不重跑。
- 保留单平台操作、素材指纹、引擎互斥锁、独立回查和中断恢复。

在“人员与账号”手动创建人员并绑定已有账号，再到“发布工作台 → 按人员·多平台”选择素材和准备任务。已有账号不会自动归属任何人。人员和任务只保存在本机 `.local/`。

## 平台与系统范围

抖音、微信视频号沿用既定草稿能力。小红书本人登录与鉴权已验证，草稿仅完成离线开发，实机验收未完成，执行保持关闭。人员批次仅支持草稿；正式三平台联发尚未开放。作品创建、可见范围和审核分别判断，证据不足保持未知。

当前桌面运行与打包仍面向 macOS；**Windows 版需要继续适配，不能直接运行 Mac 应用或现有脚本**。请 Windows 上的开发者或 Codex 先读 [Windows 适配交接](docs/windows-porting.md)，其中列出源码入口、系统依赖、任务保护及验收顺序。

## 下载和源码结构

[版本说明](docs/releases/v0.4.0.md) · [v0.4.0 源码包与校验](https://github.com/xiaoguobaqun/content-ops-assistant/releases/tag/v0.4.0)

引擎已经展开在 `engine/MatrixMedia`，无需拉取子模块或其他仓库。不包含 node_modules、个人数据或本机运行时。本次只提供源码包，不提供 Mac 或 Windows 应用安装包。

## 在 Mac 上准备开发环境

准备 Node 20、Python 3、ffmpeg、ffprobe、Chrome，以及 Yarn。下列是现有 Mac 开发路径，不是 Windows 已可用的说明：

```sh
git clone https://github.com/xiaoguobaqun/content-ops-assistant.git
cd content-ops-assistant
cd engine/MatrixMedia
yarn install --frozen-lockfile
cd ../..
node scripts/build-engine.mjs
npm test
npm run desktop
```

当前打包脚本寻找 `.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node` 作为可复制的 Mac Node 运行时；需要自行准备后再执行 `npm run build:desktop`。运行程序仍依赖项目目录，尚不具备跨机器独立安装能力。

Mac 本机完整离线回归为79项通过。Windows 需要本机单独测试，不能沿用 Mac 验收结论。验证优先使用合成素材和假引擎；真实平台登录和本人验证由用户完成，正式内容发布需另外明确账号、内容与范围。

## 隐私与来源

不导出或复制 Cookie；新电脑重新完成本人登录。小红书网页草稿保存在本机浏览器，清除浏览器资料会删除草稿。`.local`、运行日志、截图、平台登录分区和素材保持在本机；以后提交与发行也应检查排除范围。

MatrixMedia 来源：https://github.com/hanliang97/MatrixMedia/tree/v0.13.3 。保留原始许可证与源码。
