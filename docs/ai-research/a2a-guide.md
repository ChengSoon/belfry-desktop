# A2A 连接与 Agent 工具使用说明

日期：2026-11-15。本文覆盖源码中的 A2A 外部客户端、本地网关、显式回报与协作 Skill 迁移。正式原生接口和嵌入 MCP 链路已接通；完整检查、证据与实际适配边界见 [验收记录](a2a-validation.md)。这些改动随 1.0.10 发布。

客户端使用 **A2A 1.0 JSON-RPC / HTTP**，按项目保存外部 Agent 连接，支持匿名、静态 Bearer 和 Header API-key。外部服务需提供兼容 Agent Card 与接口；旧 `0.3` 的 Card、枚举和方法结构不保证兼容。官方软件补丁 `v1.0.1` 与 wire `1.0` 的区别和可访问来源见 [技术核查](technology-scan.md)。

## 运行包含新功能的桌面宿主

按仓库 README 准备 Rust、Node.js、固定版本 pnpm 与 Tauri 平台环境，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

也可用 `pnpm desktop:build` 构建原生应用后启动新产物。`pnpm build` 生成前端资源，A2A 原生客户端随桌面宿主构建运行。已打开的 CLI 会话需重开以取得新增 MCP 工具；1.0.9 及更早版本不包含这些能力。

房间提示出现 A2A 工具名称，不等于当前客户端已取得工具。如果 Agent 仍读取旧 `belfry` Skill，先核对本机多个 Skill 来源，再检查该会话实际 MCP 工具目录。新源码就绪目录包含五个客户端工具与十个本地工具；所需工具缺失时应报告缺失，不能只凭新提示宣称已切换，也不应自动用旧 Skill / CLI 替代。

## 项目连接入口

点击当前项目工具栏的 **A2A**，打开该项目的连接面板。全局设置不再包含 A2A。面板分为本地 Agent 和外部连接，展示真实本地连接状态与已保存的外部配置；配置保存不代表外部服务在线。新增或编辑时集中显示表单和检测结果，指定接口收在高级选项中。编辑、删除或保存期间，需保存或取消当前操作后才能关闭；项目归属固定，工作台终端持续挂载。

改版界面和受影响检查见 [项目 UI 验证](a2a-project-ui.md)。

## 本地 Agent 自动协作

在更新后的桌面宿主中，用同一个项目打开两条 **Codex PTY / Claude PTY** 会话，并给会话起名，例如“统筹”和“审查”。CLI 实际读取新增 MCP 工具目录、宿主核验当前 PTY 和票据后，才登记为可用的本地 Agent。打开 **项目顶部 A2A → 本地 Agent** 可查看状态；本地连接由宿主管理，无须填写 URL 或凭据，也不能作为外部连接编辑或删除。

首次目录发现的就绪查询总共最多等待 2.5 秒，包含宿主响应与重试间隔。仍有效的实例暂未就绪或超时时可继续发现普通插件与外部 A2A 工具，并在下次目录查询恢复本地工具；已撤销的实例仍被拒绝，晚到结果不能恢复旧实例。业务派活与报告不因这一就绪查询自动重试。

在同一宿主内重新打开同一个后台终端界面时，核验实际 PTY、标签、Agent 和项目后沿用原 MCP 连接与 A2A 登记。跨宿主或新后台实例仍使用新身份；即使 CLI 使用缓存的工具目录，实际调用本地 A2A 工具时也会先通过原生授权登记就绪，再执行业务操作。界面刷新本身不会登记 Agent 或清空终端输入。房间入场提示已压缩为角色、职责、目标和必要协作规则；输入状态修复与验证见 [终端状态核查](terminal-input-status.md)。

`BELFRY_CODEX_NATIVE=1` 隔离路径与其他 CLI 暂无已验证的自动适配器。仅安装 CLI、会话存在或终端空闲不表示就绪。首次 MCP 发现会在 PTY 尚未绑定时有限重试授权握手；仍未就绪时保留其他工具，可再次发现或重开会话。界面区分适配未就绪、无适配器和实例不可用。

对派活方说：

> 发现本项目可用的本地 Agent，把“检查登录流程并给出文本审查结果”交给“审查”。需要补充输入时告诉我；收到对方显式完成回报后再展示结果。

派活方使用 `A2ALocalAgents` 得到不透明的 `local:` 连接 ID，后续 Card、发送、查询、续写和取消复用下面同一组 A2A 客户端工具，真正经过 loopback HTTP。接收方从完整任务中取得自己的 `reportHandle` 与当前 `generation`，用 `A2AReportTask` 报告进展、缺少信息、完成或失败。派活方的 `taskHandle` 与接收方报告句柄用途不同，不能混用。

两者有共同房间时，分派进入原房间任务板并执行统筹／成员权限；有多间共同房间时，用 `A2ARoomTask` 明确指定房间。若发送方没有向该成员派活的角色权限（例如两个普通成员），普通 `A2ASendMessage` 会回退为 direct 任务，不会因为共享房间而失败；要明确走房间任务板请用 `A2ARoomTask`。规划但未分派的任务不等于已投递；合法自领任务从自身任务列表读取并报告。回答房间问题也不会完成任务。

本地 A2A 的协议句柄保存在宿主内存中，应用重启后失效；最近一次协议状态和文本产物预览会持久化到应用数据目录，重启后仍可见。业务任务、房间任务板和收件箱继续保留。接收方重新读取任务后可继续报告，发送方应回到原任务板或房间确认结果，不要复用旧句柄。

| 本地工具 | 用途和主要参数 |
| --- | --- |
| `A2ALocalAgents` | 发现本项目其他就绪 Agent 及不能自动适配的会话 |
| `A2ALocalTasks` | 读取自己的有效任务，支持可选 `room`；列表不含历史，超预算时返回 `truncated`/`omitted` |
| `A2ALocalTask` | 用 `reportHandle` 读完整指令、协议状态、近期消息和产物 |
| `A2AReportTask` | 用 `reportHandle`、`generation`、`state` 显式回报；可带 `text` 和文本 `artifacts` |
| `A2AInbox` | 列出收件箱／待回复问题，列表会截断超长正文并标记 `textTruncated`；用 `messageId` 读取全文；支持 `room`、`cursor`、`limit` 1–30 |
| `A2ARooms` | 读取已加入房间、自己的角色、目标与任务计数 |
| `A2ARoomContext` | 用 `room` 读简报、成员、带真实代次的任务板及近期消息；`count` 1–50 |
| `A2ARoomSay` | `room`、`text` 与可选收件人／问题／回复；回答问题用 `replyTo`、`topicId`、`answers` |
| `A2ARoomBrief` | 统筹用 `room` 与 `objective`、`focus`、`constraints` 更新至少一项；省略保持原值，空值清除 |
| `A2ARoomTask` | `room` 与 `op` 的 add／assign／reopen／archive；非 add 需当前 `expectedGeneration` |

工具的操作 ID 由 Node 生成，模型不能指定身份、项目、实例、代次所有权或 Gateway 密钥。任务进展、备注与交差统一使用受绑定的回报工具，保留原房间任务板为业务权威。回报示例：

```json
{
  "reportHandle": "recipient-issued-handle",
  "generation": 1,
  "state": "completed",
  "artifacts": [{ "name": "审查结果", "text": "已检查登录流程；发现及验证结果如下……" }]
}
```

`state` 可用 `working`、`inputRequired`、`completed`、`failed`。提问和失败必须有非空说明；完成必须有说明或文本产物。文本与产物合计最多 64 KiB、最多 16 个产物，产物名最多 120 字／512 字节。简报合计最多 64 KiB、最多 64 条约束。收到 `outcomeUnknown` 先读取当前任务或房间，不自动重发写操作。

协作面板、房间任务卡和对应收件消息会单独显示“本地 A2A · 显式回报”、协议状态、问题及文本产物预览。界面按任务类型、房间 ID、任务 ID、生命周期代次匹配，原业务状态继续保留。快照最多最近 128 条，说明预览 4096 字、每产物 512 字；截断有标记，完整内容从原任务结果／房间记录或 Agent 任务、收件箱工具读取。刷新失败会提示保留预览可能过期。

本地网关只监听随机 loopback 端口，Card 和 RPC 都需要宿主保管的实例凭据；本期不向其他机器公开本地会话。派活、输入续写和结果保留项目、会话实例、房间角色及任务代次校验。终端闲置不会触发完成。尚未提交的 direct 排队任务可撤回；已经提交、提交不确定或正在执行时可明确返回不可取消。房间任务首期不支持协议取消，由原角色权限归档／重开管理。

## 协作 Skill 迁移

新协作通过 MCP 工具和原生任务提示完成，日常无需读取 Belfry 协作 Skill 或执行协作 CLI。仓库移除内置中英协作 Skill 与安装按钮，旧 CLI 保留人工兼容入口。启动迁移仅删除与已知内置 SHA-256 完全相同的原样副本，不删除修改过的文件或其他 Skill，不跟随符号链接。插件提供的其他 Skills 继续保留。

仓库删除不能证明本机所有副本已消失。后续核查确认 `.codex` 和 `.mirasim` 原样旧副本仍在，`.claude/skills` 与 `.agents/skills` 可通过链接读到共享来源；新源码已补充对 `.mirasim` 已知根的直接检查，继续保护链接和自定义文件。需启动更新后的宿主执行迁移，当前已运行会话也可能携带先前读取的说明。技能变更可自动检测，仍未生效时重开 CLI；本轮未手工清理真实用户目录或替用户重启。具体证据见 [原生残留核查](a2a-skill-residual-native.md) 与 [工具目录核查](a2a-skill-residual-tools.md)。

## 配置外部 Agent 连接

1. 打开目标项目，点击项目顶部的 **A2A → 外部连接**。这里配置其他机器或服务的 Agent，连接只在当前项目内可用；本地 Agent 自动发现，无须在这里手工添加。
2. 点击 **新增连接**，输入名称和 Agent Card 的完整 URL。通常是 `https://agent.example.com/.well-known/agent-card.json`；本机 loopback fixture 可用 HTTP。
3. 选择匿名、静态 Bearer 或 Header API-key。API-key 还需填写服务声明的 Header 名，例如 `X-API-Key`。凭据由宿主保护存储，不会返回编辑表单或 Agent 工具目录。
4. 点击 **检测连接**，读取名称、版本、能力和兼容 interface。默认按 Card 顺序选择 `JSONRPC` / `1.0`。Card 指向不同 origin 时，点击所列接口会自动重新检测；手工填写指定接口 URL 后点击检测。检测失败不会保存或发任务。
5. 点击 **保存连接**。在当前 Agent 中发现 A2A 连接，并使用返回的连接 ID 发任务。

外部服务必须允许宿主访问 Card 和接口。凭据只发送给明确配置的目标，Card / RPC 在不同 origin 且需要不同凭据的组合暂不支持。HTTPS URL 不允许 userinfo 或 fragment；客户端不跟随重定向。

编辑已保存连接时，凭据操作有三种：

| 操作 | 保存行为 |
| --- | --- |
| 保留已有凭据 | 只提交 keep；表单没有原始凭据。要求认证类型、Header 和目标 origin 保持一致 |
| 输入新凭据 | 用新值替换；改变认证类型或目标后必须重新输入 |
| 清除已有凭据 | 删除存储的凭据。连接可保留为待配置状态，调用受保护服务前需要重新输入 |

保存修改或删除连接会撤销该连接的本地请求和任务句柄。已经被远端接受的任务需要单独请求 `CancelTask`；删除连接配置不等于远端执行停止。

## 在 Agent 中调用

兼容的 CLI 会话通过 Belfry 的 MCP 桥接看到以下内置工具。它们无需安装 A2A 插件或读取协作 Skill。工具参数没有任意 URL、凭据、工作区、会话 ID 或原始远端 taskId；这些信息由宿主恢复和核查。

| 工具 | 参数 | 返回与用途 |
| --- | --- | --- |
| `A2AConnections` | `{}` | 当前项目外部与就绪本地的 `{ connections: [{ id, name, auth, local? }] }`；auth 只有类型、Header 名和是否已配置 |
| `A2AAgentCard` | `{ connectionId }` | Agent Card、兼容接口、选中接口和明确的 issue |
| `A2ASendMessage` | `{ connectionId, text, taskHandle? }` | 即时 Message 或 Task；taskHandle 用于后续查询、续接与取消 |
| `A2AGetTask` | `{ taskHandle, historyLength? }` | 单次查询 Task；historyLength 默认 0，范围 0–20 |
| `A2ACancelTask` | `{ taskHandle }` | 实际发远端 CancelTask；结果可能是取消状态，也可能明确不可取消 |

可以直接对当前 Agent 说：

> 发现当前项目的 A2A 连接，读取“外部审查”的 Agent Card，把下面这段任务文本发送过去。返回即时消息或任务句柄；如果任务仍在工作，间隔查询进度，完成后展示文本产物。遇到需要输入时先向我说明。

只发送明确提供的文本，不自动上传整个项目或会话历史。Agent Card 的 skills 是能力描述；A2A 1.0 的 SendMessage 没有通用 skillId 参数。

返回示例：

```json
{
  "kind": "task",
  "connectionId": "saved-connection-id",
  "taskHandle": "host-issued-private-handle",
  "task": { "id": "remote-task-id", "status": { "state": "TASK_STATE_WORKING" } },
  "terminal": false
}
```

后续工具使用 `taskHandle`，不使用 `task.id`。句柄绑定当前项目、Agent 实例和连接 revision；另一会话、重开的实例或已修改连接不能复用。宿主内存中的句柄保留 24 小时；终态后仍可 `GetTask` 查询，但不能再用原句柄 `SendMessage` 续写，需要追问时新发消息。即时 `kind: "message"` 只有 message，无需或无法把它当 Task 轮询。

| Task 状态 | 下一步 |
| --- | --- |
| `TASK_STATE_SUBMITTED` / `TASK_STATE_WORKING` | 间隔调用 GetTask，有界等待，不重复发送初始消息 |
| `TASK_STATE_INPUT_REQUIRED` | 使用原 connectionId 和 taskHandle 再发 SendMessage，提供补充文本 |
| `TASK_STATE_AUTH_REQUIRED` | 说明远端需要进一步认证；当前没有 OAuth 交互流程 |
| `TASK_STATE_COMPLETED` / `FAILED` / `CANCELED` / `REJECTED` | terminal=true；分别展示成功产物、失败、取消或拒绝 |
| 未知 / `TASK_STATE_UNSPECIFIED` | terminal=false；不按成功处理 |

超时后的 SendMessage 可能已经被远端接受，结构化错误会保留 `details.outcomeUnknown`。不要自动重发；服务对 messageId 去重只是一种可选行为。远端不可取消错误保留 `details.rpcCode: -32002`。

停止检测或取消 MCP 工具调用会中断本地 HTTP / 等待；只有明确调用 A2ACancelTask 才会尝试停止远端 Task。客户端采用轮询，暂未实现 SSE、push、OAuth / OIDC / mTLS 或 Card 签名验证。

## 不需要模型凭据的本地试用

在仓库根目录启动独立 fixture：

```sh
node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777
```

它只监听 `127.0.0.1`，不启动 LLM、不读取项目文件，也不调用外部服务。项目 A2A 的新增连接表单中，Card URL 填入：

```text
http://127.0.0.1:17777/.well-known/agent-card.json
```

选择匿名，检测并保存。通过 Agent 工具完成以下可观察流程：

1. 发 `instant: hello`，得到 ROLE_AGENT 的即时消息 `hello`。
2. 发普通任务文本，得到 WORKING 和句柄；第一次 GetTask 仍 WORKING，第二次返回 COMPLETED 与 `fixture-answer` 文本产物。
3. 发 `needs-input: 请补充信息`，得到 INPUT_REQUIRED；使用原句柄发补充文本，再查询到完成。
4. 新发普通任务后立即 CancelTask，得到 CANCELED；发 `uncancelable: 测试` 后取消，得到标准 `-32002`。
5. 发 `fail: 测试`，得到 FAILED；发 `unspecified: 测试`，确认不会显示已完成。

使用静态认证时，重启 fixture：

```sh
node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777 --auth bearer
node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777 --auth apiKey
```

一次运行其中一种。演示凭据固定为 `fixture-key`，API-key Header 是 `X-API-Key`；这是公开的测试值。fixture 的 Card 会按所选模式声明官方 `securitySchemes` / `securityRequirements` 字段。按 Ctrl+C 结束服务。

## 验证与当前接入条件

前后端类型与取消包装以 [接口契约](a2a-contract.md) 为准。定向命令：

```sh
pnpm exec vitest run src/a2a src/settings/SettingsPanel.test.ts src/settings/SettingsPanel.interactions.test.tsx
node --test --test-concurrency=1 scripts/plugin-tests/a2a-tools.case.mjs scripts/plugin-tests/a2a-local-tools.case.mjs scripts/plugin-tests/a2a-http.case.mjs
pnpm check:i18n
pnpm build
node --test --test-concurrency=1 src/components/lazy/testing/a2a-connections.case.mjs
```

原生 fixture 与 embedded MCP 用例实际经过正式 Rust 路由、同一 HTTP 客户端、本地 Gateway 与权威任务 / 收件箱，验证可信显式报告闭环；调用身份与投递写入使用受控合成适配。独立 Node 用例用合成平台回调验证工具契约，HTTP fixture 单独验证精确 wire。浏览器用例服务生产 dist 或生产 React 组件，使用合成 native 命令验证界面。完整命令、数量与结果见 [验收记录](a2a-validation.md)。

自动本地适配范围是 MCP 注入的 Codex PTY / Claude PTY。真实 CLI 模型自主选择工具、真实 LLM 与远端 A2A 服务尚未验收；首期本地 Gateway 只监听 loopback。更新后的桌面宿主与新工具目录是使用这些源码功能的前提。
