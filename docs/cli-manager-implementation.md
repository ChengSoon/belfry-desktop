# CLI-Manager 借鉴功能实施记录

执行来源：[16 项功能与验收标准](cli-manager-feature-backlog.md)。
用户要求继续完成全部待办，逐项验收后同步“小清新待办”，关闭重开回读。
本文记录当前状态；较早回合的测试总数与 QA PID 不再作为当前结果。

## 当前状态（2026-09-14）

16 项均已有实现。小清新待办已勾选并关闭重开回读的为 10 项：CM-02、03、04、09、10、11、12、14、15、16；剩余 6 项。
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
| CM-07 | 桌面验收中 | UI 已创建任务 A、拦截重复名称和非法分支；修复非法分支只显示空白通用错误，9 项 Worktree 回归通过；待两任务隔离与文件/Git 面板验收 |
| CM-08 | 待桌面验收 | 提交审查、干净目标合并、冲突保留和安全清理已实现；临时真实仓库验证通过 |
| CM-09 | 已完成 | 多次 patch/MultiEdit、内容不足提示、分页和消息定位已验证；最新 320px 面板分页栏及第二次改动定位复验通过，日志 SHA256 不变，待办已勾选并重开回读 |
| CM-10 | 已完成 | 趋势下钻、费用口径和价格重启保留通过；待办已勾选并回读 |
| CM-11 | 已完成 | 主机/分组和特殊字符目录在新进程中回读通过；连接失败、真实取消、亮暗及 772×632 底栏通过，待办已勾选并重开回读；别名/跳板参数由自动测试覆盖 |
| CM-12 | 已完成 | 最新 QA 三窗格 38%/63% 与输入焦点真实重启复验通过；运行迁移 PID 不变、失效目录修复通过；正式待办已勾选并关闭重开回读 |
| CM-13 | 已验收·待勾选 | 外观选域恢复/撤回、新配置迁入 2 工作区/5 会话及未选域严格比较均通过；损坏/新版本包提示通过，正式待办详情已保存，截图故障使勾选暂未成功 |
| CM-14 | 已完成 | 收藏/分组、Shell、启动一次、环境变量、目录移动修复及亮暗/窄窗均已桌面验收；待办已勾选并关闭重开回读 |
| CM-15 | 已完成 | 冲突拦截、即时生效、提示同步、重启保留和恢复默认通过；待办已勾选并回读 |
| CM-16 | 已完成 | 安装、项目/全局隔离、中文空格路径变量、编辑后真实复制、暗色面板及重启保留通过；关闭后启动器移除且 Shell 正常，待办已勾选并重开回读 |

## 本轮整合

### CM-12 重启后的输入焦点

2026-09-14 在最新 Controls QA 重新建立三窗格基线。退出重开后布局和比例保留，但键盘输入落到最后完成连接的左侧终端，原活动窗格仍为右上。
根因为 `mountTerminal` 在每个异步连接完成时无条件调用 `focus()`。
修复后由当前可见活动窗格在挂载、选择变化时恢复焦点，后台连接不再抢焦点；没有修改持久化格式。

- 新增回归先复现 2 项失败，再通过 84 项定向回归；前端全量 134 文件、763 项通过。
- 最新 QA 构建成功；重开后没有点击任何窗格，直接输入 `CM12_FIXED_AFTER`，正确出现在原右上窗格。左右 38%、右侧上下 63% 均保留。
- 运行会话移到默认工作区后 bash PID 59667、sleep PID 82139 均未改变。
- 专用目录从“原项目”移动到“修复后项目”，原会话重启明确报 NOT_FOUND；使用系统文件窗口修复后，同一 Shell 05 恢复运行，`pwd` 与 `cat qa.txt` 回读新目录和 `CM12_REPAIR_OK`。
- 日志：`/tmp/belfry-cm12-focus-red.log`、`/tmp/belfry-cm12-focus-green.log`、`/tmp/belfry-cm12-focus-frontend.log`、`/tmp/belfry-cm12-focus-qa-build.log`。
- 已同会话审查焦点归属、后台连接与搜索框处理，差异空白检查通过。修复在提交 `32fd65b` 之后，纳入本轮 UI 与交互修复提交。
- 正式待办 CM-12 验收详情已更新；截图恢复后完成勾选，关闭插件窗口、重新打开“已完成”回读 CM-12，计数为“剩余 6 项 · 共 16 项”。

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

2026-09-14 桌面从专用临时仓库创建“CM07 任务 A”，分支 `belfry/cm07-ui-a`，重复名称被拦截。
`bad..branch` 被 Git 拒绝，但 `check-ref-format` 不输出 stderr，UI 只显示“Git 操作失败：”。
新增回归复现后，将 Git 无效引用退出码映射为“分支名称无效，请修改后重试”，保留其他 Git 执行错误；9 项 Worktree 测试通过。
日志：`/tmp/belfry-cm07-branch-red.log`、`/tmp/belfry-cm07-branch-green.log`；最新 QA 构建通过，日志 `/tmp/belfry-cm07-branch-qa-build.log`。
已自审错误码映射、Git 执行错误保留与无工作树写入的断言；差异空白检查通过。当前 UI 仍是重建前的进程，提示修复尚待桌面回读。
任务 B 尚未创建，桌面表单停在非法分支验收后；连接随后报 `cgWindowNotFound`，未将未执行步骤标为通过。

### CM-13 本地备份

代码位于 `src/backup/`、`src-tauri/src/backup.rs`。
首期只导出工作区/布局和外观白名单；排除凭据、Provider、启动脚本、环境变量、终端输出、插件数据与资源文件。
导入预览选域，下次启动先保存快照，逐项写后回读；失败回滚，可撤回最近一次恢复。
9 项备份、2 项设置和 2 项 Rust 测试已纳入全量验证。

桌面导出与真实启动发现：恢复后存储已是深色，但 React 优先读取首帧脚本的旧 `data-theme`，界面仍为浅色。
`ThemeProvider` 改为读取恢复后的存档或系统偏好；恢复、撤回及跟随系统回归先复现 2 项失败，再通过 24 项定向测试。
全量前端 135 文件、765 项及 Controls QA 构建通过。新 QA 首次启动执行已安排撤回，界面为浅色，备份页显示“已撤回最近一次恢复”。
系统导出新基线 `before-fixed-restore.json`，最近项目已稳定为 3 条，再执行完整复验：

- 仅恢复外观，真实退出重开，主题立即从浅色变深色；`after-fixed-restore.json` 的完整工作区域与基线一致，外观与所选备份一致。
- 安排撤回、退出重开，主题变回浅色；`after-fixed-undo.json` 的全部数据域与恢复前完全一致。
- 独立 `Belfry Backup QA`（`io.appmakes.belfry.backup-qa`）从全新配置导出 `fresh-before.json`，仅恢复工作区。
  真实退出重开后，`fresh-after.json` 与来源的完整工作区域一致，未选外观与新实例初始值一致；UI 回读 2 个命名工作区、5 条会话和 38% 分屏。
- 损坏包显示“备份不是有效 JSON 文件”；新版本包显示“备份格式或版本不支持”，均未安排恢复。
- 正式 CM-13 验收详情已保存并回读。勾选前截图变为空白，继而报 ScreenCaptureKit -3811 / `cgWindowNotFound`，尚未计为正式完成。

测试导出目录：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-cm13-ui-h1eakp2h`。
日志：`/tmp/belfry-cm13-theme-red.log`、`/tmp/belfry-cm13-theme-green.log`、`/tmp/belfry-cm13-theme-frontend.log`、`/tmp/belfry-cm13-theme-qa-build.log`。

### CM-16 可选插件

目录：`examples/plugins/command-library/`。
全局与项目模板按宿主上下文隔离；变量预览可编辑，显式复制，不自动投递或执行。
3 项模型/存储测试及 1 项真实 Node PI 宿主集成通过。面板控件自绘，变量区按需展开。
安装包：`examples/plugins/command-library/dist/belfry.command-library-0.1.0.piplug`。
SHA256：`e896282989780f87ec484db17c8c05cad46db6d4dac5de81e5cdd7bc6d3a409c`。
证据：`/tmp/belfry-cm16-runtime2.log`、`/tmp/belfry-cm16-check2.log`、`/tmp/belfry-cm16-pack2.log`。

## 验证证据

- 前端：最新全量 135 文件、765 项通过；TypeScript 工程检查与最新 QA 构建通过。
  日志 `/tmp/belfry-cm13-theme-frontend.log`、`/tmp/belfry-cm13-theme-qa-build.log`。
- Rust：本轮 9 项 Worktree 回归通过，日志 `/tmp/belfry-cm07-branch-green.log`；此前全量 510 通过、8 忽略，日志 `/tmp/belfry-remaining-rust-final.log`。
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

桌面连接已恢复，正式待办最新计数为“剩余 6 项 · 共 16 项”：

- 此前 CUA 捕获报 `SCStreamErrorDomain -3811`；按 bundle ID 连接还出现重复标识。改用完整路径 `cua.getApp('/Applications/Belfry.app')` 后成功连接正式应用。
- 插件 MCP 仍报 `SESSION_MISMATCH`；本轮通过正式应用原生界面保存全部 16 项，没有直接读写应用或插件私有存档。
- CM-14、CM-09 的勾选及关闭重开回读已完成。
- CM-06 的“已实现·待 Windows 验证”文字已保存并关闭重开核对；CM-01 新增 UI Hook 记录已同步。
- CM-11 在新进程中回读主机/分组及特殊字符目录后已勾选并关闭重开回读。
- CM-16 通过暗色、重启保留和停用验收后已更新详情并勾选；2026-09-14 关闭重开，已完成筛选包含 CM-11/16，计数为“剩余 7 项 · 共 16 项”。
- CM-12 桌面验收完成，截图恢复后正式待办已勾选并关闭重开回读。
- CM-13 桌面验收完成、详情已保存。待办截图再次故障，完成勾选尚未执行；正式计数仍为“剩余 6 项”。

本轮新增桌面证据：

- CM-01：在 QA 设置中分别预览、移除并重新启用 Codex/Claude Hook。移除后 JSON 中只剩原 `SessionEnd` 的 `true` 命令；Codex 重新启用后共 11 条命令且保留 `true`。未改写信任记录，Codex 自身 `/hooks` 审阅尚未完成。
- CM-11：保存“QA 本地主机”到“验收专用”分组，目标 `127.0.0.1:1`，目录 `/home/用户/space path/it's`；关闭弹窗重开选择后各字段保持原值。
  诊断显示明确的 Connection refused；受控本机临时监听器下点击“取消请求”，UI 显示“请求已取消”，TCP 对端在 0.68 秒收到 EOF，测试监听器已结束。
  亮暗主题与 772×632 窄窗口底栏均可用。SSH 配置只读导入显示“没有可导入的明确别名”及未导入提示，没有连接真实远端。
  Controls QA 新进程 PID 29100 中主机/分组、user `qa`、port `1` 和特殊字符目录均原样保留。
- CM-16：通过系统文件窗口安装 `.piplug`，仅授予面板和写剪贴板权限。项目 A 保存专属条目及全局条目；项目 B“命令 空间”只显示全局条目。
  POSIX 变量保留中文/空格并加引用；修改预览、点击复制，再清空预览后使用系统粘贴，回读内容与编辑预览完全一致。仅在独立 QA 安装，正式应用插件列表未改。
  新进程中原项目的“QA 全局收藏”和“QA 项目专用”均保留，专属正文仍为 `printf '%s\n' {{project.path.posix}}` 及 `# QA 复制验收`；暗色面板正常。
  插件生效范围选择“关闭”后显示已关闭、面板按钮禁用、启动器不再提供该插件；Shell 经系统粘贴执行固定命令，正常输出 `CM16_DISABLE_OK`。

继续逐项执行，完成一项即勾选并关闭重开回读：

1. CM-06：macOS GUI 保留任务退出重开、原 PID/计数/输出、只启动一次及显式结束已通过；Windows 构建和实机仍待验证。
2. CM-01 / CM-05：通过 Codex 自身界面审阅；核对并行状态、来源、当前会话统计与续写。UI 移除/重装保留原 `SessionEnd: true` 已通过。
3. CM-07 / CM-08：专用临时 Git 仓库创建→打开任务→审查提交→合并→清理；核对后台占用拦截。
4. CM-13：桌面导出、选域恢复、重启、未选域不变、撤回及全新配置导入均通过；截图恢复后完成勾选并重开回读。
5. CM-11：桌面验收及待办同步已完成；别名/跳板参数由自动测试覆盖。
6. CM-16：桌面验收及待办同步已完成。
7. CM-09：最新分页栏布局、第二次改动跳转消息和原日志 SHA256 不变均已通过，待办已勾选并重开回读。
8. CM-12：新版 Controls QA 的三窗格、焦点、目录修复和运行迁移均已验收；已勾选并关闭重开回读。
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

- 当前分支 `feat/multi-agent-collab`；上一轮本地提交为 `32fd65b`，`feat(workbench): 扩展会话工作流并精简界面`，包含现有功能、界面、测试、文档及 Windows 安装修复。剩余 6 项验收继续按待办推进，后续焦点、主题、设置布局、插件窗控和 Worktree 提示修复及文档纳入本轮本地提交。
- 未请求推送或改写已有 Git 历史；桌面 Worktree 验收继续仅作用专用临时仓库。
- 正式 Belfry PID 4241 托管当前会话，不能退出；开发实例保持运行。只重启本任务的独立 QA，并核对完整执行路径。
- Controls QA 包：`src-tauri/target/debug/bundle/macos/Belfry Controls QA.app`。
  当前旧 UI PID 54225，后台 PID 45642；主题修复 QA 已验收，Worktree 错误提示修复已构建，需重启本任务 QA 后桌面回读。当前由 CUA 普通启动，没有模拟模型 helper 环境。
  不在当前实例直接启动真实模型请求；CM-01/05 验收前需恢复本任务专用 fixture helper。
- QA CLI 配置根：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-cm01-desktop-4chehzyf`。
- Feature QA 是较早构建，未将其不完整现场当作最新验收依据，本轮启动后已通过 UI 退出。新版 CM-12 在 Controls QA 重建基线；目录修复路径清单 `/tmp/belfry-cm12-repair-latest.json`。
- 本轮额外验收目录见 `/tmp/belfry-desktop-remaining-paths.json`：中文空格项目已用于插件隔离；`worktree-project` 是专用临时仓库，已通过 UI 创建任务 A，主分支未修改。
- 当前 Controls QA 仅有本任务 Shell，分布在“CM-13 保留工作区”与“CM-12 分屏验收”；当前 Shell 06 位于 `worktree-project`。命令插件已关闭，SSH 测试监听器已结束。
- 备份独立 QA UI PID 63772、daemon PID 56832；仅用于验证新配置导入，未操作正式配置。
- CUA 重置控制器后，正式应用与 Controls QA 仍返回 `cgWindowNotFound`，截图此前报 ScreenCaptureKit -3811；需要桌面恢复可访问后继续。没有终止正式应用或读写插件私有存档。
- daemon 会跨 UI 退出存活，重启 UI 不保证换用最新后台代码；只结束经核对属于本任务 QA 的旧后台。
- QA helper 新增 `--desktop-restarts`，退出重开时共用模拟模型服务，避免测试端口变化导致原 Agent 断线。
  旧 helper 已结束；后续可用 `--desktop-root` 指向已有 fixture，并用 `--desktop-restarts` 保持模拟服务跨 UI 重启。
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

## 设置界面收尾（2026-09-14）

- 按用户最新要求，撤销正文 `clamp(680px, 60vw, 1400px)` 限制，八个设置分区填满导航右侧可用宽度。常规窗口保留 24px 横向边距，800px 以下缩为 16px；固定滚动条占位，避免切换长短页面时右边界跳动。
- 外观、全局/项目 Provider、会话状态、快捷键、本地备份、协作环境、插件均使用统一页头。补齐全局 Provider 的标题，将新增与刷新操作放在页头；插件页标题与导航统一为“插件”。页头动作区可以换行，Provider 编辑表单和快捷键按正文容器宽度切为单列。
- 收紧快捷键分组间距，补充分组标题与展开控件的无障碍关联；编辑中的会话键位保持展开，取消后恢复折叠操作。
- 最新验证：`pnpm test` 共 136 文件、772 项通过；`pnpm build`（含 `tsc -b`）通过，保留已有的大体积 bundle 提示；`git diff --check` 通过。
- 浏览器布局验收：720×480 浅色、1440×900 深色、1920×900 深色，各 8 个分区均完整占用正文可用宽度、标题对齐且无横向溢出。Chrome 预留 15px 滚动条后，对应正文宽度为 497 / 1177 / 1657px，各分区一致。
- 交互验收：720×480、1000×900 及 1440px 窗口验证 Provider 新建/返回与草稿保护、九个会话快捷键展开/编辑/取消/收起、主题弹层关闭、插件模板弹窗底栏与 Escape、市场/详情打开关闭。未发生浏览器运行错误。
- 界面验收直接加载 `src/main.tsx`，使用独立 Chrome 与模拟桌面接口，未写入真实 Provider/插件配置。本轮未重跑原生 WebView 验收，功能待办的既有桌面与平台限制仍按原记录保留。
- 本机证据：`tmp/app-probe/final-light-720/`、`final-dark-1440/`、`final-dark-1920/`（截图与 `metrics.json`），以及 `tmp/app-probe/interactions-720/`、`interactions-1000/`、`interactions-1440/`（编辑/弹窗截图与结果）。

## 本地提交检查（2026-09-14）

- 按用户要求，在当前分支提交本轮累计的应用代码、测试与验收记录。
- 提交前重新运行 `pnpm test`：136 文件、772 项通过；`pnpm build` 通过，保留已有的 bundle 体积提示。
- Rust Worktree 定向 9 项通过；本轮插件面板与桥接 15 项、Rust 嵌入运行时 3 项已通过。
- Windows 原生窗口仍待实机复验，本轮未生成或发布 Windows 安装包。

## 执行计划入口

[剩余待办](superpowers/plans/2026-09-13-remaining-todos.md) ·
[后台终端](superpowers/plans/2026-09-13-terminal-daemon.md) ·
[Worktree](superpowers/plans/2026-09-13-worktree-workflow.md) ·
[备份](superpowers/plans/2026-09-13-local-backup.md) ·
[SSH](superpowers/plans/2026-09-13-ssh-hosts.md) ·
[命令插件](superpowers/plans/2026-09-13-command-library.md)
