# A2A 复核问题修复记录

日期：2026-11-16。范围：外部 A2A 客户端、本地 Gateway、MCP 工具、连接面板与相关文档。本次为源码复核后的修复，不发布新版本。

## 已修复

| 问题 | 处理 |
| --- | --- |
| 共同房间内成员 → 成员的普通 Send 必然失败 | `room_context` 先检查房间角色；无权给该成员派活时回退为 direct 任务，房间标题先 trim |
| 超过 1 MiB 的 A2A 结果在宿主桥接层静默丢失、60 秒后超时 | 平台回包超过 900 KiB 返回明确 `A2A_RESPONSE_LIMIT`；远端 Task history 超过 700 KiB 时从最旧消息裁剪并标记 `metadata.belfryTruncated.history` |
| loopback 的本地 bearer 可能被系统代理截走 | loopback 目标使用 `.no_proxy()` 的独立 Client；外部 HTTPS 保留系统代理 |
| 远端明确 JSON-RPC/HTTP 拒绝被标成 `outcomeUnknown` | 401/403、4xx、JSON-RPC error 显式标记 `outcomeUnknown:false`；只对传输/超时/取消/畸形响应升级为未知 |
| 收件方瞬时授权查询失败被报告为终态 FAILED | `recipient_health` 区分 Active/Gone/Unknown；Unknown 保留业务状态并附说明 |
| UI 快照/任务列表/收件箱逐条查询 daemon、逐条克隆任务板 | `Snapshots` 一次授权快照、任务板按需克隆一次；列表与收件箱批量复用 |
| 长轮询频繁查询且单个 Agent 可占满 permit | Wait 轮询 500 ms；每 Agent 最多 4 个并发 Wait |
| 重启后协议状态完全消失 | 最近协议预览持久化到应用数据目录并在快照中恢复；已删除任务/房间不恢复；句柄本身仍按设计失效 |
| 单个坏 interface 使整张 Card 失效 | 跳过无效/不兼容条目，最终按 `NO_COMPATIBLE_INTERFACE` 报告 |
| Skill 级认证要求阻断整张 Card | 保留结构校验，但不再因单个 skill 的认证要求阻断 SendMessage |
| 同一 URL 多 tenant 接口无法区分 | 全链路新增 `interfaceTenant`，Card 选择按 URL + tenant 匹配 |
| 无 A2A 适配器成员的 RoomTask 分配失败 | 回退为权威房间任务，由原房间/收件箱投递 |
| 列表结果过大 | `A2ALocalTasks` 不含 history，700 KiB 预算并返回 `truncated/omitted`；`A2AInbox` 列表正文截断并标记 `textTruncated` |
| 原生 `<select>` 与过期提示 | 改用 `components/controls/Select`；接口选择后自动重检；工具描述、指南和网站同步 |
| 每次请求重建 HTTP Client、重复拉 Card/解密凭据 | 共享 `HttpClient`；Card 缓存 10 秒、外部连接解析缓存 5 秒，save/remove 自动失效 |

## 验证

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked` | 全部通过；lib 1029 passed、14 ignored |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked a2a` | 57 passed |
| `node --test --test-concurrency=1 scripts/plugin-tests/a2a-tools.case.mjs scripts/plugin-tests/a2a-local-tools.case.mjs scripts/plugin-tests/a2a-http.case.mjs` | 27 passed |
| `pnpm exec vitest run src/a2a` | 18 passed |
| `node --test --test-concurrency=1 src/components/lazy/testing/a2a-connections.case.mjs` | 6 passed |
| `pnpm check:i18n` | 3829 条/语言，0 legacy |
| `pnpm build`、`pnpm --dir website build` | 通过 |
| `cargo fmt --check`、`git diff --check` | 通过 |

## 保留边界

- 重启后发送方旧 `taskHandle` 不可复用；预览可恢复，业务任务/房间/收件箱仍为权威。要支持跨重启轮询需要新增发送方任务发现或持久化句柄绑定。
- 房间任务显式失败后业务任务保持 Active，仅记录失败备注/通知；由统筹归档或重开。
- 终态句柄不能续写，需要追问时新发消息。
- 本地自动适配仍限 MCP 注入的 Codex/Claude PTY。
- 首期不含 SSE、push、OAuth/OIDC/mTLS、Card 签名和跨机器公开本地 Gateway。
