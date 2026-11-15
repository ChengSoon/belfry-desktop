# A2A 1.0 项目接入结果

日期：2026-11-15。**首期源码与约定验收已完成。用户试用发现旧协作 Skill 残留，后续已补共享来源迁移和房间工具指引并通过定向检查；本轮没有迁移真实用户目录或重开现有会话，不能宣称客户端已经完成切换。**

后续试用的空终端输入误报和 A2A 重挂登记问题也已修正，入房提示与批次指引已缩短，「项目连接」改名为「外部 Agent 连接」。本次定向回归、生产构建和实际环境边界见 [终端状态核查](terminal-input-status.md)；下方保留各历史阶段的原始验收结果。

本轮已把 A2A 1.0 接入 Belfry：用户可以连接外部 Agent 服务，也可以让本地适配的 Codex / Claude 会话通过同一协议分工、补充输入、报告进度并交换文本结果。仓库内置 Belfry 协作 Skill、自动安装和安装按钮已移除，新协作使用可发现工具与原生任务提示；本机已安装副本与客户端发现状态需单独核查。

## 用户可以使用的新功能

| 场景 | 实际行为 |
| --- | --- |
| 让本地 Agent 分工 | 在同一项目中发现就绪会话，通过标准 HTTP 派任务；例如让 Codex 开发、Claude 审查 |
| 接入外部专业 Agent | 在项目顶部 A2A 中添加兼容 Agent Card、检测并保存项目连接，然后发现能力并发送任务 |
| 追踪进度与补充条件 | 接收方显式报告 working / inputRequired / completed / failed；派活方续接原任务并查询文本结果 |
| 查看问题和产物 | 协作面板、房间任务卡与收件箱显示协议来源、状态、待补充问题和文本产物预览 |
| 请求停止任务 | 区分停止 HTTP 等待、撤回尚未提交的 direct 排队任务和真正 CancelTask；不可安全取消时返回真实原因 |

房间、任务板和收件箱保存业务权威状态。分派执行原角色权限，报告绑定当前项目、接收实例与任务代次；回答问题和终端闲置都不会结清任务。内置五个客户端工具用于发现连接、读取 Card、发送、查询和取消，十个本地工具提供任务全文、报告、收件箱、房间上下文、讨论、任务板与简报操作。

## 运行与试用

在仓库根目录按 README 准备依赖后运行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

也可通过 `pnpm desktop:build` 构建原生应用。新功能随更新后的桌面宿主运行；重开 CLI 会话以读取新增 MCP 工具。原来运行中的 1.0.9 二进制尚未包含这些源码改动。

本地试用：在同一项目打开两条 Codex PTY / Claude PTY 并起名，实际读取 MCP 工具目录后，到 **项目顶部 A2A → 本地 Agent** 查看就绪情况。对派活方说：

> 发现本项目可用的本地 Agent，把“检查登录流程并给出文本审查结果”交给“审查”。需要补充输入时告诉我；收到对方显式完成回报后展示结果。

接收方从自己的任务工具读取完整指令，用 `A2AReportTask` 显式回报。外部服务则在 **项目顶部 A2A → 外部连接** 添加 Agent Card，选择匿名、静态 Bearer 或 Header API-key，检测后保存，再通过同一组客户端工具调用。

不需要新模型凭据的协议演示：运行 `node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777`，配置 Card `http://127.0.0.1:17777/.well-known/agent-card.json`。即时消息、输入续写、查询产物与取消示例见 [使用指南](a2a-guide.md)。该服务是本地夹具，不运行模型。

## 支持范围

| 入口 | 本轮实现范围 |
| --- | --- |
| MCP 注入的 Codex PTY / Claude PTY | 已实现自动就绪发现、本地 HTTP 任务和可信工具报告；协议 / 宿主夹具验证通过，真实模型自主使用工具尚未验证 |
| 兼容外部 A2A 1.0 服务 | 按项目配置 Card 与 JSON-RPC 接口；匿名、静态 Bearer 和 Header API-key；真实远端服务尚未测试 |
| `BELFRY_CODEX_NATIVE=1` 与其他普通 CLI | 没有已验证的自动执行与报告适配器，界面显示真实未适配状态 |
| 本地网关 | 随宿主启动，随机 loopback 端口、每实例独立凭据；首期文本与 JSON-RPC 轮询，未向其他机器公开 |

协议依据是官方 [v1.0.1 发布](https://github.com/a2aproject/A2A/releases/tag/v1.0.1) 与 [对应 Proto](https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/specification/a2a.proto)，wire 使用 `A2A-Version: 1.0`、`application/json` 和 PascalCase 方法。旧 0.3 请求结构不保证兼容。SSE、push、OAuth / OIDC / mTLS、Card 签名与完整多媒体不在首期范围。

## 试用反馈：客户端仍读取旧 Skill

用户截图的房间提示已经要求 `A2ARoomContext`、`A2ARoomTask` 和 `A2ARoomSay`，但 Agent 随后读取了 `belfry` Skill。这证明旧说明仍被选中；截图没有展示后续调用，不能据此认定任务已经通过 A2A 执行。

| 名称 | 作用 | 实际执行入口 |
| --- | --- | --- |
| 原 Belfry 协作 Skill | Markdown 操作说明，教模型如何协作 | 模型读说明后执行 `belfry room` 等 CLI 命令，直接调用原宿主协作接口 |
| A2A 客户端与 Gateway | Agent 发现、任务发送、查询、续写和结果交换的标准协议实现 | 可发现客户端工具通过正式 HTTP / JSON-RPC 与本地或外部 Agent 交互 |
| 本地房间与回报工具 | 读取业务上下文、操作任务板并显式回报当前任务 | 受控 MCP 薄工具调用宿主权威状态，继续核验项目、实例、角色和代次 |

Belfry 产品、房间、任务板和 `belfry inbox` 消息外壳仍然保留。被移除的是仓库附带的旧操作说明和自动安装入口；并非删除整个协作系统，也不能将新工具名称本身当成协议闭环证据。

统筹已只读确认 `/Users/cheng/.codex/skills/belfry/SKILL.md` 与 `/Users/cheng/.mirasim/skills/belfry/SKILL.md` 均存在，内容与已知原内置 SHA-256 一致。`~/.claude/skills` 和 `~/.agents/skills` 是指向 `~/.mirasim/skills` 的符号链接。首期迁移保护链接，未直接列入 `.mirasim` 根；因此仍存在可发现旧文件的来源。普通新桌面启动调用迁移，daemon / CLI hook 提前退出路径不执行；当前多个进程并存本身不能证明旧版重装或定位截图使用的宿主。

[OpenAI 官方 Skill 说明](https://learn.chatgpt.com/docs/build-skills) 确认技能按名称和描述匹配，选中后读取完整 `SKILL.md`；发现来源包含用户与共享目录，同名项可能分别出现。技能变更可自动检测，未生效时可重启；不能把所有残留一概解释为只在启动时刷新的缓存。

T16 / T17 的源码补丁和定向检查已完成：迁移直接检查 `.mirasim` 已知共享根，仍仅清退已知哈希的原样文件；房间提示明确要求直接使用 A2A，缺少工具时报告缺失。本轮不手工删除真实用户 Skill、不跟随任意链接、不关闭或重启用户会话。当前旧副本与这条已运行会话的工具暴露状态仍未改变。

本次模型工具列表没有 A2A 名称；生产目录函数的合成元数据检查分别返回未就绪时五个、就绪时十五个 A2A 名称，实际双 embedded MCP / HTTP 回归也通过。两类证据需要分别解读，不能把模型列表代替截图会话的真实 MCP `tools/list`，也没有独立证据锁定具体绑定原因。完整观察见 [原生残留核查](a2a-skill-residual-native.md) 和 [工具目录核查](a2a-skill-residual-tools.md)。

## 协作 Skill 迁移

仓库中英协作 Skill 资产及安装代码 / UI 已删除。加入房间、任务解锁、读取完整消息与报告结果的运行时提示已改用协议工具；人工 CLI 兼容入口保留。

更新后的宿主启动时，仅删除与已知原内置 SHA-256 一致的旧副本，保留修改过的副本、其他 Skill 和符号链接。统筹已将两语言指纹与基线 `7140b60` 的原资产独立核对。原样删除、重复执行、范围与链接保护在临时目录测试；本轮未迁移真实用户目录。

## 验收证据

以下是 T13 首期最终代码的原始完整检查结果。T16 / T17 的追加改动和必要定向验证另行记录，不能把这些原始总数当成后续工作树已重新执行的全量结果。

| 检查 | 已核对结果 |
| --- | --- |
| 完整前端回归 `pnpm test` | 207 文件，1385 测试通过 |
| 完整 Rust workspace `cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked` | 最终就绪时限修正后的新嵌入资产退出 0，1071 通过、14 项既有 ignored |
| A2A 原生回归 | 42 项在完整 Rust 集中通过；含外部客户端、本地适配、迁移与票据授权，不与 workspace 数量相加 |
| 类型检查、前端生产构建与目录 | `pnpm build`、i18n / export / sync 检查通过；3802 条 / 语言；目录及 CI 检查 24 通过、1 个 Windows 专属用例按原规则跳过 |
| Playwriter | 构建与 5 项回归通过 |
| 原生构建与进程 | desktop build、项目 cwd 2 项、daemon 与 6 种 fake CLI 人工兼容进程协议通过 |
| Node 24 发布资产 / sidecar | 22 项通过；debug sidecar 已按 CI 准备 |
| A2A 与受影响 MCP 工具 | Node 24 共 30 项通过；Node 20 本地与原 MCP 共 22 项通过，包含 4 项新增有界就绪 / 撤销恢复回归 |
| 完整生产插件 / 浏览器 | 最终 85 文件、401 项全部通过，0 失败 / 取消 / 跳过；完整 TAP 与原预算校验通过 |
| Node 20 CI 发布资产 / sidecar / 生产面板 | 26 项通过，0 失败 / 跳过；与其他阶段存在重叠，不相加 |
| 中英文网站 | `pnpm --dir website build` 退出 0；`website/build/docs/a2a/index.html` 与 `website/build/en/docs/a2a/index.html` 均生成 |

本地双 Agent 用例执行实际嵌入 Node MCP → 正式 Rust 路由 → 同一 HTTP 客户端 → Gateway → 权威任务 → 接收方显式报告 → 派活方 GetTask，包含输入续写、房间任务、首次绑定恢复、取消和旧代次拒绝。直接跨项目 HTTP 用例先证明双方有效凭据访问自己的 Card 成功，再验证另一项目 Card 404、Send / Get / Cancel 返回 -32001，原任务板、房间 outbox、收件箱与网关映射快照不变。

这些原生 / 嵌入用例使用合成的已授权 Agent / PTY 快照和受控投递写入回调；浏览器使用生产 dist 与合成 native IPC。证据验证协议和宿主状态闭环，没有运行真实 Codex / Claude 模型或真实远端 Agent。

最终检查中首次 Rust 构建遇到 ENOSPC，工程2清理本包可重建 dev 产物，统筹复核可用空间从约 453 MiB 恢复至 25 GiB。随后发现宏测试仍引用退役提示，仅更新两行测试模板 / 英文期望，保留字段重排断言；相同 `--workspace --locked` 命令最终通过。首次失败、清理和最终成功日志均保存在 `/tmp/belfry-a2a-t13/`。

首轮插件总套件中，两项撤销夹具无条件挂起所有宿主请求，导致新增的工具目录就绪握手被阻塞，尚未进入真正 UI 工具执行。原作者迁移夹具，保留撤销拒绝与私人结果保护断言，并补单一 2.5 秒时限覆盖宿主等待与重试暂停。新增真实 MCP 回归验证悬停、累计耗时、晚响应与撤销 / 取消恢复，Node 24 的 30 项及 Node 20 的 22 项通过；修正后的真实嵌入资产已通过完整 Rust workspace。最终插件总集合 85 文件、401 项全部通过，无跳过或报告 issues，耗时 657.588 秒，保持原 2100 秒总预算与 300 秒单项预算。随后 Node 20 的 CI 指定 26 项与中英文网站构建通过；统筹已独立核对退出码、完整 TAP 汇总、Node 20 日志和两个语言的 A2A 页面。

实际命令、逐项结果、截图与可复现步骤见 [验收记录](a2a-validation.md)。客户端和本地接口分别见 [外部契约](a2a-contract.md)、[本地契约](a2a-local-contract.md)；官方调研见 [技术核查](technology-scan.md)。

## 后续残留修正的定向验证

| 命令过滤范围 | 本次结果 |
| --- | --- |
| `a2a_skill_migration` | 5 通过，0 失败 / 忽略；含新增共享来源与链接、自定义保护、重复执行 |
| `collab::inbox::` | 32 通过，0 失败 / 忽略 |
| `local_a2a_two_embedded_mcp_sessions_use_real_http_and_bound_reports` | 1 通过，实际 embedded MCP / HTTP / 权威任务 / 显式报告闭环，身份和投递回调仍为夹具 |

三条实际 `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked FILTER -- --nocapture` 命令及退出码 / 时间 / 完整日志保存在 `/tmp/belfry-a2a-skill-residual/`。未改前端、Node 工具或依赖锁，未重新执行首期全套检查；原始总数与本次结果分开记录。

## 交付边界

最初调研基线为 `f9d9d92` / 应用 1.0.8；实施工作树基于其他用户会话提交的 `7140b60` / 1.0.9，保留已有变更。本轮未创建发布版本、提交、PR 或部署。

Windows / Linux 原生打包与 Windows 安装脚本未在本机执行。缺少固定上游 `BELFRY_PI_SOURCE` 时，4 项 PI 互操作按原规则另行验收，不计为通过。T8 / T9、T11 / T12 和 T13 首期已交付；T16 / T17 后续源码修正、核查说明和定向验证完成。真实用户的客户端切换需启动更新后的宿主、取得 A2A 工具目录并观察实际调用；真实模型、真实远端服务与其他平台的验证边界保持上述说明。
