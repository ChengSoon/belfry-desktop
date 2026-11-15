# A2A 工具目录与旧 Skill 引导核查

日期：2026-11-15。T17 后续核查完成。区分提供给模型的工具元数据、正式 MCP 目录以及实际执行记录；没有读取截图房间的其他会话内容或向它发送消息。

## 三种入口的区别

| 入口 | 含义 |
| --- | --- |
| 原 `belfry` Skill | Markdown 操作说明；模型读取后执行 `belfry room` 等 CLI 命令，由旧宿主协作接口管理任务 |
| A2A 客户端 / Gateway | 标准 HTTP / JSON-RPC 协议，实现 Agent Card、SendMessage、GetTask、CancelTask，适用于本地与外部 Agent |
| A2A 本地 MCP 工具 | 接收方回报、房间上下文与任务板操作的受控薄入口；继续由 Belfry 维护业务权限和状态 |

因此 `[belfry inbox]` 产品消息名称会保留；不能仅根据这个名称判断新旧执行方式。判断标准是实际工具调用与 HTTP / 任务状态证据。

## 本次实际观察

当前已经运行的统筹会话提供给模型的工具列表里没有 A2A 名称，Skill 目录却仍包含 `.codex` 和 `.mirasim` 两个 `belfry` 条目；`BELFRY_CODEX_NATIVE=0`。这证明这条会话尚不能直接调用相应工具，不等于截图里另一条会话的原始 MCP 目录也相同，也没有锁定具体客户端 / MCP 绑定原因。

对[生产目录函数](../../src-tauri/src/plugins/node/mcp-dispatch.mjs)进行了只读元数据检查，插件目录使用合成空值：

| 就绪状态 | 生产函数返回的 A2A 名称 |
| --- | --- |
| 本地尚未就绪 | 五个客户端工具：Connections、AgentCard、SendMessage、GetTask、CancelTask |
| 本地就绪 | 上述五个加十个本地工具，含 RoomContext、RoomTask、ReportTask |

完整名称和检查范围在 `/tmp/belfry-a2a-skill-residual/source-tool-directory.json`。这项检查没有调用真实 MCP transport 或模型；新源码的实际 transport / HTTP 往返由本轮原生双 embedded MCP 用例验证，见 [原生核查](a2a-skill-residual-native.md)。只有本地就绪延迟不能解释生产目录中的五个客户端名称也缺失，但当前模型暴露列表不能代替真实 MCP `tools/list` 响应。

截图显示“读取 SKILL.md”，没有后续工具记录。因此只能确认旧说明仍被选中，不能宣称任务已经走 A2A，也不能据此断言 A2A 源码没有实现。

## Skill 发现与切换

已访问 [OpenAI 官方 Skill 说明](https://learn.chatgpt.com/docs/build-skills)，HTTP 200；旧 Codex guide 地址通过官方 308 跳转到该页面。说明确认：名称和描述参与隐式匹配，选中后读取完整 `SKILL.md`；仓库、用户、管理和系统来源均可参与发现；同名项可能分别出现。技能变更可自动检测，未生效时可重启；配置变更后需要重启。不能将所有残留都归因于启动缓存。

新房间提示已明确直接使用 A2A 工具，缺失时说明当前工具不可用。用户应先启动包含新源码的宿主，再让 MCP 注入的 Codex PTY / Claude PTY 实际获得工具目录。更新后若依旧只读 Skill，先检查多个来源是否还有副本，再检查该会话的 MCP `tools/list`，最后检查 Send / Get / Report 的真实记录。

这次没有手工删除 Skill、修改 Codex 配置、重启用户会话或运行真实模型。当前文件状态和已运行会话保持不变。指南与首期验收均补充这一范围，不把源码删除或合成目录检查表述为已完成真实客户端切换。
