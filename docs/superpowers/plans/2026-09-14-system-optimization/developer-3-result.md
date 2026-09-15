# 开发3交付结果

任务：`j1m2kjgx`，追加生产回归 `ygx9mabc`。已完成范围内实现、同会话差异审查与本机验证；没有提交、推送、打 tag、触发远程 workflow 或发布。
基线为任务包记录的 `439302a`；测试和构建结果来自当前共享工作区，包含其他开发已落地的修改。

最终整合修复 `dmbq2dja` 已补齐 Action v1 API 资产 URL 精确匹配、sidecar `--locked` 和 Node 20 兼容回归，
最新改动与 15 项定向验证见 [developer-3-fix-result.md](developer-3-fix-result.md)。以下原任务测试数字保留为历史证据。

## 追加审查：真实生产资源失败与恢复

先直接服务已有 `dist` 复现，再修改源码和重建。初始生产回归 **2 项通过、1 项失败**：
SettingsPanel 的入口 JS/CSS 首次 503 均能恢复；DatePicker 首次 503 后，HistoryPanel 原入口与加查询参数的入口
都返回 200，但同一文档不再请求 DatePicker，点击重试仍失败。日志：`/tmp/belfry-developer3-production-baseline.log`。
这证明仅重建 React.lazy、或只更换父模块 URL，无法清除浏览器对静态 ESM 依赖的失败缓存。

本轮新增/完善：

- `src/components/lazy/testing/productionFixture.mjs`、`productionNative.js`、`production-panels.case.mjs`：
  用 Node 静态服务器原样提供整个 dist（包括公共字体），不运行 Vite dev server、不改写入口或模块、不禁用浏览器缓存。
  hash 文件名从真实请求匹配；503 来自实际 HTTP 响应。仅模拟原生 IPC，使用真正的 App、React 和 xterm。
- `panelFailure.ts`、`panelImport.ts`、`OptionalPanel.tsx`、`PanelLoadFallback.tsx`：保留错误原因；
  入口更换 URL 的一次局部重试仍失败后，当前文档保存不可继续重试状态，关闭再开也不重置。
  收起无效重试，显示“请先保存终端工作，确认连接正常后手动重新打开 Belfry”和“返回终端”入口。
  Chromium 的顶层错误不可靠地区分入口与静态依赖，所以提示不谎称已定位某个依赖；入口连续两次网络失败也采用这个有界恢复策略。
- `retryImport.ts`：同源 CSS 单独补载并等待完成，允许共享 CSS 文件名；CSS 连续失败仍可再试。
  无安全可重试 URL 的模块错误也转为明确的手动恢复提示，不反复命中相同缓存。
- `.github/workflows/verify-plugins.mjs`、`checks.yml`：生产用例纳入 macOS/Windows 必跑集合，
  使用前一步 `pnpm build` 的 dist，缺少构建直接失败；两个 README 补齐本地构建前置与单独运行命令。

最终 **4 项生产浏览器回归通过、0 失败、0 跳过**：

| 实际故障 | 验证结果 |
| --- | --- |
| SettingsPanel 入口 JS 首次 503 | 新入口 URL 返回 200，真实设置页与外观分区出现 |
| 首个异步 SettingsPanel CSS 首次 503 | 补载 URL 返回 200，真实 stylesheet 的 cssRules 已就绪后显示面板 |
| CSS 连续两次 503，第三次响应暂时挂起 | 保留可用重试；响应未到时仍处于加载状态，实际 CSS 完成后才显示设置页 |
| History/Usage 共用 DatePicker 首次 503 | 两个消费者各一次局部重试仍失败后停止；关闭重开不继续请求失效图，Settings 不受影响；独立新文档可取得同 URL 的 200 并打开两个面板 |

每项检查原 xterm 节点身份、整个过程无节点移除、`terminal_create` 始终 1 次、close/detach 为 0、
页面启动标记不变，关闭失败面板后输入仍到原会话。新文档验证在另一个临时浏览器上下文进行，
原文档与终端继续保留；没有自动刷新全应用，也没有尝试复制 React/共享模块图来绕开缓存。
**共享 ESM 图不能在原文档内恢复时，用户需先保存工作再手动重开；原生退出/重连不在此浏览器测试的证明范围内。**

独立最终日志：`/tmp/belfry-developer3-production-final.log`。
截图：`/tmp/belfry-developer3-production-qa/`，包含 JS/CSS 失败及恢复、共享依赖不可恢复提示、新文档恢复。
已实际查看共享依赖失败提示截图，原终端、说明与“返回终端”按钮均可见。
原有 7 项面板用例使用开发服务器，仍负责交互回归；不再把这些用例称为生产构建证据。

## 改动与所有权

| 范围 | 实际改动 |
| --- | --- |
| `src/components/AppOverlays.tsx` | 设置、历史、用量、Quick Open、快捷指令、更新对话框改为动态导入；按面板、确认框拆分渲染函数 |
| `src/components/lazy/` | 新增局部 Suspense/错误边界、加载状态、模块与 CSS 重试、焦点交接、公共面板样式顺序保护；包含单元与浏览器回归 |
| `src/workspace/useProjectWorkspace.ts` | 从任务包所列 503 行收敛到 49 行，保留公开返回 API |
| `src/workspace/useWorkspace*.ts` | 按恢复状态、启动、环境检测、持久化、项目动作、普通/SSH 启动、历史恢复、会话更新拆分；最长模块 93 行 |
| `src/workspace/testing/` | 真实 React Hook、模拟 IPC 的独立浏览器回归 |
| `.github/workflows/` | 新增 PR/分支及可复用检查、跨平台 Node 运行器、发布完整性校验与 4 项测试；发布改为先草稿、后统一公开 |
| `README.md` / `README.en.md` | 修正失效目录、移除后的 Composer/Recipe 说明、插件与模型 API 范围；补齐可执行的开发/回归命令 |
| 本任务目录 | 本结果及 [原生验收接续](developer-3-acceptance.md) |

没有编辑 `src/App.tsx`、`src/main.tsx`、Rust 根入口、terminal/usage 代码、依赖、锁文件或 Vite/TS 配置。
没有覆盖其他开发修改。工作区存档字段与命名工作区格式保持不变。**无需 Rust 根入口接线。**

## 行为与回归关注点

- 面板关闭时不开始导入，成功导入可复用；加载、失败、重试只影响该面板，常驻工作台保持挂载。
- 重试会重建 React.lazy 实例，并对可识别的同源失败面板入口 URL 添加重试标记；静态共享依赖缓存的恢复界限与停止策略见追加审查，不重载整个应用。
- Vite CSS 预加载失败时先重新取得样式，再展示面板；公共外壳 CSS 复用原文件并保持最后生效，避免异步样式覆盖头部规格。
- 加载中可关闭和使用 Escape；保留保存的面板宽度。结束加载或关闭时按焦点归属返回原控件，旧面板不会抢走新 Quick Open 输入框的焦点。
- 启动在 StrictMode 下只执行一次；恢复 daemon 身份不重新发送项目启动命令；命名工作区切换保持各自活动会话。
- 保留项目选择请求版本，丢弃迟到结果；补齐首启尚未完成时用户选择项目后的持久化就绪状态。
- 终端运行快照不反复写存档；存储失败可重试，关闭后台会话失败不会先移除界面记录；历史恢复等待 Agent 检测，批量恢复保持不同身份与序号。

## 生产拆包

命令：`pnpm build`，追加审查后实际退出码 0；日志 `/tmp/belfry-developer3-production-build.log`。
以下大小直接取 Vite 生产构建输出（kB，gzip 使用 Vite 的口径）：

| 入口 | JS | gzip |
| --- | ---: | ---: |
| 主入口 `index` | 1,237.72 | 420.33 |
| 设置 `SettingsPanel` | 288.21 | 85.87 |
| 历史 `HistoryPanel` | 29.09 | 9.63 |
| 用量 `UsagePanel` | 25.92 | 9.21 |
| 快捷指令 `ShortcutGuide` | 7.22 | 2.87 |
| Quick Open | 5.94 | 2.49 |
| 更新对话框 `UpdateDialog` | 3.66 | 1.32 |

另有 `layerOwnership` 10.93 kB、`DatePicker` 7.13 kB、`NumericField` 1.54 kB、`list-checks` 0.27 kB 的共享 chunk。
主 JS 相对基线约 1,591.64 kB 减少 353.92 kB（约 22.2%）；这不是启动耗时或整体运行内存的测量。
HTML 的脚本与 modulepreload 包含主入口和 `layerOwnership`，合计 1,248.66 kB，相对基线约减少 21.5%。
六个面板还有各自的异步 CSS。保留既有主包大于 500 kB 的提示，没有修改警告阈值。

## 实际验证

| 验证 | 结果 | 本机证据 |
| --- | --- | --- |
| `pnpm test` | **142 文件，810 项通过** | `/tmp/belfry-developer3-production-frontend.log` |
| `pnpm build` | **通过**，含 TypeScript 工程检查与真实分包 | `/tmp/belfry-developer3-production-build.log` |
| `node .github/workflows/verify-plugins.mjs` | **171 项通过，0 失败、0 跳过**；含全部 4 项生产回归 | `/tmp/belfry-developer3-production-ci.log` |
| `node --test src/components/lazy/testing/production-panels.case.mjs` | **4 项通过，0 失败、0 跳过**；补齐公共静态文件后的最终定向验证 | `/tmp/belfry-developer3-production-final.log` |
| `node --test .github/workflows/release-assets.case.mjs`（原任务） | **4 项通过**；覆盖缺平台、空文件、缺签名、同文件覆盖、版本/URL 不符、已发布版本及下载响应格式 | 原任务工具实际输出 |
| `TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs`（原任务） | **通过**，真实 host debug CLI 已按 externalBin 命名准备 | `/tmp/belfry-developer3-sidecar.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --workspace --offline --locked`（原任务） | **576 项通过、9 项忽略、0 失败** | `/tmp/belfry-developer3-rust.log` |
| 两个 workflow YAML | Ruby/Psych 解析通过；已核对官方 tauri-action v1 的 `releaseId`、`releaseDraft`、`tagName`、`updaterJsonPreferNsis` 输入 | 本轮工具实际输出 |
| 文档/差异/尺寸约束 | 本地链接存在、失效目录引用已移除、改动生产文件均小于 300 行、`git diff --check` 通过 | 本轮定向检查 |

追加任务仅改变面板恢复与测试/CI 文档，未重跑 Rust 或 release validator；上述对应行明确保留原任务证据。
浏览器集合含 **4 项生产面板回归、7 项开发服务器面板回归与 6 项工作区回归**，使用独立临时端口与临时 Chrome 配置，不连接正式 Belfry 或其他开发的浏览器。
覆盖首开导入、加载中关闭、JS 请求失败重试、真实设置模块具名导出恢复、CSS 失败恢复、焦点切换、宽度保持、720×480 浅色与 1440×900 深色布局。
截图位于 `/tmp/belfry-developer3-panel-qa/`；已实际查看窄窗口设置页、加载失败反馈和深色用量页，布局与操作入口可见。
这不是原生 Tauri WebView/ConPTY 的交互证据。

此前完整插件脚本发现 3 个旧 dropdown 断言失败，已记入过程结果；项目经理随后修正了范围外的 `scripts/plugin-tests/dropdown-ui.case.mjs`。
开发3未修改该文件，最终必跑 Node 集合已复测通过。

## CI 与发布设计

1. `checks.yml` 在 PR、分支 push、手动运行及 release 调用时执行；macOS/Windows 使用项目既有 pnpm、Node LTS、Rust stable 约定。
2. 显式执行 `pnpm test`、`pnpm build`、真实 CLI sidecar 准备、Rust workspace、Node 插件/浏览器和发布门禁测试；Windows 另跑受控安装脚本回归。
3. Node 运行器用文件枚举代替 shell glob，兼容 PowerShell；强制浏览器可用，并拒绝必跑集合出现跳过项。日志与面板截图上传为检查产物。
4. 4 项原版 PI Browser/Git Lens/Log Viewer/Todo 互操作需固定上游源码和额外 market-fixtures。未提供时在步骤摘要明确记录，未计入上述 171 项通过数；提供后检查 fixture 路径并纳入必跑集合。
5. Release 先等待双平台检查，再准备私有草稿；三个目标按序上传到同一草稿，避免 latest.json 合并竞争。
6. 最终发布 job 等待全部构建成功，再核对两个 macOS 与 Windows 的更新项、非空文件、签名、安装包、版本和来源，最后一次性公开。失败时草稿保持未公开。
7. 手动重跑要求选择已有且匹配应用版本的 v* tag；不会向已公开版本继续追加不完整产物。

尚未执行远程 PR/release workflow，未证明 GitHub 产物下载/发布与更新客户端端到端通过，也未进行 Windows 实机或原生窗口验收。
这些步骤及 Hook/统计、Worktree 接续明确保留在 [developer-3-acceptance.md](developer-3-acceptance.md)；CM-13 为**已验收，仅待勾选和回读**。

## 流程与交接

实际使用 `belfry`、`frontend-design` 技能。本机已检索的技能目录未提供指定 Superpowers/ui-ux-pro-max，按任务包保持短计划、同会话代码审查、真实回归与完成前核验；未冒充独立代理审查。
所有改动在当前共享分支，保留项目经理统一整合权；原任务已通过 `belfry done j1m2kjgx` 回报，追加任务通过 `belfry done ygx9mabc` 回报。
