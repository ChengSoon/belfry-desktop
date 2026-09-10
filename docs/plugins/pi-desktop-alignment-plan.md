# PI-Desktop 式扩展插件对齐计划

> 当前用户要求整体移植功能与页面，执行入口为 [完整移植计划](./pi-desktop-port.md)。
> 本文 P0/P1 分期是历史记录，不再限制最新验收范围。

日期：2026-09-08；更新：2026-09-09。参考项目：`vastsa/PI-Desktop`。

最新源码核对：[PI-Desktop 插件源码核对](./pi-desktop-source-review.md)，固定提交 `4fb58d3`。
上游已有模板自动生成、CLI/Agent 校验打包工具和动态插件进程；当前 Belfry 的静态包导入
仅覆盖其中一部分。后续能力对齐同时参考源码记录，避免将作者工具延后到市场阶段。

## 1. 结论与方向

最初 Belfry 的 `src/plugins` 是声明式 Prompt/Recipe 原型；截至 2026-09-09，
目录插件 P0 已完成 Harness 退出、兼容处理及桌面验收。最新执行入口为
[PI 插件单一方向：P0 收尾任务](./pi-only-p0-delivery.md)。

本轮目标改为：让 Belfry 成为插件宿主，插件是可安装、可启停、可卸载、可贡献功能且受宿主
权限控制的 capability pack。用户于 2026-09-09 取消 Harness 功能，后续仅交付 PI 插件系统。

## 2. 对齐能力

PI-Desktop 的关键能力按以下层次对齐：

1. 插件中心：已安装/市场双视图、搜索、状态、更新提示、错误诊断。
2. 包与生命周期：目录或包安装、开发目录加载、校验、启用、禁用、重载、卸载、故障隔离。
3. 贡献点：commands、views/panels、agentTools、skills、settings、themes、MCP、services。
4. 安全模型：manifest 显式权限、文件范围、网络域名、安装预览、运行时 broker、审计。
5. 开发体验：模板脚手架、检查、打包、热重载；随后再接市场发布和签名更新。

## 3. 分期

### P0：插件管理与静态贡献闭环

- 目录插件，根目录必须含 `manifest.json`；开发加载引用原目录，普通安装复制到受管目录。
- manifest v1 首批字段：身份、版本、兼容范围、图标、permissions、activationEvents、
  `contributes.commands`、`contributes.skills`、`contributes.settings`。
- 安装前预览权限、贡献点、兼容性和来源；无确认不落盘。
- 完成 list/inspect/install/enable/disable/reload/uninstall，加载失败自动回到 disabled。
- 注册与撤销贡献点必须事务化；单插件失败不影响 Shell、普通 Agent 与其他插件。
- 插件中心提供完整目录插件管理；Harness 的产品入口、运行时接线和贡献已列入退出任务。
- P0 不执行第三方 JS，不加载第三方 HTML，不联网市场，不宣称已有沙箱。

### P1：隔离运行时与 UI

- 每插件独立子进程，使用有界 JSON-RPC 与宿主 broker；插件不能直接获得 Tauri/AppHandle。
- 增加 commands handler、agentTools、panel/view、生命周期 onLoad/onUnload。
- panel 使用隔离 WebView、固定 CSP、独立存储分区和窄 preload API。
- 文件、网络、通知、剪贴板等能力统一经过权限网关并写审计。

### P2：高级扩展

- MCP server、常驻 service、theme、插件间消息总线。
- 服务监督、超时、崩溃退避、资源上限、应用退出清理。

### P3：生态

- 市场源、包摘要、签名、权限扩张阻止静默更新、回退、开发脚手架与打包工具。

## 4. P0 技术边界

- 新实现集中在 `src/plugins/**` 与 `src-tauri/src/plugins/**`。
- 必要接线可修改插件入口、设置/工作台、新建会话和 Tauri command 注册；不顺手重构。
- 不修改 Provider、协作协议、终端 PTY、Recipe 持久化、根依赖和构建配置。
- 当前工作区已有大量未提交改动，先核对归属；不得覆盖或回滚其他工作。
- 如需变更 shared contract/schema/shared types、依赖、根配置或数据库，停止并通过 Belfry 回报。

建议目录：

```text
<app-data>/plugins/
  installed/<plugin-id>/
  cache/
  registry-v1.json
```

P0 后端是 manifest、文件边界和持久化的权威；前端类型不能成为唯一校验。
路径必须规范化并限制在插件根目录内，拒绝绝对路径、`..`、符号链接逃逸和超额文件。

## 5. P0 实现顺序

1. 盘点并保留已有插件/Harness 改动，建立现状测试基线。
2. 冻结私有 manifest/registry/IPC 契约和固定样例，先写校验与路径安全测试。
3. 实现 inspect/install 与原子 registry；安装默认 disabled。
4. 实现 enable/disable/reload/uninstall 和事务化静态贡献目录。
5. 完成插件中心 UI、安装预览、错误/空态/忙态、键盘与小窗口适配。
6. 按 2026-09-09 新决定撤下 Harness，并验证旧插件数据兼容与普通 Agent 会话。
7. 定向测试、全量 test/build/cargo test、结构化自审和真实桌面冒烟。

## 6. P0 验收

- 有效目录可以预览、安装、启用、重载、禁用和卸载，重启后状态一致。
- manifest 错误、版本不兼容、未知权限、路径逃逸、超额文件均明确拒绝且无部分安装。
- 启用失败自动禁用；撤销后命令、Skill、设置贡献全部消失。
- 开发目录重载失败时保留可诊断状态，不拖垮其他插件与主应用。
- 插件中心能显示来源、版本、贡献、权限、状态和错误；操作防重复提交。
- 原有 Shell、Agent、协作和终端功能无新增回归。
- 完成前至少运行相关定向测试、`pnpm test`、`pnpm build`、`cargo test`；不能运行的项目明确说明。

## 7. 暂不承诺

P0 不声称与 PI-Desktop 插件 API 二进制或源码兼容；目标是产品能力与宿主架构对齐。
第三方代码执行、HTML panel、市场与自动更新只有在 P1/P3 安全边界完成后开放。

2026-09-09 核实：PI-Desktop 的目录和 `.piplug` 分发包都包含 `manifest.json`。
普通用户选择插件包即可，清单位于包内。Belfry 已在目录 P0 后补充 ZIP32 Store 的包安装，
见 [插件包导入验收](./package-import-delivery.md)。包支持与现有 PI 插件 API/运行时兼容分别验收，
不能以解包成功代替运行兼容。
核对来源：上游提交 `c5efbe65be9c3553ad817ec55754c933891b0c4d` 的
`docs/spec/07-plugins/06-plugin-packaging.md` 和 `02-plugin-manifest-schema.md`。

## 8. 历史接续授权与执行状态

以下是取消 Harness 之前的历史记录；当前范围、兼容要求和验收以
[PI 插件单一方向：P0 收尾任务](./pi-only-p0-delivery.md) 为准。

2026-09-08：用户在明确列出新 manifest/registry、目录安装持久化、Harness 私有适配
及由「开发」接管插件目录半成品的确认问题后回复「继续」，批准
`src/plugins/P0-4wej4rg0-evidence.md` 的具体提案。上述范围不再重复申请批准。
旧 registry 可明确拒绝并保留原文件，不自动覆盖；不扩展到根依赖、CI 或其他共享协议。

- 进行中：开发实现新目录插件 P0 与必要接线；项目经理核查验收、整合验证。
- 待执行：新生命周期与安全边界测试、全量测试/构建、UI 冒烟及最终证据核查。
- 接续基线：前端 542 项测试通过；Rust 因缺失 `plugins::manifest` 编译失败（退出 101）。
  基线通过不代表新 P0 已完成。

### 收尾重点核查

- 安装：预览后源内容变化必须拒绝；复制中断和 registry 提交失败不产生有效半安装。
- 数据：旧格式与损坏 registry 明确报错并保留；revision 冲突不会覆盖其他实例提交。
- 路径：绝对路径、跨平台路径前缀、父目录跳转、符号链接、非普通文件与配额均在后端检查。
- 生命周期：开发目录缺失或重载失败自动禁用并保留诊断；重启恢复不能盲信旧贡献快照。
- 撤销：插件禁用/卸载后贡献目录与可见入口同步撤销；Harness 原有信任审批不可绕过。
- 界面：设置入口可达，预览取消不落盘，提交时防重复，失败后可恢复操作。
- 验证限制：当前浏览器运行时返回无可用浏览器，真实界面冒烟尚未执行。

中途审查待复核（实现仍在变化，未作为最终缺陷结论）：受管目录已删除时卸载是否
被 `managed_path` 的元数据读取阻止；目录遍历是否同时限制空目录等总条目数量。
追加 Belfry 指令因开发会话暂不可接收而失败，需在交差后统一处理，不假定已经送达。
Computer Use 已确认本机可运行桌面检查，但当前 Belfry 是旧模板插件版本，不能代表新代码。

2026-09-09 接续：用户要求唤回「开发」继续。`peers` 确认其 idle，恢复任务
`ynj4gbe1` 已送达，包含上述两个审查项和 Harness 别名点击前重新校验。
项目经理独立基线：`pnpm test` 548 项通过；`cargo test plugins::` 13 项通过，
退出码均为 0。这些结果覆盖当前中断点，后续修复仍需重新验证。
