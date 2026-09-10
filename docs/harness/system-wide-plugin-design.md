# 系统级 Harness 插件可用性设计

日期：2026-09-07。状态：执行基线。

## 产品要求

插件不是某一个 Agent 的私有扩展。安装一次后，系统内所有支持 Harness 协议的 Agent 会话都能发现、选择和请求使用它。
插件定义、版本、信任状态和能力声明由宿主级 Registry 管理；运行时授权、项目根、Worker、审批、取消、预算和审计仍按会话隔离。

## 生命周期与边界

- Registry 属于宿主应用，不属于单个 Worker 或 Agent tab；WebView reload 不丢失已安装定义。
- 新会话创建时读取 Registry 快照，固定 `pluginId + version + manifestDigest`；更新不改变已有会话。
- 任意 Agent 只能发现 `trusted + compatible + enabled` 插件；未声明 Harness API/宿主版本不展示为可运行。
- 每个会话必须重新声明目标插件允许的工具和能力，并由用户/宿主授予本会话授权；系统级安装不等于全局授权。
- 不同 Agent 可并发使用同一插件定义，但不能共享 Worker、会话上下文、项目根、凭证、approval token 或运行队列。
- 插件更新、禁用、卸载影响新会话；已有会话进入版本固定的受控状态：可完成/取消，但不能偷偷切换版本。
- 卸载不得破坏已保存历史；缺失版本的历史只读，不能恢复执行。
- Registry 读写必须是宿主单 owner、原子提交、有 revision/冲突检测；所有 Agent 读到同一事实。

## 需要的宿主能力

新增系统级接口（命名可按仓库惯例调整）：

- `harness_registry_list`：列出可用插件摘要和版本/兼容/能力请求
- `harness_registry_install` / `update` / `disable` / `uninstall`：管理 Registry，不启动 Worker
- `harness_session_snapshot`：为新会话返回不可变插件版本快照
- `harness_session_authorize`：创建会话级授权，不能写回全局权限

Registry 存储至少包含 `pluginId`、当前版本、manifest digest、信任/启用状态、来源、安装/更新时间和历史版本引用。
敏感凭证只存引用 ID，不存明文。所有管理操作产生脱敏审计事件。

## UI 预期

插件设置页面是系统级入口，不放在某个 Agent 面板内。新建会话的 Harness 选择器从同一 Registry 读取；Agent tab 只显示当前会话快照和授权状态。
多个 Agent 同时打开时，安装/更新结果通过 Registry generation 通知重新读取；不自动重启运行中的 Worker。

## 验收

1. 安装一次后，两个不同 Agent 会话都能发现并启动同一插件版本。
2. 两个会话的项目根、上下文、Worker、approval token、取消和审计互不串线。
3. 一个会话撤销权限不会影响另一个会话；全局禁用阻止新会话但不篡改旧会话快照。
4. 更新后新会话使用新版本，旧会话继续固定旧版本；卸载后旧历史可读但不可恢复执行。
5. 双窗口/多 Agent 并发读取 Registry 得到同一 revision；陈旧更新返回冲突，不丢更新。
6. 未信任、不兼容、禁用插件对所有 Agent 一致不可运行。
7. Worker 崩溃或退出只影响所属会话，其他 Agent 和普通终端继续工作。
8. 管理 UI 与会话选择器显示同一 Registry 事实；不复制一份 per-Agent 插件目录。
9. 文件/函数门禁、定向测试、全量测试、构建和 Rust 测试全部通过。

## 实施范围

允许新增 `src-tauri/src/harness/registry/**`、`src/harness/registry/**`、会话快照/授权模块、测试、假插件和实施文档，
以及最小 `src-tauri/src/lib.rs` 命令注册。可复用 H0.5 Worker 与 H1 Capability Broker，但不能把其 session registry 当作系统 Registry。
不接模型、命令执行、市场签名或跨设备同步；不扩展 legacy plugins，不改 Provider/AgentKind/Prompt/Recipe、根依赖、CI 或数据库。
