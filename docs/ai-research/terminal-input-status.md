# 终端输入状态、入房提示与 A2A 重挂核查

日期：2026-11-15。针对用户房间「123123」的截图：终端没有待提交内容，收件箱仍显示「终端有未提交输入」。该房间对应项目为 `src-tauri`。

## 原因和改动

该提示来自 Belfry 的输入所有权标记，没有直接读取 CLI 输入框的实际内容。原实现存在两个可复现问题：重新挂载已有终端时，前端将输入重新初始化为占用；后台把跨宿主重连或输出缺口后的未知状态，也统一显示为 `composer_not_empty`。重新播放已经处理过的历史输出缺口同样会丢掉已确认的空输入状态。因此，提示不能证明终端实际存在待提交文字。

现在，终端创建／重挂响应附带当前宿主的输入状态、输出序号和待确认提交序号。前端恢复已有状态，后台区分已经处理过的历史输出缺口和新的缺口。真正未知时显示「等待确认终端输入状态」；真实草稿、IME 输入、未确认粘贴和后续编辑仍保持占用，所有自动写入继续取得原生许可。恢复的待确认提交只由其后真实的 `working` 报告确认，旧回放不能清除新草稿。

同一宿主重新挂载同一个 PTY 时，原插件连接还会被换票并撤销，造成已就绪的本地 A2A 登记丢失。现在仅在实际 PTY、标签、Agent 和规范化项目均匹配、旧连接仍有效时沿用原 MCP 连接；跨宿主或新实例继续签发新身份。缓存目录中的本地 A2A 工具被实际调用时，先经原生身份核验登记就绪，再执行业务操作。页面刷新不登记就绪，也不清空输入。

原「项目连接」标题改为「外部 Agent 连接」，用于按项目配置其他机器或服务的 Agent。本地 Agent 自动发现，不需要手工添加外部连接。

入房提示保留房间、角色、职责、目标及必要分工、错误核对和显式交差规则，删除重复工具说明，压缩每批收件附带的指引。截图中的统筹示例从 311 字符缩为 197 字符，减少约 37%；用户填写的职责和目标保留。中英文同步，回复参数继续使用 `answers=[questionId,...]`。

主要实现：`src-tauri/src/terminal/input_gate.rs`、`terminal/commands.rs`、`terminal/runtime.rs`、`src/terminal/controller/protocolInputOwnership.ts`、`src-tauri/src/plugins/agent_connection.rs`、`plugins/node/mcp-server.mjs`、`plugins/node/mcp-a2a-local-tools.mjs`、`rooms/ops.rs` 和 `collab/inbox/scheduler.rs`。

## 验证

首次新增的重挂回归在 Codex、Claude 两种状态模型上均复现失败；修复后通过。以下为本次实际检查，不与首期或重叠阶段累计：

| 检查 | 结果 |
| --- | --- |
| 前端终端所有权、生命周期与收件状态，5 文件 | 126 通过 |
| 前端 A2A、收件箱、房间，20 文件 | 146 通过；与上一组有重叠 |
| 原生 `terminal::` | 213 通过 |
| 原生 `plugins::agent_connection::` | 6 通过 |
| 原生 `collab::inbox::` | 32 通过 |
| 原生 `rooms::` 最终回归 | 74 通过、2 项既有 ignored |
| 原生 `a2a::` | 37 通过 |
| 双 embedded MCP → 实际 HTTP → 权威任务／显式报告 | 1 通过 |
| `belfry-i18n` / `belfry-i18n-macros` | 7 / 1 通过 |
| 真实 Node MCP，本地 A2A、连接生命周期与原 MCP | 24 通过，0 失败／取消／跳过 |
| TypeScript、前端生产构建、i18n、catalog export/sync、diff | 通过；3803 条／语言 |
| 原生桌面 debug 构建 | `cargo build --manifest-path src-tauri/Cargo.toml --bin belfry-desktop --locked` 通过；日志见 `desktop-build.log` |

Rust 命令使用 `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked FILTER`；两个 i18n 包单独用 `-p` 检查。原生命令、退出码和完整日志在 `/tmp/belfry-terminal-input-20261115/`，包括 `native-summary.json`、`native-final-summary.json`。首次房间检查仅因两处仍匹配旧提示词而失败；已更新为新中英文角色标记，原角色分工、参数保留、交差和权限断言继续保留，原失败日志未覆盖。

Node 命令：`node --test scripts/plugin-tests/a2a-local-tools.case.mjs scripts/plugin-tests/mcp-lifecycle.case.mjs scripts/plugin-tests/mcp.case.mjs`。前端命令分别为指定五个终端／收件测试和 `pnpm exec vitest run src/a2a src/inbox src/rooms`；另执行 `pnpm build`、`pnpm check:i18n` 及后端目录检查。

## 实际环境和边界

旧统筹会话自己的真实 MCP `tools/list` 返回 HTTP 200、11 个工具、0 个 A2A 工具；只能证明该会话仍连旧宿主，不能据此解释用户更新后新建的全部会话。用户后续截图已经展示实际 A2A 工具调用。本次确认并修复的是上述源码路径及回归，没有把模型工具清单或受控夹具当作用户截图对应会话的实时诊断。

改动随更新后的前端与原生宿主生效；已保存的历史入场消息保留。没有替用户提交终端内容、关闭／重开会话、迁移真实用户 Skill、发布版本或提交工作树，也没有用终端空闲推断任务完成。真实 Codex／Claude 模型的自主工具使用和远端服务未在本轮重新验收。

本次派发任务返回原始错误：「房间已被另一应用实例更新，请重新加载后再操作；本次修改未提交。」随后核对任务板仍只有原先的 12 件已完成任务，新任务没有写入；未绕过任务板派活或重复创建。统筹直接完成本次局部修正。

## 再次反馈：重复终端应答与 A2A 状态

同日用户再次反馈空终端仍有该提示，并要求按 A2A 协议判断。只读持久化元数据已将截图中的前端 `…cf1aa5`、后端 `…1bc7b8` 对应到「123123」房间及 `src-tauri` 项目。T1–T4 均为 `done`，等待项属于房间讨论／回复消息；已完成的任务分配在收件存储中为 `abandoned`。相关 PTY 在开发后台 PID 63902；两位成员的回放有历史缺口、光标位置查询及最终 `done`，未保存原始终端正文或身份凭据。该证据确认任务板与回放情况，不提供输入框内容或旧标记来源的完整历史。

新增回归复现了此前遗漏的事件序列：光标查询首次应答后，已处理的查询又被 xterm 从历史输出解析，应答仍走普通 `terminal_write`；原生侧已消耗查询，因此把重复应答误判为人工输入。输入从 `empty` 变为 `occupied`，后续投递被拦住。

现在前端通过公开 xterm 解析器标记其自动生成的 CSI 回复，使用独立的 `terminal_write_response`，并保持与提示正文／Enter 共用的写入队列。原生侧只写出仍有效且尚未回答的查询应答；重复或过期应答丢弃，不触碰输入所有权。手工键盘、粘贴和 IME 不借用该标记；缺少应答通道时也不降级成普通输入。实际 PTY 回归确认子进程只收到一次光标应答，下一字节仍是正确的 Enter。

A2A 任务的 `Task.status.state` 已由显式 `A2AReportTask` 回报与权威任务板决定，设备回复与终端空闲不会完成任务。标准 A2A 没有 CLI 草稿是否为空的字段；当前本地接入为 `mcp-pty`，协议接收任务后仍由收件箱写入 CLI。输入许可只保护这一步，不决定 A2A 任务是否完成。外部 A2A HTTP 任务不经过本地 PTY 输入检查。完整规则见 [原生状态与 A2A 的职责](../agent-terminal-status.md#a2a-任务状态与-cli-输入位置)。

复查 A2A 时发现一项原有房间 HTTP 用例返回 400。单独运行通过后，针对非阻塞 accepted socket 与分片请求新增可控回归，复现 `HTTP/1.1 400 Bad Request`：BSD/macOS 可继承监听 socket 的非阻塞属性，读取未到齐的请求会立即返回 `WouldBlock`。现在 accepted socket 切换到阻塞读写，仍保留原来的全请求五秒时限。最终该回归、原失败房间用例及认证／归属／显式回报检查均通过。

本次最终结果单独计数，与前文阶段不累计：

| 检查 | 结果 |
| --- | --- |
| 前端输入、生命周期、收件箱与 A2A 回报，7 文件 | 166 通过 |
| 原生 `terminal::`，含实际 PTY 投递 | 214 通过 |
| 原生 `a2a::local`，含真实 HTTP 与 embedded MCP | 20 通过 |
| 最终生产构建／真实 xterm 收件箱浏览器 | 5 通过，0 失败／取消／跳过 |
| TypeScript／前端构建、原生桌面 debug 构建 | 通过 |

命令与日志在 `/tmp/belfry-terminal-false-input-20261115/`：`reproduced-behavior.log` 与 `a2a-http-fragmented-reproduced.log` 为两个真实行为失败；最初新增测试的编译错误及监听器数量断言错误也保留。最终为 `frontend-final.log`、`native-terminal.log`、`native-a2a-verified.log`、`browser-inbox-final.tap`、`build-frontend-final.log` 和 `build-desktop.log`。用户实际 PTY 的只读证据是 `relevant-session-metadata.json`；浏览器原生 IPC 为受控适配器，实际 PTY 字节由 Rust 用例另验。没有重新进行真实模型自主工具使用或远端服务验收。

修复需同时加载新的前端和 Rust 宿主。编译产物已生成；本轮未手动重启用户应用或关闭 PTY，也未用任务 `done` 清空已有草稿／未知输入标记。再次派发返回「另一实例正在保存，请稍后重试」，随后任务板核对仍无新任务；没有重复创建或通过其他消息通道派活。

最终通过 `belfry room say --to @用户` 汇报时返回原始错误：「房间已被另一应用实例更新，请重新加载后再操作；本次修改未提交。」随后再查任务板，仍为原有 12 件已完成任务、两名工程成员 `done`，没有新任务。该房间汇报未写入；未重复提交或绕过持久化保护。

## 会话 01a1dedd 续接：鼠标移动被记成草稿

续接用户对「1123123」房间的反馈。只读后台回放显示，前端 `…d37fcc` 开启了 DECSET 1003、1006，即 SGR 全鼠标事件上报；最新协议状态仍为 `idle`。这种模式下，即使没有按键、粘贴或鼠标按下，移动鼠标也会生成 `CSI <35;x;yM`。原生普通写入通道把它当作编辑输入，推进输入代次并占用编辑器。

在生产页面、真实 xterm 和 CDP 鼠标事件中复现：仅移动一次鼠标，受控原生边界就收到一次普通输入，`inputRevision` 从 0 变为 1。修复通过 DOM 事件来源标记把这种报告送入应答通道，原生再核验 CLI 仍启用了相应鼠标模式。报告仍交给 CLI，既不占用空编辑器，也不清除已有草稿；点击、拖拽、滚轮、键盘、粘贴和 IME 保持原有保护。

首次修复在单元测试通过后仍被真实浏览器用例抓到失败：浏览器会在 DOM 捕获监听器与 xterm 监听器之间执行微任务，过早清掉来源标记。最终按原始事件是否仍处于分发中判断有效期，事件结束后不能借用该标记；解析器设备回复继续使用原来的同步处理规则。

本轮最终检查均以退出码 0 完成，不与前文历史阶段累计：

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/terminal src/inbox --reporter=dot` | 38 文件、448 项通过，无未处理异常 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked terminal::` | 217 项通过，含真实 PTY 回归 |
| `node --test src/components/lazy/testing/inbox.case.mjs` | 6 项通过，含真实鼠标移动与后续整批一次投递 |
| `pnpm build`、最终 `pnpm exec tsc -b` | 通过 |
| `cargo build --manifest-path src-tauri/Cargo.toml --bin belfry-desktop --locked` | 通过 |

验证命令与日志保存在 `/tmp/belfry-hover-input-20261115/`。浏览器仍使用受控原生 IPC；Rust 测试另行验证真实输入闸门、报告转发、投递许可和实际 PTY。历史记录没有保存当时每次输入的来源，现场鼠标模式与复现条件相符，但不据此声称已还原全部历史事件。此次代码修复不强制清除真实会话已有占用标记，也不代用户提交任何终端消息。

## 会话 01a1df3d 续接：Esc／删除与空输入框

同日用户再次反馈：房间「111」的统筹终端输入框为空，收件箱仍显示「终端有未提交输入」，并追问现有检测方式是否可靠。

只读读取开发版终端后台（PID 63902，`terminal-daemon-v1-dev/versions/1.0.9`）的完整回放后，统筹会话（tab `5b74f08c…2fafb6`，PTY `01m7fk46yrydfrm8mtq1styg0w`）最后画面是：

```text
› Ask Codex to do anything
GPT-6-Astra xhigh Fast · ~/work/Project/tool/belfry-win/src-tauri
```

原始字节中提示语由 `ESC[2m` 绘制，光标停在提示符后第 2 列；同一回放的 OSC 7501 记录依次为 `idle → working → idle → working`，最后一条停在 `working`，之后没有再输出。房间持久化收件箱中两条等待消息的原因来自原生 `composer_not_empty`。

据此确认三个独立问题：

1. `user_write` 把所有非设备应答字节都当成编辑输入。Esc、左右方向键、Home/End、翻页都会写入 `input_dirty`，并清掉待确认提交；之后即使 `working` 到达也无法确认消费，输入框永远显示占用。
2. 用户把字删光不会清除占用：原生只记录“有过非提交字节”，没有内容为空的正向证据。
3. `tab_blocker` 先报告编辑器原因。原生状态其实是 working，但界面仍显示「终端有未提交输入」，把 Agent 忙／卡住误导成用户草稿。

改动：

- 原生 `passive_key` 识别 Esc、光标移动与翻页序列：仍中断自动粘贴，但不改输入代次、不清待确认提交、不新增草稿。
- 挂载中的 Codex 视图在输出稳定后读取 xterm 缓冲，只有看到 Codex 的暗色空输入框提示时才调用 `terminal_confirm_empty_input`；连续稳定两轮才上报，用户按键立即作废本次观察。原生在没有已授权写入或交互时清除草稿／未知状态。透明背景会剥掉 dim，改为核对完整提示文本。Claude 版式未经真实屏幕验证，不参与。
- `tab_blocker` 先判断协议位置，再判断编辑器与安全粘贴；忙碌或缺少新报告时显示「等待终端就绪」。

本轮检查（均退出码 0）：

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/terminal src/inbox --reporter=dot` | 39 文件、459 项通过 |
| `node --test src/components/lazy/testing/inbox.case.mjs` | 7 项通过，含真实 xterm 暗色提示与真实草稿的对照 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked terminal::` | 222 项通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked collab::inbox` | 32 项通过 |
| `pnpm exec tsc -b`、`pnpm build`、原生桌面 debug 构建 | 通过 |

回放只证明当时的屏幕与状态，不提供历史按键来源；本轮没有替用户提交终端内容、关闭或重开会话，也没有发布版本。
