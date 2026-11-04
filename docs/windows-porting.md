# Windows 基础适配与开发

[返回首页](../README.md) · [源码运行准备](development.md) · [操作手册](user-guide.md)

目标系统为 Windows 10/11 x64。本次只向 GitHub 交付净化源码及基础适配，暂不分发 Windows 安装包。安装构建和隔离验证脚本保留在源码中，默认自动流程不构建、上传安装包或创建 Release。

保留的安装构建脚本可打包 Node 20、Electron、发布引擎、ffmpeg/ffprobe 和 Windows 原生任务保护程序，目标是让安装后的用户无需另装开发工具。安装器未配置商业代码签名证书；未来分发前仍需核对实际使用和验收范围。

## 数据、升级和卸载

程序文件放在安装目录；人员、任务、画像、接口配置及引擎登录数据放在当前 Windows 用户的 `%APPDATA%\content-ops-desktop\workspace`。密钥使用 Windows 系统加密保存，不明文回退。升级和卸载保留用户资料。新电脑需要重新扫码登录，不复制 Cookie 或其他电脑的加密密钥。

同平台不同账号可各自保存登录，任务顺序执行。账号名的主要前缀须不同；只改连字符后的备注可能共用旧分区，会被拦截。手机显示成功后若官方窗口还要求短信等本人验证，请在官方窗口完成，勿把验证码发给他人。

## 任务保护

Windows 使用独占文件句柄和 Job Object 管理引擎进程树；先将挂起进程纳入 Job 再运行。取消、超时及服务退出时清理全部后代，确认停止后释放账号锁。保护程序异常或旧 Job 状态无法核实时会保守阻止新提交，需检查本机状态，不删除锁来绕过。

准备任务保存素材和内容指纹；执行前再次核对，先落盘并持锁。已开始、超时、中断或结果未知的任务不自动重发。回查不创建新作品，作品创建、可见范围和审核分别记录；证据不足保留未知。回收站只隐藏本机记录，不删除平台作品、草稿或素材。

## 平台与验收边界

- 抖音单平台提供草稿、私密发布和公开发布；执行前仍需原生确认。历史作品列表不完整时继续阻止上传，不能删掉此检查。
- 视频号只开放草稿，正式发表及可见范围未开放。
- 小红书执行门槛继续关闭，可准备本机任务及本人连接。
- 多平台入口只存草稿；真实账号自动采样继续禁用。
- 自主填写画像可使用；真实 AI 请求需要用户自行配置文字服务。

提交 `a4def1f` 的 Windows 自动验证已通过：原生保护 14/14、根测试 232/232、8 项引擎离线脚本、引擎及安装构建，以及中文空格路径下的隔离安装、启动、退出和卸载；资料保留检查通过。该轮曾生成临时构建验证产物，未创建安装包 Release。按当前交付要求，后续默认流程只保留源码与离线结果。

这些结果不等于真实平台发布验收。Windows 上平台页面、扫码、视频上传及风控仍需实机验证；本轮适配不自动操作真实账号或作品，也不能保证真实视频上传成功。

## 从源码构建

首次使用请先按源码运行文档准备 Node 20.x、Yarn 1.22.22 和引擎依赖，然后在 Windows x64 的 PowerShell 中继续。[查看环境准备](development.md#安装引擎依赖)

```powershell
node scripts/build-windows-host.mjs
$tools = node scripts/build-windows.mjs --prepare-tools | ConvertFrom-Json
$env:CONTENT_OPS_FFMPEG = $tools.ffmpeg
$env:CONTENT_OPS_FFPROBE = $tools.ffprobe
# 浏览器夹具可通过 CONTENT_OPS_CHROME 指向 Chrome。
node scripts/run-tests.mjs
node scripts/build-engine.mjs
```

开发启动：`node scripts/start-desktop.mjs`。默认 CI 在原生 Windows runner 编译保护程序、执行全套根测试和相关引擎离线测试、构建引擎，然后仅归档源码 ZIP、SHA-256 和离线结果。源码上传、离线检查与平台视频上传各自核对。

以下安装构建仅供开发者在隔离环境中手动验证，本次不对外分发：

```powershell
node scripts/build-windows.mjs
node scripts/windows-smoke.mjs
```

隔离验证会在中文空格路径安装、用隔离资料目录启动、退出并卸载，核对资料保留。它不登录真实账号，也不发表视频。

源码及 MatrixMedia 修改遵循 GPL-2.0-only；媒体工具为独立 GPL 程序，安装包附对应许可证及来源说明。勿上传私人素材、客户档案、任务记录、日志、登录态或接口密钥。
