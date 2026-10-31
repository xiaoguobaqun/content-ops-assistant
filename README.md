# 内容运营助手

本机桌面内容发布工作台，复用MatrixMedia v0.13.3引擎，采用GPL-2.0-only。

本仓库是净化源码快照：桌面程序、完整引擎、必要界面资源和测试代码均在仓库中。账号、Cookie、任务、用户素材、日志、截图和本机验证手记不随代码发布；示例使用占位账号与路径。

## 版本范围

- 抖音：既定测试草稿流程已验证，真实新作品发布验收仍待完成。
- 微信视频号：测试草稿保存、独立恢复和保留闭环已验证，正式发表关闭。
- 小红书：登录与鉴权已验证；草稿流程通过离线测试，实机未验收，执行保持关闭。

源码及校验文件见[v0.3.2下载](https://github.com/xiaoguobaqun/content-ops-assistant/releases/tag/v0.3.2)。本次只发布代码，不发布包含本机项目路径的应用包。

## 开发与构建

引擎源码已展开在engine/MatrixMedia，不需要拉取子模块。准备Node20、Python3、ffmpeg、ffprobe与本机Chrome。

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

当前桌面打包脚本寻找.validation/toolchain/node-v20.20.2-darwin-arm64/bin/node作为可复制的Node运行时；需自行准备该本机运行时后执行npm run build:desktop。运行程序仍依赖项目目录，尚不具备跨机器独立安装能力。

## 使用与保护

选择平台、连接本人账号、选择视频与文案、准备任务后在已开放的平台执行。默认存草稿，抖音默认仅自己可见；新增平台不会推断正式发表范围。未知结果先回查，不自动重发。已有草稿或检查点会阻止重复上传，取消操作会清理后台进程。登录与本人验证由账号本人完成，程序不导出或复制Cookie。

小红书网页草稿保存在本机浏览器，清除浏览器数据会删除草稿。其执行门闩保持关闭，等待后续实机验收。

保留MatrixMedia原始许可证与源码，来源：https://github.com/hanliang97/MatrixMedia/tree/v0.13.3。
