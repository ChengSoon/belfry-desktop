# 原生窗口审计与生产 UI 截图基线

本轮 T2 交付：初始窗口居中、限制初始尺寸不超出显示器工作区、显式保留系统阴影；建立生产工作台、设置和房间视图的亮暗主题截图基线。原有 `1080×700` 初始尺寸和 `720×480` 最小尺寸保留。

## 原生窗口审计

| 项目 | 现状与决定 | 代码依据 |
| --- | --- | --- |
| macOS 标题栏 | 已启用 `titleBarStyle: Overlay` 和 `hiddenTitle: true`。CSS 为交通灯保留 28px，拖拽由 `data-tauri-drag-region` 承接；保留现有实现。 | `src-tauri/tauri.conf.json`、`src/components/WindowTitlebar.tsx`、`src/workspace/workspace.css` |
| macOS Vibrancy | 当前窗口与页面均不透明，未启用 Vibrancy。Tauri 的 `windowEffects` 要求透明窗口；只加效果会被现有实色背景遮挡。后续若需要，应同时设计表面透明度，并在真实 WKWebView 检查壁纸、终端对比度和降低透明度设置。 | Tauri 2.11.4 安装包 `config.schema.json` 的 `windowEffects` 说明；`src/styles.css` 的 `body` 背景 |
| Windows 标题栏 | `decorations: false`，40px 自绘标题栏、应用图标和窗控按钮已经存在；本轮不改窗控或拖拽逻辑。 | `src-tauri/tauri.windows.conf.json`、`WindowTitlebar.tsx`、`workspace.css` |
| Windows 阴影与圆角 | Tauri 默认 `shadow: true`，已具备系统阴影与 Win11 圆角能力。本轮在两份配置中显式写明 `shadow: true`，属于保留既有行为；不叠加 CSS 外框裁切。Tauri 文档说明无边框窗口的阴影可能带 1px 白边，具体表现仍需 Windows 原生验收。 | 安装包 schema 的 `shadow` 说明：默认 true，Windows 11 无边框窗口启用圆角；Linux 不支持此属性 |
| Windows Mica | 未启用。与 Vibrancy 一样需要透明窗口及界面表面配合，并应覆盖不支持效果时的系统回退。当前实色 Graphite 表面保留。 | 安装包 schema 的 `windowEffects` 说明 |
| 初始位置与工作区 | 两份配置增加 `center: true`、`preventOverflow: true`。窗口按当前工作区居中，初始尺寸由 Tauri 限制在工作区内，改善小屏和高缩放下的首次打开。极端小于最小窗口尺寸的工作区仍需原生检查。 | `src-tauri/tauri.conf.json`、`src-tauri/tauri.windows.conf.json` |
| 最小尺寸 | 保留 720×480，截图覆盖这一尺寸；设置通过内部滚动、房间通过紧凑导航呈现。浏览器视口截图不代表原生 200% DPI 或多显示器验收。 | 两份窗口配置；`src/settings/settingsShell.css`、`src/rooms/view/room.css` |

另发现 `public/startup.js` 与 `src/theme/ThemeProvider.tsx` 的 `theme-color` 仍为旧色值，与 Graphite 的 `--canvas` 不一致，已交由前端 T4 在令牌统一时修复，后端未编辑这些文件。

## 运行截图脚本

在仓库根目录执行，需要已安装的 Chrome、Chromium 或 Edge。脚本复用生产 UI 浏览器设施，启动临时 profile 与本地静态服务，结束自动清理。

```sh
pnpm build
node scripts/capture-ui-baseline.mjs
BELFRY_UI_PLATFORM=windows node scripts/capture-ui-baseline.mjs
```

默认产出到 `docs/design/belfry-ui/baseline/{macos,windows}/`。每个平台 18 张 PNG：

- 视图：`workbench`、`settings`（外观）、`rooms`（对话与任务板）。
- 主题：`dark`、`light`，通过真实 UI 主题控件切换。
- 视口：1440×960、1080×700、720×480，设备比例为 1。

改后对比务必另存，避免覆盖改前基线：

```sh
BELFRY_UI_BASELINE_OUT=/tmp/belfry-ui-after/macos node scripts/capture-ui-baseline.mjs
BELFRY_UI_PLATFORM=windows BELFRY_UI_BASELINE_OUT=/tmp/belfry-ui-after/windows node scripts/capture-ui-baseline.mjs
```

可以用 `BELFRY_UI_SIZES=1440x960,720x480` 指定尺寸集合，用 `BELFRY_UI_FONT_SIZE=20`（12–20）按指定 UI 字号截图，用 `BELFRY_BROWSER_EXECUTABLE=/absolute/path/to/chrome` 指定浏览器。Windows PowerShell 可先用 `$env:BELFRY_UI_PLATFORM = 'windows'` 等形式设置变量，再运行 Node 命令。

脚本直接加载当前 `dist`，不会隐式重建或退回 Vite。构建缺失即失败。`manifest.json` 记录浏览器版本、Git revision/脏文件列表、生产入口资源哈希、PNG 哈希、视口、主题、表面几何与颜色，方便判断前后图是否对应正确构建。

## 数据和截图边界

React、CSS、xterm 与懒加载页面均来自未改写的生产构建；仅原生 IPC 替换为合成数据。没有启动真实 Tauri 应用、PTY、Agent 或 remote 连接，没有读取本机用户配置、项目或凭据。共享工作区已有的 remote UI 会正常渲染，其状态返回为本地无连接；未编辑 remote 代码。

截图通过固定样例时间、时区、平台 UA、临时存储、禁用动画和隐藏输入框光标保持稳定。平台变量只切换产品既有的 CSS 平台样式，**不模拟操作系统窗口管理器**：macOS 原生交通灯、系统阴影、真实圆角、Vibrancy/Mica 和 Windows DPI 不在 PNG 中。

脚本检查所有生产资源加载、无错误提示、无页面横向溢出、PNG 尺寸正确，并检查切换视图后两个终端 DOM 仍连接、未关闭或重建。结束时复用生产设施检查未处理命令、浏览器异常与控制台错误。不会依据审美差异自动判定失败，也不替代完整可访问性或原生功能回归。

## 本轮验证结果

- `pnpm build` 通过（保留现有 chunk size 提示）。
- `pnpm exec tauri info` 通过，CLI 可读取本机窗口配置。
- macOS / Windows 样式两组截图各 18 张完成，错误、未处理命令和浏览器异常均为 0。
- macOS 组另存目录重复运行：18 张 PNG 的 SHA-256 全部一致。
- 已目视检查桌面房间视图、Windows 工作台、最小窗口设置与房间视图。

尚待真实 macOS / Windows 原生运行核对：首次居中与工作区限制、交通灯和拖拽、窗控、阴影/圆角、系统高缩放与多显示器。本轮没有宣称完成这些原生验收。

## 改前图入口

| 视图 | macOS 暗色 | macOS 亮色 | Windows 暗色 | Windows 亮色 |
| --- | --- | --- | --- | --- |
| 工作台 | [截图](baseline/macos/workbench-dark-1440x960.png) | [截图](baseline/macos/workbench-light-1440x960.png) | [截图](baseline/windows/workbench-dark-1440x960.png) | [截图](baseline/windows/workbench-light-1440x960.png) |
| 设置 | [截图](baseline/macos/settings-dark-1440x960.png) | [截图](baseline/macos/settings-light-1440x960.png) | [截图](baseline/windows/settings-dark-1440x960.png) | [截图](baseline/windows/settings-light-1440x960.png) |
| 房间 | [截图](baseline/macos/rooms-dark-1440x960.png) | [截图](baseline/macos/rooms-light-1440x960.png) | [截图](baseline/windows/rooms-dark-1440x960.png) | [截图](baseline/windows/rooms-light-1440x960.png) |
