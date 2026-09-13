# CLI-Manager 借鉴功能实施记录

执行来源：[16 项功能与验收标准](cli-manager-feature-backlog.md)。
用户要求继续完成全部待办，逐项验收后同步“小清新待办”，关闭重开回读。
本文记录当前状态；较早回合的测试总数与 QA PID 不再作为当前结果。

## 当前状态（2026-09-13）

16 项均已有实现。小清新待办已勾选并关闭重开回读的为 7 项：CM-02、03、04、09、10、14、15；剩余 9 项。
全部 16 项已同步文字进度、验收摘要或具体剩余步骤和实施记录入口；未完成项标为“已实现·待验收”，CM-06 已改为“已实现·待 Windows 验证”。
代码、自动测试、桌面验收和待办同步分别记录，不把其中一项替代其余步骤。

| 编号 | 状态 | 当前证据与剩余工作 |
| --- | --- | --- |
| CM-01 | 待桌面收尾 | Hook、通知及真实 CLI 自动验证通过；两家 CLI 的 UI 移除/重装均保留原 Hook；待 Codex 信任审阅及并行状态界面验收 |
| CM-02 | 已完成 | 全文检索、筛选、收藏和标签；重启保留及待办重开回读通过 |
| CM-03 | 已完成 | 暂存/未暂存 Diff、中文路径、二进制和大文件；只读证据、桌面与待办回读通过 |
| CM-04 | 已完成 | 项目 Provider 隔离；真实 CLI 路由、桌面保存/重启/取消覆盖和待办回读通过 |
| CM-05 | 待桌面收尾 | 当前会话增量统计、真实 Codex/Claude 日志和原文件不变已验证；待身份切换、并行与续写界面验收 |
| CM-06 | 待 Windows 验证 | 自动验证与 macOS GUI 保留任务退出重开通过：原 UI 真实退出、worker PID 不变、计数继续、只启动一次、显式结束回收；Windows 缺少 SDK/实机 |
| CM-07 | 待桌面验收 | Worktree 创建、所有权和任务入口已实现；临时真实仓库与后台占用整合测试通过 |
| CM-08 | 待桌面验收 | 提交审查、干净目标合并、冲突保留和安全清理已实现；临时真实仓库验证通过 |
| CM-09 | 已完成 | 多次 patch/MultiEdit、内容不足提示、分页和消息定位已验证；最新 320px 面板分页栏及第二次改动定位复验通过，日志 SHA256 不变，待办已勾选并重开回读 |
| CM-10 | 已完成 | 趋势下钻、费用口径和价格重启保留通过；待办已勾选并回读 |
| CM-11 | 待重启验收 | 主机/分组和特殊字符目录保存回读、连接失败、真实请求取消、亮暗主题及 772×632 底栏复验通过；待真正重启后回读，当前无明确别名可做桌面导入 |
| CM-12 | 待桌面收尾 | 命名工作区、布局和目录修复已实现；切组 PID 不变已验证，待重启布局/焦点及运行会话迁移 |
| CM-13 | 待桌面验收 | 白名单备份、选择域、启动恢复、失败回滚与撤回已实现并自动验证；待导出和重启操作验收 |
| CM-14 | 已完成 | 收藏/分组、Shell、启动一次、环境变量、目录移动修复及亮暗/窄窗均已桌面验收；待办已勾选并关闭重开回读 |
| CM-15 | 已完成 | 冲突拦截、即时生效、提示同步、重启保留和恢复默认通过；待办已勾选并回读 |
| CM-16 | 待桌面收尾 | 安装、项目/全局隔离、中文空格路径变量及编辑预览后真实复制均通过；待暗色主题、重启保留和停用验收 |

## 本轮整合

### CM-06 后台终端

代码位于 `src-tauri/src/terminal/daemon/` 和 `src/terminal/daemon/`。

- 使用受信应用二进制的独立 daemon 入口，原生 PTY/ConPTY 由后台持有；每应用独立目录、活体排他锁、私有端点及版本/凭据校验。
- 每会话 2 MiB 有界缓存，128 KiB 分页，单调游标；缓存裁剪产生可见缺口，恢复时对齐输出序号。
- 保存 PTY 身份；恢复只 attach 原任务。后台任务不存在时提示显式重启；重连不重复发送项目启动命令。
- 退出提供保留任务、结束任务和取消；后台任务列表收在设置内，支持结束和清除。
- Hook 接收与 Provider 私有快照跟随后台生命周期。插件与协作经本机代理重新绑定 UI，原 Agent 使用的后台凭据保持稳定。
- Worktree 执行持后台租约；未 attach 的任务也计入目录占用，后台查询失败时阻止清理。
- 关闭 tab 取消迟到创建并释放插件票据；插件替换在创建锁内绑定；重启、修改 SSH 目标和路径修复先结束原后台任务。
- 退出弹窗已改为现有模态层及自绘按钮；监听注册后再查询待退出请求，防止窗口关闭事件早于前端挂载。

最终复测发现并修复两类竞态：

1. 连接断开或输出序号错误先于 create 返回时，迟到结果曾把界面改回运行并执行启动命令。
   6 项前端生命周期测试中先复现 2 项失败；修复后保留错误及身份，仅 detach，不执行命令。
2. macOS 接收连接会继承监听器的非阻塞标志。大响应曾只读到 327208 / 480898 字节，daemon 仍存活。
   分段请求测试已复现提前拒绝；IPC、插件、协作和 Hook 接收连接统一切回带超时的阻塞模式。

### CM-07 / CM-08 Worktree

代码位于 `src/git/worktrees/`、`src-tauri/src/git/worktrees/`。
入口收在 Git 面板内；创建、提交、合并和清理均先预览，再核对一次性票据及 Git 状态。
仅管理登记的工作树；目标不干净、未合并、忽略文件和运行中会话均阻止相应操作。
冲突保留成果；清理使用非强制 Git remove 并保留分支。8 项真实临时仓库测试、2 项前端测试及后台创建租约测试通过。

### CM-13 本地备份

代码位于 `src/backup/`、`src-tauri/src/backup.rs`。
首期只导出工作区/布局和外观白名单；排除凭据、Provider、启动脚本、环境变量、终端输出、插件数据与资源文件。
导入预览选域，下次启动先保存快照，逐项写后回读；失败回滚，可撤回最近一次恢复。
9 项备份、2 项设置和 2 项 Rust 测试已纳入全量验证。

### CM-16 可选插件

目录：`examples/plugins/command-library/`。
全局与项目模板按宿主上下文隔离；变量预览可编辑，显式复制，不自动投递或执行。
3 项模型/存储测试及 1 项真实 Node PI 宿主集成通过。面板控件自绘，变量区按需展开。
安装包：`examples/plugins/command-library/dist/belfry.command-library-0.1.0.piplug`。
SHA256：`e896282989780f87ec484db17c8c05cad46db6d4dac5de81e5cdd7bc6d3a409c`。
证据：`/tmp/belfry-cm16-runtime2.log`、`/tmp/belfry-cm16-check2.log`、`/tmp/belfry-cm16-pack2.log`。

## 验证证据

- 前端：最新全量 133 文件、759 项通过；TypeScript 工程检查通过。
  日志 `/tmp/belfry-remaining-frontend-final.log`、`/tmp/belfry-cm06-types-lifecycle.log`。
- Rust：最终全量 510 通过、8 忽略；日志 `/tmp/belfry-remaining-rust-final.log`。
- 生命周期 TDD：`/tmp/belfry-cm06-lifecycle-red.log` → `/tmp/belfry-cm06-lifecycle-green.log`。
- 分段传输失败基线：`/tmp/belfry-cm06-fragmented-red.log`；
  大输出断开诊断：`/tmp/belfry-cm06-cross-process-diagnostic.log`。修复后分段请求测试及完整回归通过。
- SSE 已验证首条事件在连接关闭前送达、UI 重新绑定后原后台凭据继续可用：
  `/tmp/belfry-cm06-sse.log`。
- 真实 Claude/Codex 经 daemon 启动与完整回放通过：
  `/tmp/belfry-cm06-real-agents-final.log`。模型只访问本机模拟服务；Claude 身份一致，Codex 未审阅 Hook 不执行。
- 最终跨进程验证通过：启动父进程和客户端真实退出，worker PID 35368 不变、计数 3→8；
  4 MB 输出触发缓存缺口并正确对齐，显式关闭后 daemon 与 worker 均退出。
  日志 `/tmp/belfry-cm06-cross-process-final.log`。这不是 GUI 退出重开的桌面证据。
- 最新独立 QA 构建通过并已启动：`/tmp/belfry-remaining-qa-final-build.log`。
  此前因磁盘不足失败，清理本项目可重新生成的旧 Rust 增量缓存后恢复构建。
- Windows 交叉检查失败于 ring 的 C 编译，缺少 `assert.h` / Windows SDK：
  `/tmp/belfry-cm06-windows-check.log`。Windows 构建与实机结果保持未验证。
- 新 daemon 模块文件均不超过 300 行，验证脚本函数不超过 50 行；差异空白检查通过。
  已完成同会话差异审查，不冒充独立代理审查。

## 桌面验收与待办接续

待办同步已完成，后续验收期间桌面连接再次中断：

- 此前 CUA 捕获报 `SCStreamErrorDomain -3811`；按 bundle ID 连接还出现重复标识。改用完整路径 `cua.getApp('/Applications/Belfry.app')` 后成功连接正式应用。
- 插件 MCP 仍报 `SESSION_MISMATCH`；本轮通过正式应用原生界面保存全部 16 项，没有直接读写应用或插件私有存档。
- CM-14 已成功勾选。使用插件自己的“关闭”按钮关闭面板，再经启动器重新打开，确认显示“剩余 10 项 · 共 16 项”。
- 重新打开后分别回读“已完成”和“进行中”：6 项完成标记及全部 16 项文字进度均保留；面板留在“进行中”，便于查看后续验收。
- 随后完成 CM-09 最新桌面复验并立即同步；再次关闭重开后，已完成筛选含 CM-09，计数为“剩余 9 项 · 共 16 项”。
- CM-06 的待办文字已改为“已实现·待 Windows 验证”，即时保存回读成功；新的文字尚未再次关闭重开核对。
- 启动 QA Codex 会话后，QA 与正式 Belfry 均再次返回 `cgWindowNotFound`；按完整路径重连仍失败，两个进程保持运行。插件 MCP 复查仍为 `SESSION_MISMATCH`。
- 已询问 Mac 当前是否解锁并保持可见桌面。CM-01/11/16 的下述新增验收记录先保存在本文，待桌面恢复后补入对应待办详情；未勾选这些条目。

本轮新增桌面证据：

- CM-01：在 QA 设置中分别预览、移除并重新启用 Codex/Claude Hook。移除后 JSON 中只剩原 `SessionEnd` 的 `true` 命令；Codex 重新启用后共 11 条命令且保留 `true`。未改写信任记录，Codex 自身 `/hooks` 审阅尚未完成。
- CM-11：保存“QA 本地主机”到“验收专用”分组，目标 `127.0.0.1:1`，目录 `/home/用户/space path/it's`；关闭弹窗重开选择后各字段保持原值。
  诊断显示明确的 Connection refused；受控本机临时监听器下点击“取消请求”，UI 显示“请求已取消”，TCP 对端在 0.68 秒收到 EOF，测试监听器已结束。
  亮暗主题与 772×632 窄窗口底栏均可用。SSH 配置只读导入显示“没有可导入的明确别名”及未导入提示，没有连接真实远端。
- CM-16：通过系统文件窗口安装 `.piplug`，仅授予面板和写剪贴板权限。项目 A 保存专属条目及全局条目；项目 B“命令 空间”只显示全局条目。
  POSIX 变量保留中文/空格并加引用；修改预览、点击复制，再清空预览后使用系统粘贴，回读内容与编辑预览完全一致。仅在独立 QA 安装，正式应用插件列表未改。

继续逐项执行，完成一项即勾选并关闭重开回读：

1. CM-06：macOS GUI 保留任务退出重开、原 PID/计数/输出、只启动一次及显式结束已通过；Windows 构建和实机仍待验证。
2. CM-01 / CM-05：通过 Codex 自身界面审阅；核对并行状态、来源、当前会话统计与续写。UI 移除/重装保留原 `SessionEnd: true` 已通过。
3. CM-07 / CM-08：专用临时 Git 仓库创建→打开任务→审查提交→合并→清理；核对后台占用拦截。
4. CM-13：系统文件窗口导出；选域恢复、真正重启、未选域不变、再撤回。
5. CM-11：真正重启后回读已保存主机/分组和特殊字符目录；如有可用测试别名，补充桌面选择。保存/失败/取消/亮暗及窄窗口已通过。
6. CM-16：暗色主题、重启保存及停用后核心工作台；安装、真实复制和跨项目隔离已通过。
7. CM-09：最新分页栏布局、第二次改动跳转消息和原日志 SHA256 不变均已通过，待办已勾选并重开回读。
8. CM-12：Feature QA 原三窗格 38%/63% 比例、重启焦点、失效目录修复与运行会话迁移。
9. CM-14：桌面证据、待办勾选与关闭重开回读均已完成。
10. 回读全部 16 项的最终完成状态。

## 已完成项目的关键证据

- CM-02：正文/命令/路径搜索、组合筛选、收藏与标签重启保留；待办“已完成”回读。
- CM-03：浏览前后临时仓库索引、HEAD 和内容一致，`/tmp/belfry-cm03-ui-evidence.json`。
- CM-04：Codex/Claude 覆盖保存、重启及取消通过；全局配置 SHA256 不变，
  `/tmp/belfry-cm04-global-after.json`。
- CM-10：93,600 Token 总量；日期下钻 14,400 / 13,200，与项目合计一致。
  QA 四类费率 2 / 0.5 / 1 / 4 USD 每百万 Token，费用 0.0318 USD；其余 79.2k 明确未计价。
  价格、来源、费用和快捷入口重启保留，待办已回读。
- CM-15：重复快捷键拦截；⌘+Shift+Y 即时打开用量，提示同步、重启保留，再通过 UI 恢复 ⌘+U；待办已回读。
- CM-14 桌面证据见[项目收藏计划](superpowers/plans/2026-09-13-project-library.md)；待办勾选及关闭重开回读通过。

## 执行环境与约束

- 当前分支 `feat/multi-agent-collab`；用户已要求先提交当前代码，本次本地提交包含现有功能、界面、测试、文档及 Windows 安装修复。剩余 9 项验收继续按待办推进。
- 未请求推送或改写已有 Git 历史；桌面 Worktree 验收继续仅作用专用临时仓库。
- 正式 Belfry PID 4241 托管当前会话，不能退出；开发实例保持运行。只重启本任务的独立 QA，并核对完整执行路径。
- Controls QA 包：`src-tauri/target/debug/bundle/macos/Belfry Controls QA.app`。
  GUI 保活验收后当前 PID 66137（原 36385 已真实退出），exec session 89025，日志 `/tmp/belfry-remaining-qa-final-running.log`。
  已核对完整路径并结束本任务旧 UI 75113 与旧 daemon 75217，最新后台代码已可用。
- QA CLI 配置根：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-cm01-desktop-4chehzyf`。
- CM-12 原三窗格在 Feature QA，不在 Controls QA；临时路径清单 `/tmp/belfry-cm12-paths.json`。
- 本轮额外验收目录见 `/tmp/belfry-desktop-remaining-paths.json`：中文空格项目已用于插件隔离；`worktree-project` 是仅含初始化提交的专用临时仓库，尚未执行桌面 Worktree 操作。
- 当前 Controls QA 停在新建的 Codex 01 启动界面，所在项目为上述“命令 空间”；未发送模型提示或审阅 Hook 信任。SSH 测试监听器 session 91249 已结束。
- daemon 会跨 UI 退出存活，重启 UI 不保证换用最新后台代码；只结束经核对属于本任务 QA 的旧后台。
- QA helper 新增 `--desktop-restarts`，退出重开时共用模拟模型服务，避免测试端口变化导致原 Agent 断线。
  当前以 `--desktop-restarts 1` 运行；自动重开已用于后台保留任务验收，后续再次退出将结束 helper。
- 继续沿用 `frontend-design`：常驻界面精简，管理详情按需展开，应用内控件自绘，系统文件窗口保留。
- 用户指定的子代理模型当前不可用，因此串行整合与自审。指定 Superpowers 技能此前检索未找到，保留可见短计划、定向回归与完成前验证。

## 提交前检查（2026-09-13）

- 当前代码重新执行 `pnpm test`：133 文件、759 项通过。
- `pnpm build`：TypeScript 工程检查与生产构建通过，保留既有的大体积 bundle 提示。
- `cargo test --lib`：510 项通过、8 项忽略。
- `node --test scripts/test-command-library.mjs`：3 项通过；真实 PI 宿主集成及桌面复制证据见前文。
- 本轮核对终端生命周期、应用退出/恢复、工作区持久化和 Windows 安装差异；暂存区空白检查通过。
- 本机没有 `pwsh`，Windows 安装脚本回归未重跑；Windows SDK/实机验证仍未完成。
- 日志：`/tmp/belfry-precommit-frontend.log`、`/tmp/belfry-precommit-build.log`、`/tmp/belfry-precommit-rust.log`、`/tmp/belfry-precommit-command-library.log`。

## 执行计划入口

[剩余待办](superpowers/plans/2026-09-13-remaining-todos.md) ·
[后台终端](superpowers/plans/2026-09-13-terminal-daemon.md) ·
[Worktree](superpowers/plans/2026-09-13-worktree-workflow.md) ·
[备份](superpowers/plans/2026-09-13-local-backup.md) ·
[SSH](superpowers/plans/2026-09-13-ssh-hosts.md) ·
[命令插件](superpowers/plans/2026-09-13-command-library.md)
