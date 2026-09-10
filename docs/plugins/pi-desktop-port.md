# PI-Desktop 插件功能与页面移植

执行日期：2026-09-09 至 2026-09-10。执行者：当前主会话；不委派。

2026-09-10 最新发布：用户明确要求先推送现有代码，再发布独立插件中心。主项目已推送
`feat/multi-agent-collab`，插件中心公开仓库与 GitHub Pages 已上线；真实市场切换、全部包
下载校验及线上页面回归通过，证据见 [GitHub 插件中心发布记录](./github-plugin-center.md)。
下文按执行顺序保留历史记录；此前“未发布 / 待确认”不代表当前发布状态。

## 验收目标

用户明确要求直接移植 PI-Desktop 的插件功能，包含页面。旧的静态实现和部分 API
兼容只作为可复用基础，不作为本次交付边界。上游固定为
`vastsa/PI-Desktop@4fb58d36f4b0f05e4527d8bdf2da874e31933134`。

沿用上游页面结构、文案、样式及交互，在 Tauri 下适配 Electron 接口。保留 LGPLv3
许可证、源码来源与修改说明。不恢复 Harness，不覆盖协作、Provider、终端等无关改动。
用户正在试用的旧 QA 应用继续保留；新版本使用独立标识验收。

2026-09-10 用户追加要求：必须拥有自己的插件市场，也能自行制作插件。增加“我的市场”
作为默认来源；提供模板创建、开发加载、热重载、校验、打包、发布到我的市场以及导出静态
发布目录。最初先完成本地市场与发布产物；自有 GitHub 市场现已上线，地址见上述发布记录。公开 PI
市场保留为可选来源，不把第三方市场当成自有市场交付。

## 执行进度

- [x] **页面与管理流程移植。** 已安装 / 市场双页、分组、搜索、详情、菜单、
  模板、设置、作用范围、权限确认、市场源、安装与更新。新增自有市场、发布和导出闭环。
- [x] **运行与工作区适配。** 嵌入式插件视图、命令入口、主题、设置快捷键、文件授权、
  模型 / 完成 / 会话、浏览器、MCP 与公开 SDK 数据类型已接入。边缘能力与未验证场景见下文。
- [x] **最终自动验证、构建与自审。** 前端 / Rust / Node 回归、原版三插件运行互操作、
  结构检查及独立桌面打包已通过，结果见下方收尾记录。
- [ ] **最新桌面复核受工具阻塞。** 新包生成后 Computer Use 返回 `Sky Computer Use native pipe startup failed`；
  保留此前实际页面操作的证据，不把它冒充为最新包的界面验收。

## 对照来源

| 能力 | 上游文件 |
| --- | --- |
| 插件主页面 | `apps/desktop/src/pages/PluginsPage.tsx` |
| 视觉与设置 | `styles/plugins.css`、`components/plugins/`、`extensions/ScopeControl.tsx` |
| 市场 / 包 / 更新 | `crates/host-core/src/plugins.rs` |
| 插件运行与系统 API | `electron/main/plugin-runtime.ts`、`plugin-host-process.mjs` |
| 视图 / 面板桥接 | `plugin-view-host.ts`、`plugin-panel-host.ts`、`preload/plugin-panel.ts` |
| SDK 与作者工具 | `packages/plugin-sdk/`、`packages/plugin-devkit/` |

## 质量边界

新增宿主行为先做失败用例，再实现；不为复制的纯样式添加实现镜像测试。
对涉及下载、权限扩张、作用范围、会话隔离、卸载清理的行为做真实集成验证。
市场源切换保留离线缓存来源隔离，包下载校验摘要，更新不能静默扩大权限。
页面不放空按钮或假市场条目。实际外部服务限制按证据记录，不能据此自行缩减目标。

新实现按职责拆分；复制的页面与样式也拆为局部模块，避免引入新的巨型文件。
最终验证：Node 插件测试、前端测试与构建、Rust 测试与格式检查、差异检查、独立桌面
构建与真实 UI 操作。Windows 无原生执行环境时明确报告该验证限制。

## 当前验证记录（2026-09-10）

- 已移植已安装 / 市场页面、模板、设置、权限确认、作用范围、来源缓存和更新流程。
- 已接线工作面板、启动器（含原版拼音与历史排序）、独立面板 chrome、文件选择与拖放授权。
- 已修复 CSS 拆分时的注释和动画作用域错误；`pnpm build` 成功。
- 独立 `Belfry PI Port QA.app`（`io.appmakes.belfry.pi-port-qa`）打包成功，插件页已实际渲染。
- 上游 Todo、Git Lens、Log Viewer 清单及目录校验成功；后续原版面板互操作结果见下文。
- 定向验证：设置值 2、启动器 2、上游目录 2、文件授权 2、Rust PI 清单 10 用例通过。
- 模型 / 会话、浏览器、主题全文、剪贴板历史、MCP 资源转发已经接入，互操作和边界回归
  已通过；完整 Electron 等价及原生场景的验证边界见文末。
- 主题全文校验与注入、可搜索主题选择器已接入，定向主题验证 6 项通过。
- 自有市场已实现发布、不可变版本、导出独立网页与 PI 目录；模板支持名称、ID、作者。
  制作 / 市场 / MCP 相关定向测试 13 项通过，包含导出后通过 HTTP 下载同一包的真实请求。
  已加入发布摘要校验、来源切换隔离和最低 PI API 版本检查。
- 自有市场可靠性定向测试 12 项通过；真实 UI 完成创建模板、开发加载、启动、设置、发布、
  修改市场名称和导出。导出站点已通过本地 HTTP 实测搜索、下载入口与复制市场地址。
- Markdown 改用 GFM 渲染并通过安全验证；MCP 提示词、资源和资源模板转发已接入，
  包含工作区隔离、分页和 stdio 目录变更通知。
- 剪贴板历史与图片分块传输已实现，Node 定向测试通过；主窗口粘贴捕获待最终构建验收。
- 模型目录、Responses / Anthropic 单次完成已实现，使用本地 HTTP 假服务验证；
  Rust Provider 网关 3 项定向测试通过，未消耗用户真实 API 额度。已按官方型号区分
  reasoning 等级，不把所有 GPT-5 型号都推断为支持 none/xhigh。
- 会话上下文使用 Codex 的 MCP `_meta.threadId` 或 Claude 显式 session ID 绑定，校验
  日志内的会话 ID 与工作区后有界读取；禁止按目录猜测会话。Node 定向 11 项、Rust 4 项通过。
- 选择文件支持实际内容、分块、流、FileReader、取消、文件变化检测与插件授权隔离。
  拖放按可见视图及坐标路由；真实浏览器页面验证了 5 MiB 文件读取和切片。
- 浏览器接口运行于独立 Chromium profile/context，通过画面流与输入转发嵌入插件页面。
  已通过真实引擎导航、快照、输入、截图、会话隔离和工作区预览验证；原版 browser 插件
  页面互操作结果见下文；最新 Tauri 桌面页面仍需独立检查。
- 主题 CSS、深浅模式及语言自动同步到嵌入与独立面板；真实页面同步测试通过。
  Alt+Space 已接系统全局快捷键，注册失败时降级为应用内快捷键；跨应用唤起尚待实测。
- 本次续接收取完整 Node 插件回归：69 项通过、0 失败。最终修改后仍需再运行完整验证。
- 新独立 QA 构建成功；后续新增剪贴板与模型代码仍需重新构建。桌面控制工具暂报
  `cgWindowNotFound`，Todo 已验收，Git Lens / Log Viewer 尚待桌面验收。

## 本次收尾与自审

- 原版 Browser、Git Lens、Log Viewer 三项互操作通过：使用固定上游源码，未改插件
  fixture。验证实际浏览器页面、工具图片、临时 Git 仓库的改动列表、日志文件内容。
  截图位于 `/tmp/belfry-pi-interop-artifacts/`；这是 Chromium + Node 的证据，不代替 Tauri 验收。
- 面板适配保留原版 HTML，只将 meta CSP 的同源连接能力接到受限 HTTP 桥；浏览器 state
  更新后重报可见区域；公开 readRange 支持 8 MiB，内部自动分块，原版日志插件的 4 MiB 请求可用。
- 面板后台任务保留原工作区授权，工作区切换会撤销旧上下文。Agent 工具使用真实 AbortSignal，
  MCP 取消、请求断开、会话撤销均阻止后续访问及晚到的成功结果。
- MCP 图片转换为标准 image 内容块，stdio / HTTP 的目录变更、分页、资源和提示词均测试；
  远端 resource URI 保持服务隔离，HTTP SSE 支持重连和跨块 CRLF。
- 超大工具结果、JSON 转义膨胀和文件字节返回明确容量错误，不再让整个宿主断线。
  多主题目录以元数据与 CSS 分别传输，按当前快照摘要拒绝重载前的内容。
- 移除 `demo.*` ID 的无理由市场过滤；无搜索结果也能导出完整市场；保存市场名后点击
  发布或导出会等待保存完成，不因输入框失焦而吞掉按钮操作。
- 市场版本比较补充连字符预发布、超大数字标识符和 SemVer 字符顺序，避免遗漏作者发布的更新。
- Node 最终回归 87/87、0 跳过；命令加入 `BELFRY_REQUIRE_BROWSER_TESTS=1`，禁止浏览器缺失
  时静默跳过。曾出现一次浏览器超时，单独重跑及后续完整回归均通过；测试已补外观事件
  订阅确认和分步骤错误信息，未断言首次超时一定由该竞态造成。
- JS/TS/TSX/CSS 共 215 个文件完成结构检查：文件不超过 300 行、函数不超过 50 行、
  位置参数不超过 3、圈复杂度不超过 10、语句嵌套不超过 3。Rust 39 个文件、281 个函数
  经词法辅助检查满足文件 / 函数长度限制；分发、设置默认值和安装目标选择已拆分并自审。

## 收尾结果（2026-09-10）

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run` | 81 个测试文件、567 项通过 |
| `node --test scripts/plugin-tests/*.case.mjs` | 87 项通过、0 跳过；强制浏览器测试并指定固定上游源码 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 340 项库测试及 1 项集成测试通过；4 项原有测试标记忽略 |
| `pnpm build` | 类型检查与前端构建通过 |
| `rustfmt --edition 2024 --check src-tauri/src/plugins/mod.rs` | 通过 |
| `git diff --check` | 通过 |
| Node 内嵌清单与相对导入检查 | 75 个模块齐全，无失效导入 |
| 最新独立 macOS QA 打包 | 成功；未进行 Apple 公证 |
| 最新包 Computer Use 操作 | 工具返回 `cgWindowNotFound`，界面复核未完成 |

最终 Rust 回归曾发现 3 项测试仍使用旧的容量 / 数量阈值。测试已按当前 2,000 个文件、
50 MiB 总大小和 256 KiB 单主题标准修正，并核验不同越界原因；主题补充恰好达到上限
时可预览、超出一个字节时拒绝的断言。没有为通过测试降低校验要求。

独立应用：`src-tauri/target/debug/bundle/macos/Belfry PI Port QA.app`，标识为
`io.appmakes.belfry.pi-port-qa`。构建命令：

```sh
pnpm exec tauri build --debug --bundles app \
  --config '{"productName":"Belfry PI Port QA","identifier":"io.appmakes.belfry.pi-port-qa","bundle":{"createUpdaterArtifacts":false}}'
```

本轮由主会话实现并自审，未委派、提交或推送。Belfry 收件箱核对结果为没有待结任务。
操作入口与网站部署说明见 [制作插件与自有插件市场](./own-market-guide.md)。

## 明确的验证边界

- 自有市场可本地发布并导出完整静态网站；尚未部署到用户域名，不虚构线上地址或上传结果。
- 剪贴板按固定上游设计记录明确写入和粘贴，Belfry 还记录显式读取；不做系统剪贴板后台轮询。
  主窗口图片粘贴需最新桌面检查。
- 浏览器使用独立 Chromium 画面流；文件上传、系统剪贴板等原生边缘交互未证明与 Electron 完全等价。
- Alt+Space 已接系统全局快捷键，注册失败时保留应用内入口；跨应用唤起未实测。
- Windows 没有原生运行环境；真实模型服务未消耗用户额度。桌面控制工具的
  `cgWindowNotFound` 只记录为验证工具错误，不能据此判断应用死锁。

## 2026-09-10 GitHub 中心续接结果

已增加独立 GitHub 插件中心及客户端 `belfry` 来源，包含网站、三个真实插件、四模板、
不可变版本包、历史目录、校验和 Pages 工作流。详细结果见
[独立 GitHub 插件中心](./github-plugin-center.md)。此处之前的收尾表保留为上轮记录。

浏览器输入已修复粘贴事件被吞、macOS 全选与撤销、按键顺序；文件和文件夹上传现已接到
桌面选择器，实际 Chromium 文件内容与相对路径通过。取消保留原文件，导航、卸载或撤权
后丢弃晚到选择结果。系统选择器交互与跨系统剪贴板仍需桌面验收。

原生通知补全 PI SDK 的 `{shown, permission}` 返回结构，查询由初始 unknown 到发送
结果更新；失败返回 denied，通知标题和正文有界且不截断 Unicode。两项 Rust 单元测试通过。
`shown` 依据通知后端发送结果；未将此等同于已经实测操作系统通知横幅显示。

本轮全套：Vitest 567、Node 97（0 跳过）、Rust 库 342 + 集成 1（4 项原有忽略）通过；
随后新增的中心包原生安装测试另行通过。前端及独立 QA 构建成功。
最新 Computer Use 两次返回 `Sky Computer Use native pipe startup failed`，因此新包界面
复核仍未完成。GitHub 仓库、推送和 Pages 尚未执行，整体移植目标不因此标记全部完成。

## 2026-09-10 市场 404 与浏览器输入修复

用户确认在切换「Belfry GitHub 市场」时出现 `NETWORK: 市场请求失败：HTTP 404`。
实际请求 Belfry raw 目录返回 404，目标仓库查询仍不存在；PI GitHub 和镜像目录均返回
200。切换流程此前先保存来源再下载，导致未发布的地址也能成为当前市场。

- 改为先验证候选目录，再保存来源；失败保留原设置和来源。已验证的同源离线缓存仍可使用。
- 区分 `MARKET_NOT_FOUND` 与 `PACKAGE_NOT_FOUND`，说明目录发布条件和实际文件地址，
  错误信息不包含 URL 查询参数。HTML 仓库页面不能被当作 JSON 市场。
- 旧版本已选中失效来源时可点击「使用我的插件市场」恢复；刷新先显示当前来源的缓存，
  不再在新来源失败时残留另一个来源的卡片。自定义空地址可先填写，不提前发起请求。
- 浏览器复制 / 剪切读取 Chromium 的原生复制结果，再交给桌面文本剪贴板接口；
  保留自定义 copy 内容、iframe / shadow DOM 选区和原生撤销。粘贴会触发真实 paste 事件。
- 复制和粘贴在引擎内串行，导航、撤权、关闭或隐藏后丢弃晚到结果；拒绝超大文本，
  空选区、密码框及取消的复制不会覆盖桌面剪贴板。不读取系统剪贴板。

新增失败用例先复现，再实现修复。完整 Node 回归曾暴露测试先删除仍在运行的 Chromium
配置目录，产生 `ENOTEMPTY` 并留下测试进程；清理已改为先关闭视图、引擎和宿主，最后
删除临时目录。只停止了本任务启动的残留测试进程。

本轮最终证据：

| 检查 | 结果 |
| --- | --- |
| Vitest 全套 | 82 文件、572 项通过 |
| Node 插件全套 | 124 项通过、0 跳过；`--test-concurrency=4`，强制真实 Chromium 和固定上游源码 |
| Rust 插件回归 | `cargo test --manifest-path src-tauri/Cargo.toml plugins::`，61 项通过 |
| JS/TS/CSS 结构检查 | 225 文件，无违规 |
| 前端构建与独立 macOS QA 打包 | 成功；未做 Apple 公证 |
| 最新包桌面检查 | 按应用路径及标识调用新版 Computer Use，仍为 native pipe startup failed |

此处的剪贴板证据覆盖真实 Chromium 与桌面宿主回调边界；跨桌面应用粘贴、富文本和图片
剪贴板仍未据此视作验收通过。GitHub 创建与首次推送的确认仍待用户回答；404 反馈及来源
澄清不视为公开发布授权。

## 2026-09-10 市场页面交互回归

使用真实 `PluginPanel`、页面样式和 Node 市场模块，在独立 Chromium 和临时目录中验证。
测试仅通过 Tauri 官方 `mockIPC` 替换传输边界；不等同于 Tauri 原生窗口验收。

实际复现自定义地址输入框失焦立即保存，导致点击来源下拉框时控件被禁用、丢失焦点。
改为点击「保存并连接」或通过表单 Enter 提交；浏览器校验 URL，后端验证目录后再保存。
切换来源不再被未提交的地址拦住。沿用 PI 页面布局，窄窗口下输入框和按钮均在可见区域内。

- 新增 4 项真实页面回归：Belfry 404 保留原来源、设置和卡片；旧失效来源恢复；
  地址编辑后点击来源控件；自有市场提交、失败替换及来源缓存隔离。搜索、详情和权限说明可用。
- 最终页面与来源后端合计 12 项通过、0 跳过；插件前端 77 项回归、前端构建及
  228 文件结构检查通过。独立 macOS QA 包已重建，未做 Apple 公证。
- 浏览器截图：`/tmp/belfry-market-ui-qa/`。独立原生窗口、Windows 与 GitHub 发布仍保留原验证边界。

## 2026-09-10 浏览器键盘与 SDK 复核

本轮由主会话继续实现，上一轮市场修复属于实质进展。没有创建或推送 GitHub 仓库。

真实 Chromium 复现：Enter 不提交表单、Enter / Shift+Enter 不换行、长按标记丢失、
数字键盘 Enter 位置错误，以及 macOS Option 字符未输入。补全原生字符事件、repeat 和
location 转发，并按 macOS 键盘规则保留 Option 产生的字符。网页仍能取消按键；
Tab / Shift+Tab 切换焦点、空格操作按钮保持原生行为。

新增 `scripts/plugin-tests/browser-keyboard.case.mjs` 的 7 项交互回归全部通过。
最终 Node 插件全套为 135 项、0 跳过，包含未修改的上游 Browser、Git Lens、Log Viewer。
本轮 Vitest 为 82 文件、572 项通过；Rust 插件定向 61 项通过；229 文件结构检查与
Rust 格式检查通过。前端构建、独立 macOS QA 打包成功，未做 Apple 公证。

固定上游 SDK `packages/plugin-sdk/src/index.ts` 的 `PluginHostApi` 共 16 组、57 个方法，
已对照当前 `worker-api.mjs` 构造结果核对入口，无缺项；具体行为证据来自上述回归。
同一 SDK 的设置校验明确拒绝 `secret: true`，上游 `clipboard-history.ts` 和主进程
粘贴接线明确采用写入 / 粘贴事件，不启动系统剪贴板后台轮询。当前两项限制与上游一致。

最新包使用 Computer Use 按 `io.appmakes.belfry.pi-port-qa` 获取原生窗口，仍返回
`Sky Computer Use native pipe startup failed`，未取得新包的原生界面证据。Windows 原生
环境与跨应用交互也未验收；这些结果需要可用的对应环境。GitHub 创建与首次公开发布
仍等待此前确认，自动 goal continuation 不作为发布授权。整体目标保持未完成。
