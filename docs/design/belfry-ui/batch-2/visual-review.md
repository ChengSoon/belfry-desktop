# 批次 2（T7 曜石切换）前后对比与原生衔接复核（T9）

## 产物

| 内容 | 位置 |
| --- | --- |
| 改后截图（T7 最终构建 `index-C1gJpsbW.js` / `index-Diatt1Dn.css`） | `after/macos/`、`after/windows/`，各 18 张 + manifest |
| 对比报告 | `comparison/macos/index.html`、`comparison/windows/index.html`，附 `summary.json`、`diffs/` |
| 基线 | `../baseline/{macos,windows}`（T2，Graphite） |

拍摄命令见 `../native-window-baseline.md`，对比命令见 `../compare-ui-baseline.md`。两个平台的 manifest 资源哈希一致，都对应 T7 固定的构建。

## 总体结果

- **配对情况：** 36 对全部成功配对，0 张不完整。所有截图都有变化，严格差异 99.4%–100%，因为几乎每个像素都换了表面色，属于预期。
- **溢出与告警：** 所有截图 `scrollWidth == width`（没有横向溢出），`alerts` 为空。
- **画布色：** 暗色 `#171a19` → `#131418`，亮色 `#fcfbf7` → `#ffffff`，`meta theme-color` 与画布一致。亮色 canvas 在 manifest 里记为 `#fff`，是浏览器把 `#ffffff` 压成了三位写法，不是真的不一致。
- **采样核对**（1440×960，逐像素读取 PNG）：

| 位置 | macOS 暗 / 亮 | Windows 暗 / 亮 | 预期 |
| --- | --- | --- | --- |
| 窗口顶边、侧栏 | `#0c0d10` / `#ececef` | `#0c0d10` / `#ececef` | `--backdrop` ✓ |
| 内容面 | `#131418` / `#ffffff` | 同左 | `--canvas` ✓ |
| 内容面四周的缝 | `#0a0b0d`、`#09090c` / `#e7e7ea`、`#e4e4e7` | 同左 | backdrop 叠加 `--shadow-content` 的投影 ✓ |

## 各视图

| 视图 | 主要差异 | 是否符合 obsidian-tokens.md | 意外回归 |
| --- | --- | --- | --- |
| 工作台（3 种尺寸 × 亮暗） | 底色换成冷中性；主区内缩 8、圆角 12、带投影；选中会话 2px 靛蓝竖条 + 500 字重；「待确认」变为 warning-soft 徽标；Windows 自绘标题栏和侧栏同色 | ✓ 第 4、5 节 | 无。720×480 下项目名和会话名正常截断，工具栏没有挤压 |
| 设置（3 种尺寸 × 亮暗） | 表面色、输入框描边改成 border-strong；导航当前项为中性底 + accent 图标 | ✓ 第 2 节 | **macOS 顶部 28px 有色阶**（见下文问题 1）。导航当前项还没有 2px 竖条，这属于 T12 按 T10 稿落地的范围，不算回归 |
| 房间（3 种尺寸 × 亮暗） | 表面色、强调色、进度条换成靛蓝；成员头像、徽标的颜色随令牌变化 | ✓ | **macOS 顶部 28px 有同样的色阶**（问题 1）；房间的字号和层级留给 T14（A02/A04） |

没有发现裁剪、溢出或控件错位。文字对比度沿用 T5 定稿时脚本核算的结果（T7 报告里 `obsidian-contrast.mjs` 退出码为 0），截图里看不出对比度不足的地方。

## 问题

### 1. macOS 的设置页和房间页顶部有一条横向色阶（交前端，**不在本任务修改范围**）

`.settings-view`（`src/settings/settings.css:3-15`）和 `.room-view`（`src/rooms/view/room.css:3-9`）都用 `padding-top: var(--titlebar-inset)` 给交通灯让出 28px，但这 28px 的底色是 `--canvas`（设置页直接写了 `background: var(--canvas)`，房间页继承外壳），而它下面左侧导航栏的底色是 `--sidebar`。实测在 x=100 处：y≤27 为 `#131418` / `#ffffff`，y=28 起变成 `#0c0d10` / `#ececef`。亮色下是白色到灰色的明显台阶，正好是 `styles.css` 注释里说的、改用 Overlay 本来要消掉的那种色缝。

Windows 不受影响：顶部 40px 是自绘标题栏，用的是 `--sidebar` 色。工作台也不受影响：顶部条一直是 backdrop。

建议的改法（二选一）：
- 让顶部条按列走，左列用 sidebar、右列用 canvas。例如设置页导航栏用 `margin-top: calc(-1 * var(--titlebar-inset)); padding-top: var(--titlebar-inset)` 一直铺到窗口顶边。
- 或者和工作台一样，整个视图的底色用 `--backdrop`，内容区做成浮起面。

`settings.css` 归 T12，`room.css` 属于 rooms 的未提交改动，按约定都不由我来改。

### 2. 截图里的「远程协作」设置项

截图里设置导航有「远程协作」一项，因为 T7 构建早于远程协作代码被移除。下一次构建就不会再有，不算回归。

### 3. 设置页「主题」下拉没有描边，与「语言」下拉不一致（交 T12）

「语言」是带描边的 38 高字段，「主题」是无描边、胶囊形的选择器。按 T10 稿，两者应该统一成 38 高、带 border-strong 描边的字段。

## 原生层衔接

| 项 | 结论 |
| --- | --- |
| macOS Overlay 标题栏 | 页面铺到窗口顶边，工作台顶部全部是 backdrop，交通灯区域没有色缝。设置页和房间页见问题 1 |
| Windows 自绘标题栏 | `--sidebar` 色，和侧栏连成一片；内容面在标题栏下方另留 8px，没有色缝 |
| `theme-color` meta | 同步的是 `--canvas`。macOS 是 Overlay、Windows 是无边框窗口，两个平台都不会用它绘制系统标题栏，现在不影响画面，维持原样 |
| **原生窗口底色和首帧（已修）** | 之前两份 Tauri 配置都没有设置窗口或 WebView 底色，页面画出第一帧之前、以及 resize 新露出的边缘，显示的是系统默认的白色或灰色。暗色下启动会先闪一下白 |

### 已做的低风险修复

`src-tauri/src/lib.rs`：在 `setup` 里新增 `paint_native_backdrop`，按系统外观把 main 窗口和 WebView 的底色设为曜石的 `--backdrop`（暗 `#0c0d10` / 亮 `#ececef`）。

- 只调用了 Tauri 2.11 的 `set_background_color`，没有改窗口配置、权限、透明度或标题栏样式；失败时只记一条 warn 日志，不影响启动。
- 选 backdrop 而不是 canvas：窗口顶边、8px 缝隙和 resize 边缘实际露出来的都是 backdrop。
- 局限：原生层读不到前端保存的主题偏好，所以是按系统外观取色。用户手选了和系统相反的主题时，首帧会先显示系统色，再由 `startup.js` 同步切换，仍然比现在的默认白色好。
- 维护提醒：这两个色值必须和 `src/styles.css` 里的 `--backdrop` 保持一致，函数注释里已经写明。

验证：`cargo check --locked -p belfry-desktop` 通过。**尚未在真机上验证**首帧和 resize 的实际效果，也没有确认 Windows WebView2 对底色的处理。这需要运行 `pnpm desktop:dev` 目测，在 macOS 和 Windows 上各开一次暗色启动和一次 resize。

## 没有覆盖的内容

真实 WKWebView / WebView2 渲染、交通灯位置和拖拽、窗口阴影与圆角、系统高缩放和多显示器，这些都需要原生运行验收。截图来自隔离的 Chrome 和合成数据，不能代替真机检查。
