# UI 改造代码审查（T16 · 覆盖 T4 / T7 / T11 未提交改动）

审查人：资深全栈开发｜日期：2026-11-12｜范围：`git diff` 69 个已修改文件 + 新增 `scripts/theme-canvas.ts`、`src/theme/canvas.json`、`src/components/Notice.tsx`、`src/components/notice.css`、截图/对比脚本。

## 结论

没有发现阻断合入的功能回归。主题单一来源、xterm 同步、IPC 和终端生命周期都没有被破坏。主要风险集中在**原生首帧底色**：修复在 macOS 上基本不生效，运行时切换主题后也不跟随。另有若干可访问性和测试覆盖上的小问题，下面按严重度排列。

### 本次复核跑过的验证（当前工作区，构建 `pnpm build` 通过）

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | 通过 |
| `pnpm test`（vitest） | 193 文件 / 1252 项通过（新增守卫后为 194 / 1255） |
| `cargo check`（src-tauri） | 通过 |
| `node --test production-ui / production-panels / motion .case.mjs` | 19/19 通过，browserErrors / errors / unhandled 均为空 |
| `node --test perf-interactions.case.mjs` | 2/2 通过 |
| `node --test scripts/i18n-checks.case.mjs` | 11/11 通过（新增的重试按钮 i18n key 中英文齐全） |
| `dist/index.html` | 占位符已全部替换，`theme-color` = `#131418` |

---

## 问题清单（按严重度）

### M1 · macOS 首帧底色修复实际不生效（Rust · 需真机确认后再定修法）

- 位置：`src-tauri/src/lib.rs:255-266`（`paint_native_backdrop`）
- 现象：`WebviewWindow::set_background_color` 会同时设置 NSWindow 和 WebView 两层的底色。但 wry 0.55.1 在 macOS 上设置 WebView 底色的分支（`src/wkwebview/mod.rs:963`）被 `#[cfg(feature = "transparent")]` 包住。这个 feature 只有开启 tauri 的 `macos-private-api` 才会打开，而本项目的 `Cargo.toml` 没有开。结果是 macOS 上只有 NSWindow 底色生效，WKWebView 首帧前仍然按默认的不透明白底绘制。Overlay 标题栏模式下 WebView 铺满整窗，所以**暗色主题冷启动的白闪基本不会因这次修改消失**。Windows 上 WebView2 的设置路径是生效的。
- 复现：在 macOS 暗色系统外观下冷启动 release 包，录屏逐帧查看第一帧是否为白色。
- 建议：
  1. 不建议为此开启 `macos-private-api`。它会用到私有 API（`drawsBackground`），而且影响 App Store 审核。
  2. 更可行的办法是把窗口配置成 `"visible": false`，在前端首帧渲染完成后（startup.js 设好 data-theme、样式表加载后）调用 `getCurrentWindow().show()`，从根本上消除白闪。需要给 capability 增加 `core:window:allow-show`。这一步属于跨端行为改动，需要真机验证，**本次没有直接改**，先交统筹排期。
  3. 在此之前，lib.rs 的注释和 T9 结论里「首帧窗口底色修复」应注明「仅 Windows 有效」。

### M2 · 原生底色在启动时取一次后不再更新（Rust + ThemeProvider）

- 位置：`src-tauri/src/lib.rs:258-261`、`src/theme/ThemeProvider.tsx:24-27`
- 现象：原生底色在 `setup` 里按**系统外观**设置一次。用户在应用内选择与系统相反的主题，或者系统外观在运行中切换时，原生层仍保留旧色。Windows 上拖大窗口时，新露出的边缘和 8px 内缩缝会先闪一下旧主题色，然后才被 WebView 重绘覆盖。
- 另外，`setup` 运行时 Tauri 已经按配置创建并显示了窗口（`tauri-2.11.5/src/app.rs:2524-2531`），所以 Windows 上也存在一个极短的系统默认色窗口期。
- 建议：ThemeProvider 的主题 effect 里同时调用 `getCurrentWindow().setBackgroundColor(backdrop)`（capability 加 `core:window:allow-set-background-color`）。颜色取 `getComputedStyle(root).getPropertyValue('--backdrop')`，不要再手写一份。该项涉及 UI 文件，**交 UI设计工程**。capability 的改动可以由我配合。

### L1 · `theme-color` 同步的是 canvas，窗口实际外露的是 backdrop

- 位置：`src/theme/ThemeProvider.tsx:26`、`public/startup.js:11`、`index.html:6`
- 曜石结构下，窗口四周和侧栏外露的是 `--backdrop`（#0c0d10 / #ececef），不是 `--canvas`。Tauri 桌面端基本不读 `theme-color`，影响很小。但 T4 文档里「用于同步系统标题栏配色」的语义已经不成立。
- 建议：如果要保留，`canvas.json` 增加 `backdrop` 字段，并让 lib.rs 和 CSS 从同一处取值。这样也能顺带消除 M1/M2 里那份手写的 RGB。在此之前，新增的守卫测试会锁住两边一致（见下文「已做修改」）。

### L2 · 历史详情里每条失败记录都会弹一次 `role="alert"`

- 位置：`src/history/details/HistoryChanges.tsx:17`
- 现象：`<Notice>` 默认 tone 是 `danger`，对应 `role="alert"`。改造前这里是不带 role 的 `<p>`。现在每展开一个失败记录，读屏器都会打断并播报一次，多条失败时会连续打断。
- 建议：显式写 `role="status"`，或者改成 `tone="warning"`，与同文件第 20 行的截断提示保持一致。**交 UI设计工程**。
- 同类但影响较轻：`GitDiffView.tsx:41` 的冲突提示、`ProviderSection.tsx:147` 的 `formNotice`，原先没有 role，现在都带了 `role="status"`。语义上合理，保留即可。

### L3 · `.workbench` 新增 `overflow: hidden` 后，内部浮层依赖 max-height 兜底

- 位置：`src/workspace/workspace.css:166-170`、`src/components/workbench.css:19,29`、`src/git/worktrees/worktrees.css:42`
- 现状：项目切换、更多工具、Worktree 提醒这三个浮层都用 `max-height: calc(100dvh - …)` 加 `100cqw` 收在圆角内容面里，生产用例在 720×480 下也断言了不溢出。全屏遮罩（`modal-scrim`）、ConfirmDialog、ControlPopover 都挂在 `.workbench` 之外或通过 portal 渲染，不受影响。
- 风险：以后任何直接写在 Workbench 子树里的 `position: absolute` 浮层（终端右键菜单、新的工具栏下拉）都会被圆角裁掉，而且这种问题不报错。
- 建议：在 `workspace.css` 的 `.workbench` 规则上加注释说明这个约束，新浮层一律走 `ControlPopover` 的 portal。**交 UI设计工程**，T15 重做工作台时一并处理。

### L4 · 测试只覆盖十六进制令牌，半透明令牌的对比度从未被测（已补）

- 位置：`src/theme/graphite.test.mjs:20-23`
- `palette()` 只匹配 `#rrggbb`，`--danger-soft`、`--warning-soft`、`--border` 这些用 `rgb(… / a%)` 写的令牌会被静默跳过。Notice 的正文、图标和动作按钮恰好都落在这类底色上。实测全部达标，最弱的一组是暗色 warning-soft 叠在 raised 上的 accent 按钮文字，4.51:1。但这个结论此前没有任何测试保护。
- 处理：已新增守卫测试（见下文）。同时观察到：`--text-faint` 放在暗色 warning-soft 上只有 3.80–4.36:1。目前 Notice 内没有用 faint，**提醒 UI设计工程：Notice 内禁止使用 `--text-faint`**。

### L5 · `startup.js` 依赖 meta 一定存在，缺失时平台标记也会一起丢失

- 位置：`public/startup.js:11`
- `querySelector(...).content` 遇到 null 会抛错。由于这一行在设置 `data-platform` 之前，抛错后 macOS 的 28px 让位和 Windows 的自绘标题栏都会一起失效。目前只有 `index.html` 引用了 startup.js，并且 vite 插件保证占位符会被替换，所以**当前不会触发**。
- 建议：改成 `var m = document.querySelector(...); if (m) …`，或者把平台检测挪到前面。这是一行防御性改动，交给负责 startup.js 的人顺手处理。

### L6 · 小的清理项（不影响行为）

- `src/provider/project/ProjectProviderSection.tsx:53-54`：三元表达式外多套了一层 `<>…</>`，可以去掉。
- `--sidebar-active-shadow: none` 在亮暗两套中都还保留，但 `sidebar.css` 已经不再引用，可以删除。
- `motion.css` 的令牌已经迁到 `styles.css`。如果某个懒加载 chunk 单独引入 `motion.css` 而没有 `styles.css`，`--motion-*` 会变成未定义。实际上 `styles.css` 是全局入口，不会发生，记录在此备查。

---

## 逐项核对：没有发现问题的部分

- **主题单一来源**：`canvas.json` 同时供给 vite 注入的 CSS 变量、index.html 的 meta、ThemeProvider 和 xtermTheme，graphite.test 覆盖了首帧、HTML、CSS、xterm 四方一致以及调色板变更后的传播。插件对非法颜色会直接抛错，配置文件直接 import json，保证改值后 dev server 会重启。没有问题。
- **xterm**：background 和 cursorAccent 引用 canvas，ANSI 蓝（208°）与强调靛蓝已经拉开。亮色 `white` 8.57:1、`brightBlack` 停留在 dim 兜底窗口这两条既有规则保留。CodexThemeSync 测试的期望值随调色板更新，算法本身没改，属于预期内的更新。
- **IPC / 功能**：新加的重试按钮调用的都是现有回调（`onRefresh`、`state.reload`、`model.reload`、`model.refresh`、`prices.reload`），没有新增命令，也没有改 IPC 契约。HistoryStatus 的 key 从「错误文案」改成「来源」，修掉了两条错误文案相同时出现重复 key 的隐患。
- **焦点与键盘**：全局焦点环改走 `--focus-ring`（等于 accent，对比度 ≥3:1 已测）。Notice 按钮有 `:focus-visible` 样式。凡是去掉 outline 的地方都有 box-shadow 或 inset 竖条作为替代。
- **reduced-motion**：新增的快捷键面板入场和逐行错峰、Provider 分段滑块和状态切换、工具菜单入场，都在对应文件里有 `prefers-reduced-motion` 关闭规则。`--motion-exit` 180ms 仍然与 `Presence.EXIT_MS` 一致，并由测试锁定。
- **测试夹具是否掩盖问题**：`useCollabTasks.test.ts` 只补了一个 `navigator` stub，因为 i18n store 在 node 环境下会读 `navigator.languages`。`afterEach` 里已有 `unstubAllGlobals` 和 locale 复位，不会掩盖业务问题。生产用例新增的断言是加强了覆盖（壁纸、字体、字号偏好保留，紧凑窗口下浮层不越界，选中竖条几何），没有放宽原有断言。Provider 圆角从 10 改为 12 是令牌定稿的预期变化。
- **性能**：`.workbench` 加了圆角裁剪和大半径阴影，内部是 WebGL 终端。perf-interactions 用例通过，也没有出现终端重建。阴影是静态的，不参与动画，可以接受。

## 已做修改（只涉及测试，不碰 UI 文件）

- 新增 `src/theme/obsidianNative.test.mjs`，共 3 项，全部通过：
  1. 解析 `lib.rs` 里 `paint_native_backdrop` 手写的两组 RGB，断言与 `styles.css` 亮暗两套 `--backdrop` 一致。以后谁改了一边忘了另一边，测试会直接失败。
  2. 亮暗两套主题下，`text-muted`、`accent`（≥4.5:1）以及状态色图标（≥3:1）叠在 `danger-soft` / `warning-soft` 上，再落到 canvas、panel、surface、raised 四种表面时的对比度。半透明色先按 alpha 合成到底色上再计算。

## 交接（2026-11-13 按统筹分工更新）

| 项 | 负责 | 状态 |
| --- | --- | --- |
| M1 macOS 首帧 | 资深全栈开发（T17） | 已完成，待真机确认，见文末 |
| M2 运行时原生底色跟随主题 | 资深全栈开发（T17） | 已完成 |
| L1 theme-color 改为同步 backdrop | 资深全栈开发（T17） | 已完成 |
| L5 startup.js 防御 | 资深全栈开发（T17） | 已完成 |
| L2 历史失败记录的 alert 播报 | UI设计工程（随 T15） | 已处理（第二轮复核：`HistoryChanges.tsx:17` 已显式 `role="status"`） |
| L3 浮层裁剪约束写进注释 | UI设计工程（随 T15） | 已处理（第二轮复核：`workspace.css:156-159` 已写约束注释） |
| WorkbenchToolbar.test 失败 | UI设计工程（随 T15） | 当前工作区已通过 |
| L6 清理 | 未分配 | 可选 |

T15 / T12 / T14 交付后，按同样的方式继续审查，结果追加到本文档。

## 附：审查期间工作区出现的新改动（T15 进行中）

审查后半段，工作区里新出现了 `src/App.tsx`、`src/components/WorkbenchToolbar.tsx`、`src/workspace/components/Sidebar.tsx`、`src/layout/components/TerminalPane.tsx` 和 i18n 文件的改动，应该是 T15 正在进行的工作。在这批改动上 `pnpm test` 有 1 项失败：`src/components/WorkbenchToolbar.test.tsx:20` 期望工具栏里出现「快速打开」文案，新工具栏的搜索按钮只剩图标，没有可见文本。请 T15 交付时决定：如果是有意去掉文案，就同步更新测试；如果不是，就把文案恢复。上面「已做验证」一节的通过结果针对的是 T4/T7/T11 的改动，在新改动出现之前已全部跑完。T15 交付后我会按本文档的方法单独审查。

## 审查必查项更新（2026-11-13）

依统筹转达的用户硬性要求，后续审查 T15、T12 以及之后的交付时，新增必查项「**与设计稿是否一致**」：
- 主工作台对照 `directions/workbench.html?dir=b` 和 `shots/b-*.png`；设置、快速打开、插件中心、弹窗对照 `obsidian-screens/` 的页面和 `shots/`；令牌对照 `obsidian-tokens.md`。
- 交付物里必须有「实装 vs 设计稿」并排截图，每处偏差都要逐条写明理由。缺少并排截图，或者偏差没有理由的，审查记为不通过。
- 逐区核对的内容：布局结构、间距、字号、圆角、图标尺寸、状态样式（hover、选中、焦点、错误），不只看颜色。
- 稿子没覆盖的界面（比如房间），检查是否沿用同一套语言，以及是否已经由 UI设计工程确认。

## T17 处理结果：M1 / M2 / L1 / L5（2026-11-13）

| 项 | 处理 |
| --- | --- |
| M1 首帧闪色 | 两份窗口配置都加了 `"visible": false`。新文件 `src-tauri/src/window_reveal.rs`：setup 阶段按系统外观先涂上 backdrop；前端 `ThemeProvider` 首次生效后等两帧（保证 React 第一帧已经画出），再调用 `app_window_backdrop`，原生侧这时才 `show()` 并 `set_focus()`。**超时兜底**：3 秒内前端没有调用（崩溃、备份恢复页没挂 ThemeProvider 等情况），原生侧也会自己显示窗口，并记一条 warn 日志。macOS 和 Windows 走同一条路径。 |
| M2 运行时跟随 | 每次主题变化都会调用 `app_window_backdrop`，原生窗口和 WebView 的底色一起更新。命令在 Rust 侧直接操作窗口，不需要给 JS 开 `core:window:allow-show/set-background-color` 权限，capability 文件没有改动。 |
| L1 theme-color | 新增唯一来源 `src/theme/backdrop.json`。vite 插件把它注入 `theme-color` 和 `belfry-backdrop-*` 两个 meta；startup.js 和 ThemeProvider 都改为同步 backdrop；Rust 用 `include_str!` 读同一份文件。`obsidianNative.test.mjs` 锁住 backdrop.json、`styles.css` 的 `--backdrop` 和 Rust 兜底值三者一致。 |
| L5 startup.js | 平台标记提到 meta 操作之前；meta 缺失时直接跳过，不抛错。新增测试，覆盖 meta 全部缺失时平台标记和主题仍然正确写入。 |

验证：`cargo check` 通过；`cargo test window_reveal` 2/2；`pnpm test` 195 个文件、1262 项；`pnpm build` 通过，`dist` 的 theme-color 为 `#0c0d10`；生产浏览器用例（production-ui、panels、security）20/20。

### 需要用户在真机上确认（浏览器夹具测不到原生窗口）

先打 release 包，或者用 `pnpm tauri dev`。每一步都**冷启动**（完全退出后重新打开），最好录屏逐帧看：

1. 系统外观暗色，应用主题「跟随系统」：窗口出现时直接就是暗色界面，不能有白色或灰色闪一下。
2. 系统外观暗色，应用里手动选亮色：窗口出现时直接是亮色，不能先闪一下暗色或白色。
3. 系统外观亮色，应用主题「跟随系统」：直接是亮色。
4. 系统外观亮色，应用里手动选暗色：直接是暗色。
5. 运行中在应用里切换主题，然后快速把窗口拖大：新露出的边缘和内容面四周 8px 的缝应该是新主题的底色，而不是旧主题的。
6. 启动耗时：窗口出现的时间和以前相比，不应该有肉眼可见的变慢（正常情况下只多两帧）。日志里**不应出现** `Main window revealed by timeout`。如果出现了，说明前端没有调到命令，请把日志发回来。

macOS 和 Windows 各做一遍。Windows 上额外确认一下自绘标题栏和窗口阴影、圆角在窗口出现的那一刻就是完整的。


## 第二轮（T24，2026-11-13）：T15 / T12 / T20 / T22 未提交改动

范围：`obsidianWorkbench.css`、`WorkbenchToolbar.tsx`、`Sidebar.tsx`、`TerminalPane.tsx`、`App.tsx`（T15）；`obsidianSurfaces.css`、插件中心、弹窗（T12）；设置 7 个分区（T20）；房间（T22）。T20 / T22 是本人写的，按同样标准自审，问题照样列出。

验证基线（当前工作区）：tsc 通过；vitest 195 个文件 1263 项；build 通过；生产浏览器用例全量 155/155；`obsidian-contrast.mjs` 退出码 0；i18n 键在中英两份 locale 里逐条核对，变更文件没有缺键（`rooms.*` 嵌套键是脚本误报，已人工确认存在）。

### 结论

没有阻断问题。快捷键和 Quick Open 入口、会话切换 / 改名 / 拖拽分屏、未保存保护、焦点归还都按原契约工作，全量用例覆盖到了。有 1 个中等问题（M3：顶栏给每个项目额外开了一路 3 秒的 git status 轮询），其余是低风险问题和清理项。

### M3 · 顶栏分支面包屑新增了一路常驻的 `git status` 轮询（性能 · T15）

- 位置：`src/components/WorkbenchToolbar.tsx:62-64`（`BranchCrumb` → `useGitStatus`）、`src/git/useGitStatus.ts:6,42`
- 现象：`useGitStatus` 每 3 秒执行一次（窗口可见时，另外窗口每次获得焦点也会执行一次），后端每次跑 `git rev-parse` 加 `git status --porcelain=v2 --untracked-files=all`。原来只有打开 Git 面板时才轮询；现在只要有项目就**常驻**轮询，打开 Git 面板时还会**再叠一路**（两个 hook 实例各自计时，互不共享）。大仓库或 untracked 文件很多时，`--untracked-files=all` 每 3 秒全量扫描一次，CPU 和磁盘开销明显；而面包屑只用到 `branch` 一个字段。
- 复现：打开任意本地项目，在 devtools 里统计 `git_status` IPC，每 3 秒一次；再打开 Git 面板，变成每 3 秒两次。
- 建议（非 UI，可由我来做，等 UI设计工程 T21/T23 收尾、不再改 `WorkbenchToolbar.tsx` 时再动）：后端加一个轻量的 `git_branch` 命令（`git symbolic-ref --short -q HEAD`，失败时回退 `rev-parse --short HEAD`）；前端 `useGitBranch` 只在窗口获得焦点、切项目、终端 cwd 变化时读取，不定时轮询。或者让 `useGitStatus` 按 rootPath 共享同一个轮询实例，面包屑跟着 Git 面板的数据走。**请统筹排期。**

### L7 · 弹窗次要按钮 disabled 态没有视觉区分（UI · T12）

- 位置：`src/components/obsidianSurfaces.css:123-127`（`:root .modal__actions button` / `:hover`）、对照 `src/workspace/workspace.css:327-340`
- 现象：`.modal__actions button` 被提高特异度后重写了底色、描边和 hover，但 disabled 态只有 `.modal__primary:disabled` 有规则（opacity .55）。普通按钮 disabled 时 opacity 仍是 1、cursor 仍是 pointer，hover 还会换底色。在浏览器里实测：`ProviderForm.tsx:89` 的「取消」在 `busy` 时是 disabled，看起来却和可点击一样。
- 复现：生产构建里，在 `.modal__actions` 中放一个 disabled 按钮，computed `opacity: 1`、`cursor: pointer`。
- 建议：补上 `:root .modal__actions button:disabled { opacity: .45; cursor: default; }`，并把 hover 改为 `:hover:not(:disabled)`（`.modal__danger:hover` 同理）。**交 UI设计工程。**

### L8 · 顶栏会话标签用了 `role="tablist"`，但没有 tabpanel 和方向键（a11y · T15）

- 位置：`src/components/WorkbenchToolbar.tsx:85,98-100`
- 现象：tablist / tab 语义要求方向键在标签之间移动、配 `aria-controls` 对应的 tabpanel，并且只有选中项可 Tab 聚焦（roving tabindex）。现在每个标签都是普通的可 Tab 按钮，没有方向键处理，也没有关联面板。读屏会念「标签页 1/3」，用户按方向键却没有反应。另外 tablist 的 `aria-label` 用的是「当前会话 {{name}}」，作为整组的名字不合适，每个 tab 的 title 也都是「当前会话 xxx」，包括没选中的那些。
- 建议：要么补齐方向键和 roving tabindex，要么去掉 tablist / tab 角色，改为普通按钮组：`role="group"` + `aria-label="同项目会话"`，每个按钮用 `aria-current="page"` 表示当前项，title 只写会话名。后一种改动小，和侧栏行的语义一致。**交 UI设计工程**（需要新增一条 i18n）。

### L9 · 品牌色 `#d9825b` 硬编码三处（令牌 · T15 / T20）

- 位置：`src/workspace/obsidianWorkbench.css:58,70`、`src/settings/obsidianSections.css:76`（T20，本人写的）
- 现象：Claude 图标块的品牌橙直接写了 hex，亮暗共用一个值。亮色下 `#d9825b` 落在 `--sidebar-hover` 或 `--surface` 上约 2.6:1，作为图标（非文字）勉强可以接受，但不受主题控制，也不在 `obsidian-contrast.mjs` 的检查范围内。
- 建议：在 `styles.css` 加一个 `--brand-claude` 令牌，亮色取深一档，比如 `#b8653f`（≥3:1）。两个 css 都改用令牌，并把它加进对比度脚本。令牌和脚本由我来做；obsidianWorkbench.css 那两处**交 UI设计工程**，obsidianSections.css 由我同步改。

### L10 · `:root:root { --toolbar-height: 44px }` 双重提权（级联 · T15）

- 位置：`src/workspace/obsidianWorkbench.css:95`；原值在 `src/styles.css:94`（60px）
- 现象：注释说是为了压过 Vite 拆包后的加载顺序。实际上 `--toolbar-height` 只有这两处定义，被 `workspace.css:168,219` 和三个浮层的 max-height 使用。两处值不一致，以后有人改 `styles.css` 里的 60 不会生效，排查会很困惑。
- 建议：直接把 `styles.css:94` 改成 44px，删掉这条 `:root:root`。**交 UI设计工程**（styles.css 是主题文件）。

### L11 · 窄窗规则里有已经失效的选择器（死规则 · T15）

- 位置：`src/components/workbench.css:23,41`（`.workbench-search kbd`、`.workbench-search span`）；`src/workspace/quietSidebar.css:4-7`（`.sidebar-brand*`）；`.sidebar-foot__label` 的样式
- 现象：T15 把顶栏搜索改成纯图标、把品牌块并进了工作区切换行，这些选择器已经匹配不到任何元素。不影响行为，但会误导后来的人（比如以为窄窗下要隐藏的 kbd 还在）。
- 建议：随 T15 收尾时一起删掉。**交 UI设计工程。**

### L12 · 后台任务在进入「会话状态」页时自动读取一次（行为变化 · T20，本人）

- 位置：`src/terminal/daemon/BackgroundSessions.tsx:31-34`
- 现象：照 T19 稿改成常驻展开后，进入分区就会调用一次 `terminal_background_sessions`，原来要点开折叠块才调用。调用只读、很轻，用例覆盖到了。`useEffect` 用了 `eslint-disable` 压掉 deps 警告，`refresh` 每次渲染都重建；目前只在挂载时跑一次，是对的，但写法不够干净。
- 处理：可以接受；下次碰这个文件时改成 `useCallback`。记录在案。

### 已自行修复（非 UI，或本人 T20 文件）

- 删除 `src/provider/provider.css` 里 5 条 `.provider-routing-summary*` 死规则（T20 把「当前选择」改为 group 后，这个类已不再渲染）。
- 本文档交接表的 L2 / L3 状态更新为「已处理」（见上表）。

### 逐项核对：没有发现问题的部分

- **快捷键与 Quick Open 入口**：侧栏搜索条、顶栏图标、⌘K 三个入口都调同一个 `toggleQuickOpen`，`aria-expanded` 跟随状态。顶栏按钮保留了 `aria-label="Quick Open"` 和带快捷键的 title；窄窗（≤280）时隐藏，改由「更多工具」菜单承接（`.workbench-menu__narrow`）。
- **会话切换 / 改名 / 拖拽分屏**：顶栏标签和侧栏走同一个 `layout.activateTab`；改名（双击 / F2）和拖拽仍然只在侧栏，`SessionRow` 的拖拽和改名逻辑没有改（diff 只包了一层 tile / text 的展示）。单项目时组头 `disabled` 不可折叠，避免折起来后整个列表消失。
- **Git 分支读取失败与非仓库**：`BranchCrumb` 只在 `report.repository && branch` 时渲染；读取失败、非仓库、没有项目（SSH）时都返回 null，不报错也不占位。分离 HEAD 时后端给的是 `(detached)`，面包屑会显示字面量「(detached)」。GitPanel 对这种情况做了本地化（`GitPanel.tsx:76`），面包屑没有。**轻微**：建议面包屑在 `(detached)` 时显示短 commit，或直接不渲染，并入 L8 交 UI设计工程。
- **未保存保护**：设置各分区 `onGuardChange` 契约不变（Provider 编辑、快捷键录制、备份 busy、Hook 预览、关于页更新弹窗），用例「Provider keep replace clear … preserves guarded editor」「shortcut settings retain the edit」通过。
- **焦点归还**：快捷键编辑取消 / 保存后回到 `#shortcut-edit-*` / `#shortcut-reset-all`（id 保留）；ConfirmDialog、Quick Open 的焦点归还用例通过。
- **会话标签重渲染**：`SessionTabs` 随 `Workbench` 每次渲染而渲染，最多 6 个按钮，没有订阅额外状态，开销可以忽略。
- **reduced-motion**：新增的过渡（`.workbench-tab`、`.sidebar-search`、`.os-btn`、`.room-task-*`、`.shortcut-settings__collapsed`）都在 motion.css 的全局降级、`.settings-content` 的全局降级，或各自的 `@media (prefers-reduced-motion)` 覆盖范围内。Provider 翻转在 reduced-motion 下零动画，有用例断言。
- **图标按钮 aria-label**：顶栏搜索 / 检查器、侧栏折叠、底栏图标（文字改为 sr-only 的 `.sidebar-foot__text`）、设置各分区的刷新图标按钮都有 aria-label 或可读文字。
- **对比度**：新增组合都在已核算的令牌范围内（徽标、notice、accent-soft 上的 muted）。唯一的例外是 L9 的硬编码品牌色。

### 交接（第二轮）

| 项 | 负责 | 状态 |
| --- | --- | --- |
| M3 面包屑常驻 git status 轮询 | 资深全栈开发（需等 T21/T23 不改 WorkbenchToolbar 后） | 待统筹排期 |
| L7 弹窗次要按钮 disabled 态 | UI设计工程 | 待处理 |
| L8 会话标签 tablist 语义 / detached 显示 | UI设计工程 | 待处理 |
| L9 品牌色令牌 | 资深全栈开发（令牌 + 对比度脚本 + obsidianSections.css）/ UI设计工程（obsidianWorkbench.css） | 待处理 |
| L10 `--toolbar-height` 双定义 | UI设计工程 | 待处理 |
| L11 死规则清理 | UI设计工程 | 可选 |
| L12 BackgroundSessions effect 写法 | 资深全栈开发 | 记录，下次顺带 |

## T27 接续修复复核（2026-11-13）

用户要求由资深全栈工程师2接手其余成员的剩余工作。原 T23 / T25 / T26 统一在 T27 记录交付，完整证据见 [settings-shell/README.md](settings-shell/README.md) 与 [并排截图](settings-shell/index.html)。上方第二轮交接表为审查时的历史状态，以下为最终状态。

| 项 | 最终状态 |
| --- | --- |
| M3 | 已修：BranchCrumb 改用 useGitBranch，项目目录变化和获焦 / 重新可见时轻量读取；静置 6.5 秒没有 Git 调用，无额外 git_status 轮询。Rust 命令的具名 / detached / unborn / 非仓库测试通过。 |
| L7 | 已修：弹窗所有按钮 disabled opacity .45，hover 排除 disabled；生产 busy Provider 保存用例核对次要按钮悬停前后样式不变。 |
| L8 | 已修：group + 本地化组名、aria-current=page、会话名 title；分离 HEAD 使用短提交号和本地化标题。生产点击切换和当前项语义验证通过。 |
| L9 | 已修：两份设置 / 工作台 CSS 均使用 --brand-claude；沿用 T26 的亮暗令牌与对比度检查。 |
| L10 | 已修：44px 在 styles.css 唯一定义，删除 :root:root 重复覆盖。 |
| L11 | 已清理：workbench-search span/kbd、sidebar-brand*、sidebar-foot__label 的失效规则。 |
| L12 | 保留原审查结论：可接受，未扩大本次变更范围。 |

T23 同时补齐了设计稿外壳、240px 导航、8px / r12 / shadow-content、880px 含内边距限宽、单张 Provider 保留网格轨道和 640px 上下布局。T20 十条偏差已逐条给结论；「高级配置」独立列表入口涉及新草稿数据流，保留现有编辑页入口并单列为用户选择，没有擅自改变读取 / 保存行为。

回归中一条旧测试仍把 `.settings-view` 当作 canvas；T23 外壳改为 backdrop 后，该断言已改查 `.settings-content`，继续检查插件搜索焦点背景确实等于内容画布。

最终验证：196 文件 / 1267 单测、31 文件 / 159 浏览器用例全部通过；build、cargo check、Rust 分支读取测试、对比度、diff 检查均通过。最终构建 `index-jjqkZ_uD.js / index-CZtyR30e.css`，完整日志和截图哈希在 `settings-shell/logs/` 与 `settings-shell/manifest.json`。未将合成浏览器平台标记当作真机 WKWebView / WebView2 验证。

## T28 用户要求覆盖限宽规则（2026-11-13）

用户明确要求「右侧不允许留白」后，设置正文改为填满可用宽度，Provider 使用 auto-fit 收起空轨道。上面 T27 的 880px 限宽与保留空轨道是历史验收结论，已被本次要求替代，其余审查修复保留。验证与截图见 [settings-shell/full-width/README.md](settings-shell/full-width/README.md)。
