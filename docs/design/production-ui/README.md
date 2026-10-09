# Graphite 生产 UI 落地与验证

## 结果和正常入口

**新设计已经接入生产 `src/`，不再仅是独立 HTML 原型。** 正常入口仍是 `index.html → src/main.tsx → src/App.tsx`，它继续使用真实的 Workbench、Sidebar、SettingsPanel、Provider 以及业务 IPC。`docs/design/belfry-ui/` 只保留设计参考，不被生产代码导入。

本次 `pnpm build` 成功产出包含 Graphite 的 `dist`。已安装的旧应用包不会因为源码变化自动更新；本轮未制作、安装或发布桌面安装包，也未启动会触发真实用户库迁移的桌面实例。

[查看生产构建实际截图](index.html)。这是实际构建的浏览器证据页，不是替代生产程序的展示原型。截图中的项目、API、文件、会话和统计均由测试适配器提供合成数据；没有读取用户配置或终端记录。

## 宿主界面覆盖表

所有既有设置栏目的键、跳转入口、细粒度控件和业务数据来源保留。双主题统一为石墨深色 / 暖白浅色，没有新增三套主题模式或覆盖用户字号、壁纸偏好。

| 范围 | 生产文件（相对 src/） | 本轮改动与检查 |
|---|---|---|
| 全局主题与字体/控件 | `styles.css`、`theme/xtermTheme.ts`、`components/controls/fields.css` | Graphite 颜色、圆角、焦点、输入控件；CSS 与 xterm 底色/前景/滚动条一致性测试；标准文字对比度测试；ANSI 语义色、透明背景和 dim 补偿逻辑保留 |
| 工作台、工具栏、空状态 | `components/Workbench.tsx`、`WorkbenchToolbar.tsx`、`workbench.css` | 终端优先布局；搜索文本、直接协作待确认与主题入口；可操作空状态；宽窄窗口点击与主题切换检查 |
| 侧栏、会话与分屏外壳 | `workspace/components/Sidebar.tsx`、`sidebar.css`、`quietSidebar.css`、`workspace.css`、`layout/layout.css` | 品牌/工作区/会话/工具层级，工具入口文字化，终端标题层级；修复长名称撑宽和页脚高度；真实 DOM 会话选择/拖动分屏、终端不卸载检查 |
| 项目库、命名工作区、SSH | `workspace/projects/projectLibrary.css`、`workspace/named/namedWorkspaces.css`、`workspace/sshDialog.css` | 列表、表单、选择与弹窗间距统一；真实项目/SSH 弹窗、命名工作区重命名、长名称与焦点归还；深浅主题三尺寸检查 |
| 设置导航、所有原有栏目 | `settings/SettingsPanel.tsx`、`settings.css`、`settingsShell.css` | 5 个目的分组、搜索只过滤导航；9 个原有栏目仍在；未保存时搜索不卸载编辑器；深浅主题三尺寸遍历每个栏目 |
| 外观、字体、壁纸 | `background/components/appearance.css`、`fontImportCard.css` | 共用表面/控件节奏；原字体导入、字号、壁纸及细粒度设置保留；设置页生产浏览器与现有测试 |
| 全局/项目 Provider | `provider/components/{ProviderCard,ProviderSection,ProviderOfficial,ProviderSettingsHeader}.tsx`、`provider.css`、`configEditor.css`、`project/ProjectProviderSection.tsx`、`projectProvider.css` | 行式列表、作用域和生效提示、配置/选用/验证状态区分；保留 M1 保留/替换/清除和敏感预览门禁；生产路径验证三种动作与未保存保护 |
| 会话状态/后台会话、快捷键、备份、诊断、关于 | `agent/hooks/hooks.css`、`shortcuts/custom/shortcutSettings.css`、`backup/backup.css`、`setup/environment.css`、`about/about.css` | 栏目视觉统一，后台会话继续显示在会话状态栏目；原功能保留，共享控件覆盖；生产设置矩阵与前端完整回归 |
| 协作 | `collab/CollabPanel.tsx`、`collab.css` | 状态过滤、计数、结果展开、错误说明；批准派活测试，显示实际合成任务，不硬编码生产假状态 |
| 文件/Git/工作树 | `filepreview/FilePreviewPane.tsx`、`filePreview.css`、`git/GitPanel.tsx`、`git.css`、`worktrees/worktrees.css` | 上下文、标题、树/差异视图、错误重试；生产文件树/Git 差异交互与深浅三尺寸检查 |
| 历史与用量 | `history/components/HistoryPanel.tsx`、`HistorySearchControls.tsx`、历史与详情 CSS；`usage/components/UsagePanel.tsx`、用量/定价/会话统计 CSS | 筛选、来源、恢复/重试和数据表层级；历史搜索/恢复新增会话、用量读取刷新关闭；细粒度定价规则保留；深浅三尺寸检查 |
| 插件中心/宿主弹层 | `plugins/center/{InstalledPage,PageHeader}.tsx`、`styles/{index,tokens-01,graphite}.css` | 状态/来源/权限说明；局部 Graphite 变量映射，不注入第三方 iframe；安装列表/权限/市场/来源设置/详情生产交互通过 |
| 插件启动器/工作面板外壳 | `plugins/center/styles/graphite.css`、`plugins/workspace/PluginDock.tsx`、`workspace.css` | 共享宿主配色、标题和控件/列表样式；原启动器和插件浏览器回归通过；第三方插件自己的 HTML/CSS 排除 |
| Quick Open、更新、通用确认与错误 | `quickopen/QuickOpen.tsx`、`quickOpen.css`、`updater/UpdateDialog.tsx`、`updater.css`、`workspace/workspace.css` | 搜索上下文/键盘、更新说明、确认标题/正文/动作层级；Quick Open 选择/关闭/焦点归还、危险确认键盘测试；加载/空/错误样式统一 |

本轮未改终端输入/生命周期/Rust 生产逻辑。工作区中的 M1 凭据、Hooks、提示投递、会话恢复等原有或并行修改保持原样；它们不是本次 UI 改版重新实现的内容。`terminal/codexThemeSync.test.ts` 只更新了新调色板的测试混色样本，实际同步算法未改。

## 实际执行的检查

| 命令/检查 | 最终结果 |
|---|---|
| UI/主题/Provider/设置/工作区定向 Vitest | 18 文件、123 项通过（后续完整回归包含最终主题文件读取版本） |
| `pnpm test` | **153 文件、877 项通过** |
| `pnpm build` | **通过**；主入口约 1,247.37 kB / gzip 423.83 kB；仍有 >500 kB 分块警告，不以此断言运行卡顿 |
| `TMPDIR="$PI_SCRATCH_DIR/" BELFRY_PANEL_ARTIFACTS="$PI_SCRATCH_DIR/production-ui-qa" node .github/workflows/verify-plugins.mjs` | **178 项通过，0 失败，0 跳过**；包含新增 7 组生产 UI 测试和原生产懒加载/工作区恢复测试 |
| 新增生产夹具与用例 `node --check` | 通过 |
| `git diff --check` | 通过 |

新增 `production-ui.case.mjs` 直接服务 **未修改的生产构建 dist**。`production-uiNative.js` 提供明确合成的 Tauri 命令返回，未提供的命令仍报错；不是 Dev Server，也不导入设计原型。夹具在每组结束确认 `browserErrors/errors/unhandled` 为空。

7 组新增测试覆盖：
1. 工作台深浅主题、三种尺寸、稳定计算颜色、会话选择、真实鼠标拖动分屏、Quick Open 键盘与焦点。
2. 9 个设置栏目 × 两种主题 × 1440×960 / 1024×768 / 820×768。
3. Provider keep/replace/clear、未确认前无原始配置调用、显式确认参数、搜索不丢编辑器、原始文件未保存保护。
4. 项目/SSH/命名工作区/危险确认、焦点归还、长名称后新建按钮仍可点击。
5. 协作结果与批准、文件树/Git 差异、历史搜索/恢复、用量刷新关闭。
6. 插件安装列表/权限、市场来源设置与详情。
7. 协作、文件/Git、历史、用量、项目、SSH 在双主题三尺寸下的主要操作可见、可命中。

每组检查终端 DOM、输入节点仍连接，没有重复创建或关闭；历史恢复只允许预期增加一个创建。它验证 **React/浏览器挂载行为**，不冒充真实 PTY 持续运行测试。

初次检查暴露的长名称撑宽、页脚固定高度导致裁剪均已修复并复测。主题测试的旧色值与测试上下文已更新；截图等待字体/140ms 主题过渡完成后采集，避免把过渡中间色当作最终画面。

## 证据与验收限制

- 精选 11 张截图在 `screenshots/`；完整截图在会话 scratch `production-ui-qa/`。
- 日志：scratch 中的 `production-ui-vitest.log`、`production-ui-build.log`、`production-ui-plugins.log`；起始差异记录为 `production-ui-before.diff` / `production-ui-before-status.log`。
- 构建入口 JS：`assets/index-r9AxlrKp.js`；设置 JS：`assets/SettingsPanel-DpBFUVDX.js`。这些标识对应本轮产物，不保证未来构建 hash 不变。
- 此次未改 Rust 生产代码，因此 UI 回归没有重复执行 Cargo workspace；历史 Rust/M1 通过不作为本轮原生 UI 验收。
- **尚未验收：**Windows/macOS 真实 Tauri WebView、原生窗控与系统 200% 缩放、真实 PTY/CLI 的完整桌面流程。浏览器视口测试不替代这些原生检查。
- 未提供 `BELFRY_PI_SOURCE`，脚本明确列出的 4 类原版 PI 上游互操作未纳入；仓库要求执行的 178 项没有跳过。
- 不做真实用户凭据迁移、不发布、不生成新账号/云同步/遥测，不改第三方插件内部 UI。不将本次结果表述为已安装包更新或全平台验收完成。
