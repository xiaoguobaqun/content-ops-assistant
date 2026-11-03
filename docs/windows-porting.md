# Windows 安装与开发

目标系统为 Windows 10/11 x64。下载页面为 [GitHub Releases](https://github.com/xiaoguobaqun/content-ops-assistant/releases)。选择 `Content-Ops-Assistant-<版本>-win-x64-setup.exe`，按中文向导选择安装目录；安装完成后从桌面或开始菜单打开“内容运营助手”。

安装包包含 Node 20、Electron、发布引擎、ffmpeg/ffprobe 和 Windows 原生任务保护程序，不需要另装 Node、Python、Git 或手动启动 Electron。安装器未配置商业代码签名证书；下载前可核对同一发行版的 SHA256SUMS.txt 与源码包。

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

GitHub Actions 的离线回归、安装/启动/退出/卸载检查不等于真实平台发布验收。Windows 上平台页面、扫码及风控仍需实机验证；本轮适配不自动操作真实账号或作品。

## 从源码构建

发布仓库中的引擎为展开源码目录，无需额外私有子模块。使用 Node 20.x、Yarn 1.22.22，在 Windows x64 下：

```powershell
cd engine/MatrixMedia
yarn install --frozen-lockfile
cd ../..
node scripts/build-windows-host.mjs
node scripts/build-windows.mjs --prepare-tools
# 将上一步输出的工具绝对路径设置为 CONTENT_OPS_FFMPEG、CONTENT_OPS_FFPROBE。
# 浏览器夹具可通过 CONTENT_OPS_CHROME 指向 Chrome。
node scripts/run-tests.mjs
node scripts/build-engine.mjs
node scripts/build-windows.mjs
node scripts/windows-smoke.mjs
```

开发启动：`node scripts/start-desktop.mjs`。CI 在原生 Windows runner 编译保护程序并执行全套根测试和相关引擎离线测试，成功后构建 NSIS 安装器，在中文空格路径安装、用隔离资料目录启动、退出并卸载，核对资料保留。产物包含安装包、源码和 SHA-256；任何必需检查失败均不发布安装包。

源码及 MatrixMedia 修改遵循 GPL-2.0-only；媒体工具为独立 GPL 程序，安装包附对应许可证及来源说明。勿上传私人素材、客户档案、任务记录、日志、登录态或接口密钥。
