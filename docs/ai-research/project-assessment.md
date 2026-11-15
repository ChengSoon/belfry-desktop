# Belfry 架构与 AI 功能接入评估

本地核查日期：2026-11-15。任务：AI技术讨论 / T1。核查基线：`f9d9d92`，应用版本 `1.0.8`。

**本轮确定接入：统一 A2A 1.0 协作层，完整替代并删除 Belfry 协作 Skill。** 客户端项目连接 / Agent Card / 静态认证由 Rust 宿主管理，现有 MCP Agent 工具负责发送消息、查询进度与结果、补充输入和取消；本地 Gateway 与执行适配将本地 CLI 接入同一协议。T8 / T9 先实现客户端后端与前端 / Node，T11 / T12 实施 Gateway、本地显式报告与 Skill 迁移，T13 验收全部最终代码；原 T10 已归档。当前方案和契约见 [新协议接入方案](new-feature-plan.md) 和 [A2A 接口契约](a2a-contract.md)。无需再次确认技术方向。

当前房间 / 任务板 / 收件箱已提供本地多 Agent 协作，但未提供公开 A2A 1.0 客户端或 Gateway。迁移保留业务数据与角色权限，引入标准协议任务映射和可信工具完成报告，删除依赖协作 Skill 的入口。标准 A2A Agent 可按 Card 接入，普通 CLI 需要适配。MCP `2026-07-28` 出站兼容和 MCP Apps / WebMCP 保留为已核实备选；官方版本、发布和兼容事实见 [T7 技术核查](technology-scan.md)。

以下保留 T1 的架构评估与历史候选。原 MCP 工具元数据方案对应的 T4/T5 已归档；T1 的只读探针和缺口仍是有效代码事实，当前接入决策以新协议接入方案和 T7 官方核查为准。

## 核查范围与仓库约定

- 任务开始时 `git status --short` 输出为空；本任务只新增本报告，不改生产代码、配置、依赖或锁文件。
- 已检查仓库及祖先目录的 `AGENTS.md`，未发现适用文件。开发、验证和平台边界以 [README](../../README.md) 和 [.github/workflows/checks.yml](../../.github/workflows/checks.yml) 为准。
- 技术栈为 React 19 / TypeScript / Vite、Tauri 2 / Rust 2024、xterm.js / PTY，以及可执行插件使用的 Node.js 宿主。包管理器固定为 `pnpm@10.34.4`，可执行插件要求 Node.js 20 或更新版本。
- 以 [src/App.tsx](../../src/App.tsx) 和 [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) 的生产接线核实功能；历史源码、历史测试数量和旧实施记录不能单独证明当前功能可用。
- 外部技术版本与官方页面的联网核查由 T2 的 `technology-scan.md` 补充。本报告的核查日期指本地代码检查，不声称某项功能是截至该日的“最新版本”。

## 已有能力与实际接入路径

| 层 / 能力 | 当前已有行为 | 主要代码与验证入口 |
| --- | --- | --- |
| 桌面与终端 | 本地项目、多会话、Shell / SSH、跨平台 PTY、后台 daemon、状态与历史展示 | `src/App.tsx`、`src/workspace/`、`src/terminal/`、`src-tauri/src/terminal/`；前端 Vitest、终端 Rust 测试及 `scripts/test-terminal-daemon.py` |
| CLI Agent 适配 | Codex、Claude Code、Pi、Antigravity、OpenCode、Kimi 六种 Agent 的检测、启动、恢复与历史适配 | `src-tauri/src/agent/contracts.rs`、`adapter.rs`、`history_adapter.rs`、`src/agent/contracts.ts`；`adapter_tests.rs`、`src/agent/*.test.ts` |
| Provider | 全局 / 项目 Provider，按原生配置字段切换，保留其他配置；本地凭据保护、模型目录与思考等级 | `src-tauri/src/provider/`、`src/provider/`；Provider Rust / Vitest 测试、`scripts/test-project-provider.py` |
| 可执行插件 | 安装目录 / `.piplug`、市场与生命周期管理；命令、Skill、主题、视图、设置与 Agent 工具；按权限及项目作用域执行 | `src-tauri/src/plugins/`、`src-tauri/src/plugins/node/worker-api.mjs`、`broker.mjs`、`manager.mjs`、`src/plugins/`；`scripts/plugin-tests/` |
| 插件模型调用 | `models.list()`、`agent.complete()`、工具调用期间的会话上下文；Responses、Chat Completions、Anthropic、Gemini 四种路由；思考等级、超时、取消、频率与响应大小限制 | `src-tauri/src/provider/plugin_gateway.rs`、`node/models.mjs`、`node/model-http.mjs`；`scripts/plugin-tests/models.case.mjs`、`node/model-http.test.mjs` |
| MCP 服务聚合 | 已配置插件的本地 stdio / HTTP MCP 服务、工具目录与执行、Prompt、资源、资源模板、分页、目录变化通知、撤销和取消 | `node/mcp-peer.mjs`、`mcp-http.mjs`、`mcp-contributions.mjs`、`mcp-resources.mjs`；`scripts/plugin-tests/mcp*.case.mjs` |
| Agent 中的动态发现 | `PluginTools` 查询当前项目的实时工具及输入 schema；`PluginCall` 按插件和工具名调用；Skill 可通过工具、Prompt、资源读取 | `node/mcp-agent-tools.mjs`、`mcp-dispatch.mjs`；`mcp-live-tools.case.mjs`、`mcp-discovery-events.case.mjs` |
| MCP 结果 | 已保留文本、图片、音频、资源与资源链接；允许对象型 `structuredContent`，保留 `isError`，对资源 URI 加插件命名空间 | `node/mcp-validation.mjs`、`mcp-results.mjs`、`mcp-contributions.mjs`；MCP / 内容相关插件用例 |
| 会话协作 | 同项目派活、收件箱、房间角色、共享任务板、依赖与回复；CLI / Rust / 前端共用协议 | `src/rooms/`、`src/inbox/`、`src/collab/`、`src-tauri/src/rooms/`、`src-tauri/crates/belfry-protocol/`；房间与收件箱测试 |

### 需要保留的能力边界

1. **六种 Agent 的托管支持不等于六种完全相同的 MCP 接入方式。** Codex / Claude 使用 `plugins/agent_connection.rs` 注入启动参数；Antigravity / OpenCode / Kimi 经 `agent/integration.rs` 使用各自配置面；Pi 在 `agent_connection::arguments()` 中仍明确返回空参数，自动 MCP 桥接依赖其扩展机制，不能据此宣称已完成 Pi 的端到端插件工具接入。Codex 的显式原生诊断启动模式也会跳过插件连接。
2. **MCP 协议握手与完整规格覆盖需要分别核查。** 入站 `initialize` 已接受 `2024-11-05`、`2025-03-26`、`2025-06-18`；出站 `McpPeer.start()` 当前请求 `2024-11-05`，HTTP 后续使用服务协商返回的版本。握手版本存在不能证明相应规格的所有可选能力已实现。
3. **模型网关沿用用户已经配置的服务。** 模型列表不会向插件返回 API Key；内部 `models.resolve` 才取出请求所需凭据。已知模型思考等级使用明确列表，不能按模型名称猜测未经核实的新能力。
4. **Harness 已退出生产。** `src/harness/`、`src-tauri/src/harness/` 仍保留源码，但 `src-tauri/src/lib.rs` 不声明或注册其运行时，`src/App.tsx` 无其入口。[旧插件实施记录](../../src/plugins/IMPLEMENTATION.md) 也明确说明退出生产。它不适合作为本轮接入基础。
5. **部分深入指南缺失。** `website/docs/plugins.md` 和旧实施记录引用的 `docs/plugins/pi-runtime-guide.md`、`pi-runtime-implementation.md`、`own-market-guide.md` 在本基线不存在。新增能力应提供仓库中真实存在的使用说明及可复现示例。

## 已确认的真实缺口

### 1. MCP 工具目录丢失输出 schema 和行为提示

`McpPeer.refreshCatalog()` 收到的工具目录可包含完整描述符，但 `McpContributions.registerTools()` 只抽取名称、描述和 `inputSchema`。之后 `mcp-dispatch::toolList()` 与 `mcp-agent-tools::discover()` 又各自只构造名称、描述、输入 schema，导致可选元数据无法到达 Agent。

只读探针使用项目实际导出的 `McpContributions.registerTools`、`toolList` 和 `agentTool(PluginTools)`，把一个含以下字段的内存工具描述符送过该链路，不启动服务或写入文件：

```json
{
  "name": "lookup",
  "title": "Local lookup",
  "description": "Read a local record",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object", "properties": { "ok": { "type": "boolean" } } },
  "annotations": { "readOnlyHint": true, "openWorldHint": false }
}
```

实际输出字段：

| 链路位置 | 输出字段 |
| --- | --- |
| 上游工具 | `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations` |
| `tools/list` | `name`, `description`, `inputSchema` |
| `PluginTools` 返回的工具 | `pluginId`, `pluginName`, `name`, `mcpName`, `description`, `inputSchema` |

`title`、`outputSchema`、`annotations` 均丢失。与此同时，`mcpToolResult()` 已验证并保留对象型 `structuredContent`，因此应把增量描述为**输出约定和行为提示的目录保真**，而不是新建结构化结果功能。

### 2. 插件模型调用只提供非流式文本完成

`models.mjs` 只接受 `user` / `assistant` 的字符串消息；`model-http.mjs` 请求显式使用 `stream: false`，没有结构化输出参数、函数工具定义或工具执行循环；完成结果只抽取 `text` 和归一用量。插件可以获得文本完成，但无法通过宿主 API 显式要求服务按 JSON Schema 返回对象。

### 3. MCP 资源目录变化不等于内容订阅

`mcp-dispatch.mjs` 没有 `resources/subscribe` / `resources/unsubscribe`，入站资源能力只声明 `listChanged`；`McpPeer.notice()` 只处理工具、Prompt、资源的 `list_changed`，忽略 `notifications/resources/updated`。当前能重新读取资源，但没有按资源 URI 订阅内容变化的链路。现有 HTTP / stdio 的目录事件订阅不能当成这一能力。

## T1 阶段的三个历史增量候选

| 候选 | 用户价值与最小实现 | 对应文件 | 验收方法 / 成本 |
| --- | --- | --- | --- |
| **A：MCP 工具元数据保真（推荐）** | 让 Agent 同时发现工具输入、输出约定与行为提示。保留合法的可选 `title` / `outputSchema` / `annotations`，贯通上游注册、直接工具目录与 `PluginTools`；动态插件注册走相同的公开目录规则 | `src-tauri/src/plugins/node/mcp-contributions.mjs`、`mcp-dispatch.mjs`、`mcp-agent-tools.mjs`、`mcp-validation.mjs`；按动态注册校验需要检查 `broker.mjs`；`scripts/plugin-tests/mcp-tool-metadata.case.mjs`（拟新增）、现有 MCP 用例；新增真实开发说明 | 本地 stdio / HTTP fixture 提供含元数据的工具；两种发现路径字段一致，调用结果保持 `structuredContent`；刷新、卸载、作用域变化、旧工具及畸形元数据均有断言。无需新账户、外部服务或付费调用；不新增依赖即可完成描述符形状校验 |
| **B：插件模型 JSON Schema 输出** | 对兼容服务增加显式结构化输出选项，让本地插件更可靠地获得可用对象。最小范围可先支持 Responses / Chat Completions，其他协议明确返回不支持；不要把“提示模型返回 JSON”当成服务端 schema 约束 | `src-tauri/src/plugins/node/models.mjs`、`model-http.mjs`、`worker-api.mjs`；如需能力发现则涉及 `src-tauri/src/provider/plugin_gateway.rs`；`scripts/plugin-tests/models.case.mjs`、`node/model-http.test.mjs` 与 API 使用说明 | 本地模拟服务断言每种支持协议的真实请求字段、合法对象结果、拒绝 / 未完成 / 非 JSON 的行为、大小限制与旧文本调用兼容。自动化验证不付费；真实服务验收需要已有兼容 Provider，模型与中转支持情况须由官方资料及实际配置确认 |
| **C：MCP 资源内容订阅** | Agent 订阅已接入的项目资源，在内容变化后收到带命名空间 URI 的通知并按需重读。只对声明订阅能力的上游开放，管理每个会话的 subscribe / unsubscribe 与撤销 | `src-tauri/src/plugins/node/mcp-resources.mjs`、`mcp-peer.mjs`、`mcp-http.mjs`、`mcp-dispatch.mjs`、`mcp-server.mjs`、`mcp-stdio-events.mjs`；`scripts/plugin-tests/mcp-resources.case.mjs`、拟新增订阅用例与使用说明 | 本地服务模拟两个会话和两个资源：只有订阅者收到对应 `resources/updated`；取消、过期、插件卸载、作用域变化及重连清理正确；能力未声明时不承诺可订阅。无需新付费凭据；涉及更多事件生命周期，工作量高于 A |

规范对照目标为 MCP [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)，模型候选对照 OpenAI [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。这些链接用于明确拟实现的协议含义；访问结果、官方版本与模型兼容性以 T2 的联网核查记录为准。

## T1 方案 A（已归档）的实施与验收约定

1. **字段贯通：** MCP 上游目录、动态插件工具描述符、宿主目录、`tools/list`、`PluginTools` 都保留已有的合法可选元数据；没有元数据的旧插件仍输出原有字段，不添加猜测的默认行为提示。
2. **校验范围：** `outputSchema` 为 MCP 要求的对象型 schema 描述符；`annotations` 的已知布尔提示与可选标题校验类型。形状和配额校验沿用现有边界。完整 JSON Schema 结果校验是另一项实现，不应在仅做透传时声称已完成。
3. **行为提示的含义：** `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 是工具提供方的提示，不是可信的权限授予。工具调用继续走现有权限、项目作用域和会话撤销逻辑。
4. **结果兼容：** 已支持的 `content`、`structuredContent`、`isError` 和资源 URI 命名空间保持正确；不要把返回对象转换成不同的数据结构来补元数据。
5. **动态更新：** 上游更新元数据后，两种发现入口得到新值；撤销或项目作用域变更后目录不再返回工具、旧调用失败。描述符验证失败不能污染其他插件贡献。
6. **验收产物：** 提供可运行的本地模拟服务 / 插件用例，以及给开发者看的注册与发现示例。注明元数据消费取决于 Agent 客户端；`PluginCall` 是泛用路由工具，具体输出约定由 `PluginTools` 的每个工具条目描述。

建议开发任务按文件划分：一人负责 Node 宿主与发现链路实现，另一人负责独立本地 fixture、回归和使用说明；通过任务板确认文件范围后再实施。

## 测试入口与本次验证状态

以下是仓库实际存在的验证入口，并非本任务已经执行的测试结果。

| 验证范围 | 命令与前提 |
| --- | --- |
| A 的新增行为和 MCP 回归 | 开发完成后运行 `node --test --test-concurrency=1 scripts/plugin-tests/mcp-tool-metadata.case.mjs scripts/plugin-tests/mcp.case.mjs scripts/plugin-tests/mcp-live-tools.case.mjs scripts/plugin-tests/mcp-updates.case.mjs scripts/plugin-tests/mcp-resources.case.mjs scripts/plugin-tests/mcp-discovery-events.case.mjs scripts/plugin-tests/mcp-lifecycle.case.mjs`；首个文件为拟新增产物 |
| 模型网关 | `pnpm exec vitest run src-tauri/src/plugins/node/model-http.test.mjs`，另运行 `node --test scripts/plugin-tests/models.case.mjs`；前者使用 Vitest，后者使用 Node test runner，现有用例使用本地模拟 HTTP 服务，无真实付费调用 |
| 前端类型与生产构建 | `pnpm build`；包含 TypeScript 构建与 Vite 生产打包 |
| 前端回归 | `pnpm test`；Vitest，变更涉及前端时按目录先定向运行 |
| Rust / sidecar | `node scripts/bundle-cli.mjs` 后执行 `cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked`；准备真实本机 sidecar，保留锁文件约束 |
| 插件 / 浏览器全量 | 先 `pnpm build`，再 `node .github/workflows/verify-plugins.mjs`；要求本机 Chrome / Chromium / Edge。4 项原版 PI 互操作另需 `BELFRY_PI_SOURCE` 和 README 指定的固定上游 fixture，不能把未提供条件的用例算作通过 |
| 文档与补丁 | `git diff --check`，检查新增报告的链接与内容；未跟踪的新文件需单独检查内容，普通 `git diff` 不会包含它 |

本任务实际完成了源码与生产接线检查、Git 基线核对，以及一项只读内存探针（退出 0，确认三项元数据丢失）。未执行完整前端、Rust、浏览器或真实 CLI / 模型服务验收；这是架构评估报告，不能作为接入完成或测试全过的证明。
