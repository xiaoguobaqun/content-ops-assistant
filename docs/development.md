# 开发与源码运行

[返回首页](../README.md) · [操作手册](user-guide.md) · [Windows 专项说明](windows-porting.md)

当前源码版本为 0.6.0。首次下载需要准备开发环境；已有本机 Mac 应用可直接使用桌面入口。

## 取得源码

可直接下载 main 分支 ZIP，解压后进入项目文件夹。[下载最新版源码](https://github.com/xiaoguobaqun/content-ops-assistant/archive/refs/heads/main.zip)

也可以通过 Git 克隆。

```sh
git clone https://github.com/xiaoguobaqun/content-ops-assistant.git
cd content-ops-assistant
```

公开仓库的 `engine/MatrixMedia` 已包含展开的引擎源码。

## 环境要求

| 环境 | 要求 |
| --- | --- |
| Node.js | 20.x，当前 Windows 自动验证使用 20.20.2 |
| Yarn | 1.22.22，通过 Corepack 准备 |
| macOS 源码运行 | ffmpeg、ffprobe、Python 3 |
| Windows 源码运行 | Windows 10/11 x64，编译原生保护程序，设置媒体工具路径 |
| 浏览器夹具测试 | 已安装 Chrome，可通过 `CONTENT_OPS_CHROME` 指定绝对路径 |

Node.js 下载请使用官方发行页面。[Node.js 20.20.2](https://nodejs.org/dist/v20.20.2/)

## 安装引擎依赖

在项目根目录执行。

```sh
node --version
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn --cwd engine/MatrixMedia install --frozen-lockfile --non-interactive
```

确认 Node 显示 `v20.x`。后续构建与后台服务使用该 Node 环境。

## macOS 启动

先安装 ffmpeg、ffprobe 和 Python 3，并确认下面命令均能找到对应工具。

```sh
ffmpeg -version
ffprobe -version
python3 --version
```

然后构建引擎并打开桌面工作台。

```sh
node scripts/build-engine.mjs
node scripts/start-desktop.mjs
```

启动脚本会调用项目依赖中的 Electron，并打开“内容运营助手”。操作顺序见使用手册。[进入操作手册](user-guide.md)

### 本机 Mac 应用打包

`npm run build:desktop` 使用现有 Apple Silicon 本机打包脚本。该脚本要求项目内存在 `.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node`，可从 Node.js 官方对应压缩包解压得到。准备好该运行时和引擎构建后执行。

```sh
npm run build:desktop
```

输出为 `dist/内容运营助手.app`。当前 Mac 包引用构建时的原项目目录、执行引擎及本机资料，使用期间需保留该项目目录。公开下载采用源码形式。

## Windows 启动

先完成引擎依赖安装，再在 PowerShell 的项目根目录执行。

```powershell
node scripts/build-windows-host.mjs
$tools = node scripts/build-windows.mjs --prepare-tools | ConvertFrom-Json
$env:CONTENT_OPS_FFMPEG = $tools.ffmpeg
$env:CONTENT_OPS_FFPROBE = $tools.ffprobe
node scripts/build-engine.mjs
node scripts/start-desktop.mjs
```

媒体工具环境变量在当前 PowerShell 会话有效，下次从源码启动时需重新设置。完整数据目录、任务保护、手动安装构建与验证范围见 Windows 文档。[查看 Windows 专项说明](windows-porting.md)

## 修改与验证

修改引擎源码后执行 `node scripts/build-engine.mjs`，以更新引擎构建。运行时会检查引擎源码与构建文件的新旧关系。

根项目回归使用合成素材和离线夹具。

```sh
npm test
```

Windows 专项保护测试在 Windows 上运行，Mac 会跳过对应原生用例。测试所需浏览器、媒体工具及引擎依赖应已就绪。

## 命令行入口

桌面任务层同时提供命令接口。先查看帮助和环境检查。

```sh
node bin/content-ops.mjs --help
node bin/content-ops.mjs doctor
node bin/content-ops.mjs accounts
```

准备、执行和回查示例使用本机素材与实际任务编号，执行前请核对平台和账号。

```sh
node bin/content-ops.mjs prepare --input examples/douyin-job.json
node bin/content-ops.mjs run <任务编号>
node bin/content-ops.mjs verify <任务编号>
node bin/content-ops.mjs show <任务编号>
```

可参考 `examples/` 下的 JSON，将视频路径、账号名、文案和封面改为自己的实际内容。抖音支持 `draft` / `publish`，发布范围支持 `private` / `friends` / `public`。视频号与小红书按平台草稿门槛处理，小红书当前暂停执行。

## 本机资料与开发边界

源码运行的人员、任务和画像默认位于项目 `.local/`，接口密钥由系统加密保存。引擎管理登录态。Windows 独立安装运行配置使用当前用户的应用数据目录，具体位置见 Windows 文档。

本机资料、登录态、密钥、素材、真实账号日志和私有验收记录应保存在本机。调试优先使用合成数据，并依照任务状态和锁保护执行。各平台的实际能力与验证进度列在状态文档中。[查看平台状态与验证记录](platform-status.md)
