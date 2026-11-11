# 协作收件箱与角色模型：整合验收

2026-11-11，集成分支 `feat/collaboration-inbox-integration`，工作树 `belfry-inbox-review`。整合后端 T62 `33b4174`、前端 T63 `6b86f5f`，以及角色模型 T64 `5933111`、`5098132`。本地实现和检查已完成，未发布或安装到用户正在运行的应用。

使用入口、状态说明和截图见[协作收件箱](collaboration-inbox.md)，角色设置见[按角色设置模型](room-role-models.md)。

## 验收结果

| 范围 | 结果与实际覆盖 |
| --- | --- |
| Rust `collab::` | 107 通过，含 28 项收件箱回归：持久收集、不可变批次、任务交差、逐题答复、容量/公平性、竞争恢复、跨会话引用、旧页新答复、删除来源房间后的核对权限 |
| Rust `rooms::` | 68 通过；2 个仓库原有手动基准忽略。包含角色模型、v4 迁移、旧写者保护、强类型模型字段与未知扩展字段保留 |
| Rust `provider::project` | 12 通过；1 个原有真实 CLI 网络冒烟忽略。覆盖六种 Agent 的模型覆盖与默认继承，不修改共享 Provider |
| Rust `terminal::` | 既有 139 项与新增 2 项输入/输出锁回归通过；新增真实 PTY 整合测试定向复跑通过，共覆盖 142 项 |
| CLI / protocol | 61 通过，含新字段经旧 relay 传递、能力标记、单次提交和截止时间；CLI 已重建并同步本工作树的 macOS sidecar |
| 前端相关回归 | 20 文件、190 项通过，覆盖 inbox、Prompt、终端 controller/生命周期和房间读取；最终收紧兼容判断后，`useInboxDelivery.test.ts` 增加 1 项并定向复跑，10 项通过 |
| 收件箱浏览器 | 5 个组合场景全部通过、零跳过；最终文案构建后另定向复跑 2 项阅读场景更新截图，其他 3 项因名称筛选未重跑 |
| 角色模型浏览器 | 3 个组合场景通过、零跳过：中英文、独立保存/清除、候选选择、失败保留输入、陈旧表单与角色改绑 |
| 构建与词库 | TypeScript、生产构建、`cargo check --locked --offline -p belfry-desktop`、词库生成目录检查通过；中英各 3492 条，硬编码白名单为 0；后端词库检查 3 项通过 |

## 整合时修正的行为

- 后端探测失败、协议未知或缺少能力标记时停止自动投递；仅明确不存在探测命令才使用旧投递路径。启用失败保留错误，不启动第二个投递者。
- 读取新 revision 时刷新已展开历史范围，补齐两轮刷新之间新增的多页内容；原历史游标保留。移出项目即清除旧选择，迟到响应不能恢复旧项目消息。
- 被引用原文不在当前页或来自另一接收会话时，使用后端原文预览；每个问题的答复状态仍取最新投影。
- 前端与原生层分别核对安全粘贴模式、冻结正文和输入代次；错正文不写入，用户抢先输入使旧许可失效，DSR 自动应答不误撤销批次。
- 原生 PTY 写入前释放输出模式锁，输入仲裁锁继续保持到本次写入结束。两个有界回归证明普通写入和带 guard 的写入均不会堵住输出观察器。
- 角色 `modelOverride` 与收件箱的成员扩展字段合并；存储升级后模型覆盖、未知字段以及同类型 Agent 的独立身份都保留。

## 真实终端验证

`src-tauri/src/terminal/native_inbox_test.rs` 使用临时 RoomStore、TaskBoard、InboxService 和真正的 `TerminalRuntime::with_platform_backend()`。隔离的 bash PTY 只收取原始字节，不解释消息为命令，不加载用户 shell 配置，不连接模型服务。

测试将两条同议题原文冻结为一批，拒绝错误正文，以两个序号写入分片并重试第一片，随后接收子进程发出的 DSR 查询并回应，最后单独提交 Enter。子进程实际落盘的粘贴帧、协议应答、提交键逐字节匹配预期；重复序号没有重复写入，重复 submitted 回执不产生新提交，两条消息仍显示“处理情况未知”。角色模型经同一轮存储写入和重载后保留。

两个并发回归位于 `src-tauri/src/terminal/inbox_concurrency_test.rs`，使用有界等待检查写入期间输出观察器能继续运行，失败也不会遗留挂起线程。

## 浏览器证据

收件箱测试运行未改写的 `dist/` 生产构建、真实 React 页面和 xterm；**原生 IPC 被测试替身替换**。它验证页面点击、输入运行时调用顺序、粘贴编码和前端竞争处理，不等同于浏览器到实际 Tauri 后端的完整贯通测试。角色模型测试同样替换原生 IPC，使用真实房间设置组件。

收件箱五个场景覆盖中文 1440×900、720×480 的只读列表/详情/搜索/返回，用户抢先输入，原生代次先变化，真实 xterm 的安全粘贴与 DSR，以及英文窄窗的阅读和打开会话。截图在 [production-screenshots](design/collaboration-inbox/production-screenshots/)，共六张；截图等待页面入场动画结束后采集。

## 复跑

在仓库根目录运行前端检查和浏览器回归。Node 20 需要 WebSocket 标记：

```sh
pnpm exec vitest run src/inbox src/terminal/promptInput.test.ts
pnpm build
pnpm check:i18n
node scripts/sync-backend-i18n.mjs --check
node scripts/export-backend-i18n.mjs --check
node --test scripts/backend-i18n.test.mjs
node --experimental-websocket --test src/components/lazy/testing/inbox.case.mjs
node --experimental-websocket --test src/components/lazy/testing/room-role-model.case.mjs
```

在 `src-tauri/` 下运行 Rust 检查。本轮使用独立 `CARGO_TARGET_DIR=/tmp/belfry-t64-target`：

```sh
cargo test --locked --offline -p belfry-desktop --lib collab:: -- --test-threads=4
cargo test --locked --offline -p belfry-desktop --lib rooms:: -- --test-threads=4
cargo test --locked --offline -p belfry-desktop --lib provider::project -- --test-threads=4
cargo test --locked --offline -p belfry-desktop --lib terminal:: -- --test-threads=4
cargo test --locked --offline -p belfry-cli -p belfry-protocol
cargo check --locked --offline -p belfry-desktop
```

## 运行范围

本轮验证环境为 macOS。未执行 Windows/ConPTY/WebView2 原生验收，未向真实 Agent 注入测试消息，未调用模型服务，也未执行应用界面到 Tauri IPC 的完整贯通测试。分页视觉未另设浏览器场景，分页、跨页新答复和稳定游标由前后端回归覆盖。

首版持久化仍使用原子 JSON 和内存投影，保留终态、批次和操作去重记录；本次未实现后台归档或数据库索引。旧普通任务缺项目且原 tab 未重新登记时保留在原来源，等待目标项目可确定后补收。
