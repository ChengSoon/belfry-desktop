---
sidebar_position: 23
title: A2A 连接
description: 本地与外部 Agent 协作、显式回报、房间和项目连接
---

# A2A 连接

:::note 新增能力
本页描述 1.0.10 起提供的外部客户端、本地 Gateway 与协作工具。正式原生、嵌入 MCP 与 HTTP 链路已接通；实际适配和验证边界见下文。
:::

A2A 让项目中的 Agent 使用同一标准协议与本地和外部 Agent 交换任务、进度与结果。首期支持 **A2A 1.0 JSON-RPC / HTTP 轮询**，认证可选匿名、静态 Bearer 或 Header API-key。

## 安装与升级

A2A 后端随 1.0.10 桌面宿主运行。已打开的 CLI 会话需重开以取得新工具；1.0.9 及更早版本不包含这些功能。

如需从源码运行，先按仓库 README 准备开发环境，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

或用 `pnpm desktop:build` 构建并启动新的原生应用。

## 本地 Agent 协作

在同一项目打开并命名 Codex PTY 或 Claude PTY 会话。CLI 读取新增 MCP 工具目录、宿主核验真实实例后，本地 Agent 自动出现在项目 A2A 链路场的左侧，外部连接位于右侧。本地连接不需填写地址／凭据，由宿主管理；未就绪和无自动适配器的会话会给出明确原因。

对当前 Agent 说：

> 把这项审查交给本项目的“审查”会话。需要补充信息时告诉我；收到对方显式完成回报后展示结果。

派活方发现 `local:` 连接后用下列同一 A2A 客户端发送、查询和续写，真正经过本机 HTTP。接收方用 `A2ALocalTasks`／`A2ALocalTask` 读取完整任务与自己的报告句柄，再用 `A2AReportTask` 显式报告 working、inputRequired、completed 或 failed。终端闲置不会完成任务。

| 本地工具 | 用途 |
| --- | --- |
| `A2ALocalAgents` | 发现其他就绪本地 Agent |
| `A2ALocalTasks` / `A2ALocalTask` | 读取本人有效任务、完整指令和当前报告句柄／代次；列表不含历史，超预算返回 `truncated`/`omitted` |
| `A2AReportTask` | 显式报告进展、需输入、完成或失败，提供文本结果／产物 |
| `A2AInbox` | 读取消息和待回复问题，支持分页；列表截断超长正文并标记 `textTruncated`，用 `messageId` 读全文 |
| `A2ARooms` / `A2ARoomContext` | 读取已加入房间、角色、简报和任务板 |
| `A2ARoomSay` | 沿用原角色规则发言、提问或回答指定问题 |
| `A2ARoomBrief` | 统筹更新目标、重点和约束；省略保持原值，空值清除 |
| `A2ARoomTask` | 规划／分派／重开／归档任务；非 add 带当前 expectedGeneration |

共有房间的分派进入原任务板，多间共同房间需明确选择。没有派活权限的成员之间发送普通任务时回退为 direct 任务，不会因为共享房间而失败；明确走房间任务板请用 `A2ARoomTask`。权限、任务代次和持久数据继续保留。回答问题不会完成任务。任务卡和对应收件消息单独显示显式协议状态、问题与文本产物预览；截断有标记，全文可读原结果或用 Agent 任务／收件箱工具读取。

本地协议句柄保存在宿主内存中，应用重启后失效；最近一次协议状态和文本产物预览会持久化到应用数据目录，重启后仍可见。业务任务、房间任务板和收件箱继续保留。接收方重新读取任务后可继续报告，发送方应回到原任务板或房间确认结果。

日常无需 Belfry 协作 Skill 或协作 CLI。内置中英 Skill 和安装按钮移除；迁移只删除已知哈希的原样副本，修改副本、符号链接与其他 Skills 保留。旧协作 CLI 仍可人工使用。

首期自动适配 MCP 注入的 Codex PTY / Claude PTY；`BELFRY_CODEX_NATIVE=1` 隔离路径和其他 CLI 暂无已验证的自动适配器。网关仅 loopback，Card/RPC 由实例凭据保护，不向其他机器开放本地会话。未提交的 direct 排队任务可撤回；已提交／状态不确定／执行中可明确返回不可取消，房间任务首期协议取消不支持。

## 配置外部连接

1. 打开目标项目，点击项目顶部的 **A2A**，再点击「新增连接」。
2. 输入连接名称与 Agent Card 的完整 URL，例如 `https://agent.example.com/.well-known/agent-card.json`。
3. 按服务要求选择认证并输入凭据。Header API-key 还需要 Header 名。
4. 点击检测，查看名称、版本、能力和兼容接口。默认使用 Card 中第一个 JSONRPC / 1.0 接口；点选不同 origin 或不同 tenant 的接口会自动重新检测，手工填写接口 URL 后点击检测。
5. 保存后，在当前 Agent 中要求发现 A2A 连接并发送指定任务文本。

连接按当前项目保存。凭据由宿主保护存储，编辑时只能保留、替换或清除，原值不会返回。改变认证类型、Header 或目标 origin 后需要重新输入。删除或修改连接会使本地任务句柄失效；远端已接受的任务需另外请求取消。

HTTPS URL 不允许内嵌用户名 / 密码或 fragment。本机 loopback 服务可使用 HTTP。首期不支持需要不同 Card / RPC 凭据的跨 origin 组合。

## Agent 工具

兼容 CLI 通过 Belfry MCP 桥接看到五个通用客户端工具，本地与外部连接共用，无需安装 A2A 插件：

| 工具 | 用途 |
| --- | --- |
| `A2AConnections` | 发现当前项目连接 ID 和公开认证状态 |
| `A2AAgentCard` | 读取已配置 Agent 的 Card 与能力 |
| `A2ASendMessage` | 发送文本；使用原 taskHandle 可补充输入 |
| `A2AGetTask` | 用宿主句柄单次读取状态、历史和产物 |
| `A2ACancelTask` | 请求远端取消，保留不可取消等明确错误 |

可以对 Agent 说：

> 发现当前项目的 A2A 连接，读取“外部审查”的 Agent Card，发送下面的任务文本。任务仍在工作时，间隔查询进度；完成后展示文本产物，需要输入时先告诉我。

即时 Message 不会被伪装成 Task。只有 `terminal=true` 才表示 Task 进入完成、失败、取消或拒绝终态。句柄保存在宿主内存中，默认保留 24 小时；终态后仍可查询，但不能再用原句柄续写，需要追问时新发消息。超时或断线后不要自动重发初始消息，远端可能已经接受。停止本地请求与远端 CancelTask 是不同操作。

## 本地试用

在源码仓库根目录启动不使用模型的示例服务：

```sh
node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777
```

Card URL 填 `http://127.0.0.1:17777/.well-known/agent-card.json`，选择匿名并检测保存。发送 `instant: hello` 得到即时消息；发送普通任务后查询两次，得到文本产物。发送 `needs-input: 测试` 可验证补充输入，`uncancelable: 测试` 可验证不可取消。

fixture 只监听本机，不读取项目或调用外部服务。静态认证演示可加 `--auth bearer` 或 `--auth apiKey`，测试凭据为 `fixture-key`，API-key Header 为 `X-API-Key`。

## 兼容范围

外部服务必须使用兼容 A2A 1.0 的 Agent Card 和请求结构；旧 0.3 示例不保证兼容。wire header 使用 `A2A-Version: 1.0`；软件 release v1.0.1 是补丁，不能放入 wire 版本。首期没有 SSE、push、OAuth 或 Card 签名验证。

CLI 必须实际发现上述工具。Node、原生 HTTP 和浏览器夹具分别验证参数、生命周期与界面；真实 CLI 模型自主调用和任意远端服务不能由模拟验收推断。

官方规范：[A2A v1.0.1 Proto](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto) · [JSON-RPC 规范](https://a2a-protocol.org/latest/specification/)。
