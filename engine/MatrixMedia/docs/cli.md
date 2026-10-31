## 命令行（CLI）说明

在保留图形界面的前提下，同一可执行文件支持 CLI 子命令。入口为参数中出现 `cli`。

> 返回 [README](../README.md) · 相关：[HTTP API](./http-api.md) · [MCP](./mcp.md)

## 故障排除

若启动时报 `require('electron') 异常` 且类型为 `string`，多半是环境变量 **`ELECTRON_RUN_AS_NODE`** 被设为 `1`。在该模式下 Electron 以纯 Node 运行，`require('electron')` 只会得到可执行文件路径。请在本终端执行 `unset ELECTRON_RUN_AS_NODE`，或在命令前显式清空后再启动，例如：

```bash
ELECTRON_RUN_AS_NODE= electron . cli publish --help
```

`yarn dev` 已尝试在子进程中清除该变量；若仍异常，请检查 shell 配置（如 `.zshrc`）是否全局导出了 `ELECTRON_RUN_AS_NODE`。

## CLI 登录

与 GUI `getCookie` / `LocalVideoPublish` 对齐的最小闭环，当前支持**抖音**和**视频号**两个平台。

### 通用机制

1. **会话**：`partition` 形如 `persist:<手机号段><平台名>`，与账号树、webview 一致。
2. **Cookie 持久化**：登录成功后自动 `cookies.flushStore()` + `flushStorageData()`，确保 CLI 与 GUI 共用同一 `userData` 下的 `persist:` 分区。
3. **终端扫码**：CLI 自动捕获二维码并在终端展示，用户扫码后继续轮询登录 Cookie。
4. **退出**：检测到 Cookie 后关窗；超时 / 用户关窗返回码 3。

### 抖音 CLI 登录

- **登录判定**：轮询 `https://creator.douyin.com` 下 Cookie `passport_assist_user`。
- **窗口模式**：默认屏外隐藏窗口 + 终端二维码；支持 `--puppeteer-headless` 无头模式。
- `--show` 会被忽略（不弹窗）。

```bash
electron . cli login -p dy --phone 13800138000
```

### 视频号 CLI 登录

- **登录判定**：轮询 `https://channels.weixin.qq.com` 下 Cookie `sessionid`，检测与旧值不同的新 sessionid 即为登录成功（支持重复登录）。
- **窗口模式**：默认透明窗口（`opacity: 0`）+ 终端二维码；支持 `--show` 弹出可见登录窗口。
- **UA 注入**：通过 puppeteer CDP `page.setUserAgent()` 在导航前设置微信 UA，覆盖主 frame + iframe 所有请求。
- **QR 提取**：遍历所有 frame（含 wujie micro-frontend 的 `login-for-iframe`），从 `img.qrcode` 的 `data:` URL 直接解码。
- 不支持 `--puppeteer-headless`。

内置窗口扫码后若提示「没有可登录的视频号」，而同一微信在系统 Chrome 中可正常登录，可尝试系统 Chrome 回退：

```bash
matrixmedia cli login -p sph --phone 账号分组 --browser chrome
```

此模式会显示本机 Chrome / Chromium 窗口，不使用终端二维码。每个账号 partition 使用独立的持久化 Chrome 目录，不读取日常浏览器账号，也不会把内置窗口的旧凭据注入 Chrome。Chrome 端鉴权通过后，替换原账号分区中的视频号 Cookie，再验证应用端会话；仅两端均通过才报告成功，失败会恢复原会话。窗口关闭、超时、鉴权失败返回非零退出码。代理配置沿用该账号设置；带认证的 SOCKS 代理暂不支持。由于旧发布端会裁剪连字符分区，此回退暂拒绝包含连字符的 partition，避免登录成功却无法被发布端读取。

复用账号分区时，旧的域 Cookie 与新扫码写入的 host-only `sessionid` 可能并存。主动打开 GUI / CLI 登录入口会先验证候选会话，再整理冲突；替换后仍须通过原生鉴权，否则恢复原 jar。普通状态检查不会改写 Cookie，不会仅凭到期时间猜测哪份会话有效，也不会清除其他平台分区或父域的无关 Cookie。

GUI 的视频号账号管理页也提供「使用 Chrome 登录」。缺少 Chrome 时，请安装 Chrome / Chromium，或通过已有 Chrome 路径配置指定浏览器。该回退用于登录兼容性，不承诺解决内置浏览器的发布兼容问题。

```bash
# 终端二维码（默认，无弹窗）
electron . cli login -p sph --phone 13800138000

# 弹出登录窗口
electron . cli login -p sph --phone 宠物 --show
```

### Linux / SSH 环境

无显示器或 SSH 环境下请用 `xvfb-run -a` 提供虚拟显示：

```bash
xvfb-run -a ./MatrixMedia-*-linux-x86_64.AppImage cli login -p dy --phone 13800138000
```

若 stdout 不是 TTY（如管道重定向），终端截图可能无法正常展示，请在可交互终端中执行。参数见 `cli login --help`。成功后再执行 `cli publish`。

## 发布视频

```bash
# 开发（项目根目录，需先 yarn dev 或已 build:dir）
electron . cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"

# Windows 安装包产物
matrixmedia.exe cli publish -p dy --phone 13800138000 -f C:\video.mp4 -t "标题"
```

### 参数摘要

与界面 **本地视频发布**（`LocalVideoPublish.vue` → `buildVideoPayload` / `handleBatchPublish`）同一套字段：

| 参数                       | 对应 GUI / 载荷字段                                                        |
| -------------------------- | -------------------------------------------------------------------------- |
| `-p` / `--platform`        | 发布平台                                                                   |
| `-f` / `--file`            | 本地视频路径 → `filePath`、`data.textOtherName`（文件名无扩展名）          |
| `--phone` / `--partition`  | 会话分区，与账号树一致                                                     |
| `-t` / `--title`           | **视频标题**（必填）→ `data.title`                                         |
| `--description` / `--desc` | **视频简介** → `data.description`                                          |
| `--short-title`            | **视频号短标题** → `data.shortTitle`，仅视频号消费                         |
| `--name` / `--book-name`   | **名称**（任务记录名）→ `bookName`；省略时默认与视频文件名（无扩展名）一致 |
| `--bt2`                    | 旧兼容字段：视频号作为短标题，其他平台作为简介                             |
| `--tags` / `--bq`          | **视频标签** → `data.tags`                                                 |

平台写入规则：

| 平台 | `--title` | `--description` | `--short-title` | `--tags` |
| ---- | --------- | --------------- | --------------- | -------- |
| 抖音 / 快手 / 视频号 | 标题 | 与标签拼进正文 | 仅视频号填写 | 拼进正文末尾，建议带 `#` |
| 小红书 | 标题 | 写入正文 | 忽略 | 独立话题控件 |
| 哔哩哔哩 | 标题 | 写入简介控件 | 忽略 | 独立标签控件 |
| 头条 / 百家号 | 标题 | 忽略 | 忽略 | 忽略 |
| 番茄视频 | 不写元数据 | 不写元数据 | 不写元数据 | 不写元数据 |
| `--address`                | **地址** → `data.address`（仅百家号）                                      |
| `--publish-at`             | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`；创建后立即进入发布历史         |
| `--show`                   | 当前 CLI 会忽略，仍后台运行                                                |
| `--no-close-window`        | CLI 下无效，仅与 GUI 显示窗口场景有关                                      |
| `--draft`                  | 保存到平台草稿箱，不直接发布                                               |
| `--cover`                  | 自定义封面图片路径（抖音 / 快手 / 视频号，单文件模式生效；竖封面 3:4 比例最佳，抖音横封面基于竖封面自动生成；视频号仅收 jpg/png；`--dir` 批量模式会忽略并提示） |
| `--sph-product-id`         | 视频号商品上架快捷参数（商品编号）；其他平台忽略 |
| `--sph-drama-id` | 视频号小程序短剧挂载快捷参数（**短剧名称**，如 `泳陷错恋`）；其他平台忽略                           |
| `--sph-series-id` | 视频号剧集挂载快捷参数（**剧集名称**，视频号原生剧集）；其他平台忽略                           |
| `--sph-link-type`          | 视频号链接类型，支持 `none` / `product` / `mini_drama` / `sph_series`（也接受 `短剧` / `drama` / `剧集` / `series` 等别名）；其他平台忽略                  |
| `--sph-link-value`         | 视频号链接值：商品编号，或短剧 / 剧集**名称**；只传该参数时默认按商品上架                                 |

完整说明请执行：

```bash
<应用> cli publish --help
```

### 退出码

| 码  | 含义                                           |
| --- | ---------------------------------------------- |
| 0   | 成功                                           |
| 1   | 未捕获异常                                     |
| 2   | 参数错误                                       |
| 3   | 任务失败（如未登录、上传失败）                 |
| 4   | 视频号链接添加失败，视频已转存草稿，需人工检查 |

视频号商品上架并保存草稿：

```bash
electron . cli publish -p sph --phone 13800138000 -f /path/to/video.mp4 \
  -t "视频标题" --description "视频简介" --short-title "视频号短标题" --draft \
  --sph-product-id 10000591263144
```

视频号挂载小程序短剧（值填**短剧名称**，取自发布页「选择需要关联的短剧」列表）：

```bash
electron . cli publish -p sph --phone 13800138000 -f /path/to/video.mp4 \
  -t "短剧第一集" --draft --sph-drama-id 泳陷错恋
```

视频号挂载剧集（值填**剧集名称**；与小程序短剧互斥，一次只挂一种）：

```bash
electron . cli publish -p sph --phone 13800138000 -f /path/to/video.mp4 \
  -t "短剧第一集" --draft --sph-series-id 儿媳给我办寿宴
```

> 参数名保留 `-id` 后缀以兼容既有脚本，**实际取值是名称而不是编号**。
> 传数字编号会搜索不到目标，命令不会报错但会走「转存草稿」兜底。
> 例如下面这条是**错误用法**（`1234567890` 不是名称）：
>
> ```bash
> # ✗ 错误：值为编号，搜不到
> electron . cli publish -p sph --phone 13800138000 -f /path/to/video.mp4 \
>   -t "短剧第一集" --draft --sph-drama-id 1234567890
> ```
>
> 正确做法是填发布页「选择需要关联的短剧」列表里看到的名称。

短剧 / 剧集添加失败时不会直接发布：主进程会等视频处理完成后自动转存草稿，返回 `status: needs_attention`、退出码 `4`，需要人工到视频号后台确认。实现位置与排查步骤见 [视频号链接挂载（小程序短剧 / 剧集）](./sph-links.md)，其中文案候选可按诊断日志直接调整。

视频号链接参数属于视频号专属能力。即使误传给抖音、B 站等其他平台，也会被忽略，不会阻断任务。

### 注意事项

1. **登录态**：CLI 与 GUI 共用同一 `partition` 会话（`userData` 固定为 `matrix-video`）。抖音和视频号可使用 **`cli login`** 在终端完成扫码登录；其它平台可先在 GUI 登录，或保证该 `partition` 已有有效 Cookie。
2. **与 GUI 同时运行**：CLI 模式不会申请单实例锁；若与 GUI 同时使用同一账号 partition，可能导致会话冲突，建议错峰使用。
3. **进程生命周期**：CLI 仍会启动一个 Electron 主进程，只是不显示 GUI。命令完成、参数失败或业务失败后会主动退出；执行发布期间进程存在属于正常现象。
4. **启动诊断**：终端会依次输出 Puppeteer 初始化、Electron ready、CLI 参数识别和最终退出码。初始化超过 15 秒会以退出码 `1` 结束并打印明确错误，不会无限静默等待。
5. **登录失效**：视频号发布页若跳转到 `channels.weixin.qq.com/login.html`，CLI 会立即提示重新登录并以退出码 `3` 结束，不再按普通 URL 不匹配重复重试。
6. **定时发布**：`--publish-at "YYYY-MM-DD HH:mm:ss"` 只支持一次性明确时间点，不支持每日/每周/每月。定时任务会写入发布历史，状态为“等待定时发布”；如果应用关闭导致错过执行时间，下次启动会标记为“任务过期”，可在视频管理中重新发布。
7. **Linux 打包**：使用 `yarn build:linux` 生成 AppImage（需在本机构建环境安装相应依赖）。

## 发布掘金文章

掘金文章发布复用 GUI 中已登录的掘金账号会话，`--phone` / `--partition` 需要与界面里的掘金账号一致。正文可以直接传入 `--content`，也可以通过 `--file` / `-f` 读取本地 `.md` / `.txt` 文件；至少提供一个，同时提供时优先使用 `--content`。

```bash
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --content "正文内容" --tags "前端 electron"
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md --publish-at "2026-05-13 10:00:00"
```

### 参数摘要

| 参数                      | 说明                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `-p` / `--platform`       | 发布平台，当前支持 `juejin` / `jj` / `掘金`                                          |
| `--phone` / `--partition` | 会话分区，与 GUI 掘金账号一致                                                        |
| `-t` / `--title`          | 文章标题                                                                             |
| `--content`               | 文章正文，至少与 `--file` / `-f` 提供一个；同时提供时优先使用 `--content`            |
| `-f` / `--file`           | `.md` / `.txt` 正文文件，至少与 `--content` 提供一个；同时提供时优先使用 `--content` |
| `--cover`                 | 可选封面图片                                                                         |
| `--category`              | 分类，默认“前端”                                                                     |
| `--tags`                  | 空格分隔标签，默认“前端 electron”                                                    |
| `--summary`               | 可选摘要，不传则由掘金自动生成                                                       |
| `--publish-at`            | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`                                           |

## 构建命令

- `yarn build`：Windows x64 NSIS
- `yarn build:mac`：macOS dmg（x64 + arm64）
- `yarn build:linux`：Linux AppImage
- `yarn build:all`：Windows + Linux + macOS

## 数据统计命令（stats / stats-sync / stats-work）

基于平台页面登录态采集账号数据（粉丝/播放/点赞/评论/收藏 + 单作品明细），支持平台：抖音、视频号、哔哩哔哩、百家号、头条、快手、小红书（番茄视频、掘金无数据接口）。

| 命令 | 说明 |
| --- | --- |
| `cli stats -p <平台> --phone <分组>` | 读取本地快照中的账号粉丝数据 |
| `cli stats-sync -p <平台> --phone <分组>` | 主动采集该账号最新数据并写入本地快照 |
| `cli stats-work -p <平台> --phone <分组> --title <标题>` | 按完整标题查询某个视频的发布数据（含发布时间） |

- 平台参数支持短码：`dy` `sph` `blbl` `bjh` `tt` `ks` `xhs` 或中文名
- `--phone` 为分组名（与 GUI「媒体平台管理」中的分组一致）
- 输出 JSON（含 `success` 字段）；`stats-sync` 需该分组此平台已在 GUI 登录
- 数据存于 `<userData>/data-stats/<分组>/<平台>/`，与 GUI「账号数据」页共享

示例：

```bash
matrixmedia cli stats -p sph --phone 123
matrixmedia cli stats-sync -p dy --phone 123
matrixmedia cli stats-work -p ks --phone 123 --title "你家猫也这样睡？倒挂笼子都不醒"
```
# 本地抖音接口扩展

本地分支在 v0.13.3 上新增：单文件 `cli publish --visibility private|friends|public`，以及与 `--draft` 互斥的 `--publish`。后者显式覆盖账号默认草稿设置，不修改账号配置。可见范围无法读回时阻止提交；批量目录模式拒绝这两个尚未支持的参数。

单文件可传 `--task-id <外部任务编号>`，通过 `clientTaskId` 关联独立历史记录，避免覆盖同一素材的其他任务。HTTP 对应字段为 `clientTaskId`。

本地接口的上述新增参数不支持定时任务；与 `--publish-at` 同传会直接报错。HTTP 显式提供 `visibility` 时必须为合法枚举字符串，空白、null 和数组均拒绝。

`cli douyin-draft --phone <分组> --expected-file <JSON> [--screenshot <本机图片路径>]` 恢复草稿并核验。JSON 包含 `title`、`description`、`visibility`、去除查询参数后的 `coverSrcs` 和 `requireCover`；核验后原样暂存，以保留继续编辑入口。不重新上传视频或发布作品。

`cli douyin-works --phone <分组> [--work-id <编号>] --json` 为只读查询，输出 `channel: douyin-works`、`works`、`complete` 和可选 `match`。作品编号保持字符串，分页中断不声称列表完整。指定编号时 `match` 只确认编号存在，隐私和审核以作品字段为准；未知字段不会推断。未指定编号可作为提交前基线。查询失败或不完整返回退出码 4。

发布 JSON 增加本地记录 `id`、`outcome`、`draftEvidence`、可选 `platformWorkId` / `platformUrl`。抖音草稿必须重新恢复核验；实际提交先返回 `submission_unknown`，由上层只读回查作品确认。提交后异常不自动重发。退出码 4 也表示结果待核实。


## 本机内容运营助手的视频号保护扩展

`publish -p sph --task-id <外部任务号> --draft --checkpoint-file <绝对路径>` 只允许即时单文件草稿；不接受实际发表、定时或目录批量模式。受管任务只执行一次，前置错误或提交后异常均返回待核实；不会回退到旧视频号处理器，也不自动声明原创。

上传前进入真实草稿箱，要求本次 `get_draft_list` 成功响应明确返回完整空列表，页面默认的“草稿箱 (0)”不等于加载完成。已有草稿或列表未知时停止。检查点在单次保存前持久落盘，包含账号分区、外部任务号、文案及视频/封面证据；原任务不能重新上传。

`sph-draft --phone <账号> --expected-file <JSON> [--screenshot <本机图片路径>]` 独立恢复核验。JSON 提供 `clientTaskId`、`title`、`description`、`shortTitle`、`checkpointPath`。必须与原检查点身份及内容匹配，才能定位原草稿；恢复不重新上传。原样暂存只点击一次，必须观察本轮 `post_draft` 的有效成功响应；跳转本身不足以确认。保存后通过同一标准账号分区的独立只读窗口查询列表、确认原目标草稿仍在，避免离开编辑页时被页面保护阻止。

`--inspect` 为只读列表诊断；`--inspect-create` 为只读创作页结构诊断，不填写表单；`--inspect-works` 只读观察作品图的路径与参数名，不输出签名值。诊断中的 `inspection: true` 只表示检查完成，不表示任何草稿保存成功。`ok: false` 或退出码 4 都应保留为待核实。

账号查询将视频号鉴权网络失败表示为 `loggedIn: null`，不再凭 Cookie 存在显示已登录。视频号登录的保存扫码图必须能解码为微信 URL，头像、logo 和无法识别的截图不作为二维码。支持原有 `--show` 微信本人验证窗口；本机助手不使用 Chrome Cookie 桥接。

视频号封面证据使用资源身份 SHA-256，不再删除全部查询参数后比较通用下载路径。已观察的 Finder 数字下载路径按 `encfilekey` 区分文件，其他地址保守使用完整 URL 身份。视频本地预览只有可信尺寸/时长时，恢复可与同一媒体信息匹配；已知远端身份不同不能降级。任何匹配还必须同时满足原任务、空基线、唯一草稿行与文案/封面。

## 本机助手的小红书账号阶段

`cli login -p xhs --phone <本机名称> --show [--save-qr-png <路径>]` 使用标准小红书分区及可见本人验证窗口。扫码或手机号/验证码均由本人完成，程序不勾选协议、不清理会话、不使用Chrome Cookie桥接。只有页面自身返回的本人信息鉴权与原分区身份匹配，才可返回登录成功；网络或响应未知不当作成功。扫码图必须可解码为小红书登录URL，登录结束后移除。

`cli accounts -p xhs --json` 支持独立小红书筛选，真实鉴权未知时 `loggedIn:null`，不以Cookie存在冒称已连接。

`cli xhs-draft --phone <名称> --inspect [--screenshot <路径>]` 为只读页面审计，不上传、保存或发表。只记录控件结构、平台响应路径/字段名，不输出输入值、Cookie或签名地址。`--inspect-drafts`只读打开本机草稿箱并核对存储数量，`--inspect-create`检查创作页；证据路径必须为绝对路径。

`cli publish -p xhs --phone <名称> --file <本机绝对视频路径> --cover <绝对封面路径> --title <20字内标题> --description <正文> --draft --task-id <ID> --checkpoint-file <绝对路径>`使用独立受管流程，不进入旧发布器或Chrome桥接；只接受即时单文件草稿，已有检查点或已有草稿一律停止。平台可能在点击暂存之前自动保存，需绑定当前任务的唯一同账号媒体记录，不能假定未点击就没有草稿。任何不明结果均不重传、不再点击。

`cli xhs-draft --phone <名称> --expected-file <绝对JSON路径> [--screenshot <绝对路径>]`仅恢复核验已完整保存的本机草稿；JSON含clientTaskId、title、description、checkpointPath。需匹配已完成的检查点、稳定媒体/草稿摘要及原样保留证据。未完成文案或自选封面的自动草稿保持未知，不补写、不重传。清理浏览器数据会删除草稿。

受管草稿仅经离线夹具验证，真实封面/暂存/恢复未验收；内容运营助手桌面的执行门闩仍关闭。不能把登录、上传或只读检查完成当作草稿闭环成功。
