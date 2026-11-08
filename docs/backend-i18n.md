# 后端与 CLI 国际化（T10）

2026-11-09。前端契约见 [i18n.md](i18n.md)，完整错误码和参数见 [backend-error-codes.json](backend-error-codes.json)。

## 语言与命令

`app_set_locale({ locale: "zh-CN" | "en" }) -> Promise<void>` 已注册。前端发送解析后的实际语言；后端以同目录临时文件、同步和原子替换保存到应用数据目录 `locale.json`，成功后才更新运行时语言。写入与运行时更新共用锁，避免迟到写入覆盖新选择。非法语言或写入失败保留原设置。

CLI 优先级为 `BELFRY_LANG` → 应用保存的实际语言 → 系统语言。`BELFRY_LOCALE_FILE` 可指定应用传给子进程的偏好文件；读取最多 4096 字节。系统语言以 `zh` 开头选择简体中文，其余选择英文。`--help` 无需处于 Belfry 会话中；其余协作操作仍须原有身份信息。

macOS 系统语言通过按需加载的 CoreFoundation 查询，显式语言或有效保存值不加载该框架。这样 CLI 先进入 `main` 启动截止时间计时，默认语言查询的耗时也计入 `wait --timeout`。IPC 使用非阻塞读写，每次暂不可读/写都重新检查绝对截止时间；兼容性探测和实际请求共用同一预算。中英文的 `wait --timeout 1` 都沿用 1.5 秒墙钟验收上限。macOS 回归测量前以一次 `--help` 排除刚链接程序的系统首次装载/校验；每次被测 `wait` 仍完整计入 spawn 至退出的耗时。系统在进入 `main` 之前的首次校验不受 CLI 的时钟控制。

`src-tauri/crates/belfry-i18n` 共享语言、词库和错误匹配；`belfry-i18n-macros` 的 `lformat!` 在编译期选择整句模板，再用 Rust 的格式检查插入原值。不能先格式化用户内容，再从成句中拆回参数以重新翻译。

## 错误契约

Rust 的已注册业务命令返回 `{ code, message, retryable, params? }`。`code` 是稳定大写标识，`params` 是具名字符串或数字，`message` 始终提供英文兜底，不随应用语言变化。已有可选 `details` 字段保持兼容。

| 示例 | code | params |
| --- | --- | --- |
| 房间名必填 | `ROOM_NAME_REQUIRED` | 无 |
| 角色名长度限制 | `ROOM_ROLE_NAME_LIMIT` | `max` |
| 原后台任务丢失 | `SESSION_MISSING` | 无 |
| 后台连接失败 | `TERMINAL_BACKGROUND_SERVICE_CONNECTION_FAILED` | `error` |

共享词库目前含 1111 条，导出目录含 1114 条（另含 `CONFLICT`、`SESSION_MISSING`、`PROCESS_EXITED`）。共享目录也包含 CLI、通知和原生 UI 文本，并非每一条都是失败类型。`fallbackOnly` 列出的通用类别保留服务端英文 `message`；前端不要用一个泛化译文覆盖它。

旧 Rust helper 的字符串在命令边界按已登记模板匹配成稳定码与参数，外链和用量统计也纳入该边界。不能匹配的英文保留原文；未映射的中文错误在脱敏日志中保留诊断线索，对前端给出英文诊断兜底。参数按字段名和内容脱敏，再生成英文兜底，避免密钥通过参数或兜底泄露。操作系统、第三方插件与用户输入提供的详情不属于应用模板。

`SESSION_MISSING`、`PROCESS_EXITED`、`CONFLICT` 继续承担原控制流语义。终端重连按明确的传输错误码判断，并保留旧 `IO_ERROR`/`TIMEOUT` 兼容；鉴权、项目、协议等失败不触发自动重建。机器判断读取原始诊断，不依赖前端翻译后的显示文本。

变更词库后执行：

```sh
node scripts/export-backend-i18n.mjs
node scripts/export-backend-i18n.mjs --check
node --test scripts/backend-i18n.test.mjs
```

前端通过现有 `scripts/sync-backend-i18n.mjs` 同步同一份目录；不变更已交接的错误码和参数名。

## 通知、安装器与 Agent 说明

应用生成的房间通知、任务注入、原生文件选择标题和过滤器名称、插件通知的默认标题以及现有原生菜单随实际语言生成或更新。用户内容、已保存历史、Agent 输出和插件自带文本保持原文。当前应用没有自定义托盘菜单。

`skills/belfry/SKILL.md` 与 `SKILL.en.md` 按语言安装；切换时更新应用拥有的副本。协作 CLI 接受原有中文收件人和 `@all`、`@members`、`@coordinator`、`@user` 英文别名；内部收件人协议保持稳定。Hook 配置识别两种语言的所有权标记，切换或卸载时不会遗留重复副本。

NSIS 配置包含 `English` 与 `SimpChinese`，启用语言选择器；自定义安装提示使用两套 `LangString`。系统文件选择器的“打开/取消”等 OS 自带按钮仍遵循操作系统语言（当前 Tauri 文件选择 API 不提供这些按钮的文字设置）。Windows 安装器的实际运行由 Windows CI 验证，本机 macOS 不具备 `makensis`。

## 回归证据

以下用例都在对应修复之前运行并确认失败，修复后的验证结果见任务交付记录：

| 用例 | 修复前的稳定失败 |
| --- | --- |
| `regression_user_errors_expose_stable_codes_and_parameters_with_an_english_fallback` | 泛化错误码、中文 message，没有具名参数 |
| `regression_english_help_works_without_an_application_session` | 会话外的英文 help 不能成功 |
| `regression_cli_translates_status_but_preserves_user_results` | 英文 CLI 仍展示中文状态 |
| `regression_room_notices_and_recipient_aliases_follow_the_app_language` | 英文房间入场/系统提示仍为中文 |
| `regression_installed_collaboration_skill_switches_language` | 英文模式安装的说明仍为中文 |
| `regression_delimiters_inside_user_parameters_are_never_reparsed` | 带模板分隔符的用户房间名被拆坏 |
| `regression_hook_language_switch_keeps_one_owned_copy_and_removes_both_locales` | 语言切换后保留旧 Hook 提示或重复副本 |
| `regression_external_failures_have_stable_codes_and_english_fallbacks` | 外链失败仍序列化成字符串 |
| `regression_analytics_command_errors_use_the_shared_wire_contract` | 用量命令失败仍序列化成字符串 |
| `sessionRecovery.test.ts` 的稳定传输码回归 | 新错误码被判成不可重连 |
| `regression_cli_does_not_load_locale_frameworks_before_its_deadline_clock_starts` | CLI 无条件提前链接 CoreFoundation |
| `regression_a_temporarily_unready_socket_waits_for_the_reply_within_its_deadline` | 临时 `WouldBlock` 被误报为请求失败 |
| `backend-i18n.test.mjs` 的安装语言回归 | 旧 NSIS 配置没有两种语言，自定义提示未本地化 |

全量测试还暴露了短事务文件锁的继承问题：Unix `fork`/`dup` 共享 open file description，单独关闭父描述符不会解除子进程仍持有的 `flock`。`FileLock::drop` 现在显式解锁；`regression_dropping_a_lock_releases_it_while_an_inherited_descriptor_is_open` 在旧实现稳定失败，同时验证活跃守卫仍排斥其他写入者。Windows 保持原独占打开语义。

最终验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --offline --workspace --locked`：876 项通过、14 项按原设置忽略。其中桌面库 809 项、CLI 49 项；日志 `/tmp/belfry-t10-workspace-final.log`。
- 终端恢复/生命周期/会话定向 Vitest：54 项通过；`pnpm exec tsc -b` 通过。
- 导出目录 `--check` 与 `backend-i18n.test.mjs`：2 项通过；`git diff --check` 通过。
- 无显式/保存语言时，真实 CLI 经按需 CoreFoundation 查询在本机输出中文系统语言 help。

修复前日志均为 `/tmp/belfry-t10-before-*.log`，包括 notices-skill、parameters、hook、external、analytics、connection-codes、file-lock、nonblocking、locale-framework、installer；这些临时日志用于本次验收，长期回归以仓库内测试为准。

前端联调补充：历史扫描说明改成达到上限/未达上限两条整句，保留 `HISTORY_SCAN_LIMIT_REACHED` 与 `HISTORY_THE_LOG_SCAN_MAY_BE_INCOMPLETE_UNREADABLE`；两条参数都只有 `count`，不再拼接 `limit` 后缀。新增目录契约回归在旧模板失败（`/tmp/belfry-t10-before-scan-notice.log`），修后目录 3 项、history details 22 项通过（1 项原有手动用例忽略）。
