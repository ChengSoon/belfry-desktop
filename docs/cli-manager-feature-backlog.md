# CLI-Manager 功能借鉴待办

调研日期：2026-09-10。目标：为 Belfry 后续开发筛选有实际增量的功能。

- 参考项目：[dark-hxx/CLI-Manager][upstream]，固定源码版本 `bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8`。
- 当前项目：Belfry `0.20.2`，HEAD `61fa0ed`；判断基于当前工作区源码。
- 证据范围：阅读双方 README、相关功能代码与文档；未安装、运行或全面测试 CLI-Manager。
- 待办统一编号 `CM-01` 至 `CM-16`，放入“小清新待办”的“重要·不紧急”，不指定截止日期。
- P1＝优先补齐，P2＝随后规划，P3＝可选增强；S/M/L 是相对规模，不是工期承诺。

优先补齐准确状态、历史检索、改动审查和项目配置隔离，再推进后台保活与 Worktree。

## 已有能力与筛选边界

Belfry 已有终端分屏和拖拽、SSH 与系统凭据保存、全局 Provider 切换、Quick Open、
桌面通知、用量汇总、历史恢复、PI 插件系统、背景与字体设置，以及自动更新入口。
这些基础能力不重复列为新功能；下文只列它们尚缺的增强或新工作流。

当前 README 的插件描述及版本路线落后于源码，`.codestable/` 目录也不存在，故以现行
`src/`、`src-tauri/src/` 和 `docs/plugins/pi-runtime-guide.md` 为准。
云同步、手机端、账号/团队系统暂不列入，保持当前桌面本地工具的范围；命令复用仅作为可选 PI 插件考虑。
更多历史来源和桌宠暂后置，先完善 Codex / Claude 的核心工作流。

## 总览

| 编号 | 优先级 | 开发项 | 规模 | 主要依赖 |
| --- | --- | --- | --- | --- |
| CM-01 | P1 | Hook 驱动的准确会话状态与通知 | M | CLI 版本/能力检测 |
| CM-02 | P1 | 历史全文检索、筛选与收藏 | M | 现有 history 解析层 |
| CM-03 | P1 | Git 状态与只读 Diff 面板 | M | 现有文件预览 |
| CM-04 | P1 | 项目级 Provider 覆盖与隔离 | M | 现有 provider 适配层 |
| CM-05 | P2 | 当前会话的实时 Token 与工具统计 | M | CM-01 会话身份绑定 |
| CM-06 | P2 | PTY 后台保活与重新连接 | L | 独立进程与 IPC 设计 |
| CM-07 | P2 | Worktree 任务隔离与创建 | L | CM-03 |
| CM-08 | P2 | Worktree 审查、合并与清理向导 | L | CM-03、CM-07 |
| CM-09 | P2 | 历史对话详情与代码变更回看 | M | CM-02 |
| CM-10 | P2 | 用量趋势、费用估算与下钻 | M | 现有 usage 聚合层 |
| CM-11 | P2 | SSH 主机档案与远程项目入口 | M/L | 现有 OpenSSH 启动与凭据能力 |
| CM-12 | P2 | 命名工作区与分屏布局恢复 | M | 现有 layout、workspace |
| CM-13 | P2 | 本地备份、选择性恢复与撤回 | M | 存档版本与恢复边界设计 |
| CM-14 | P3 | 项目收藏、分组与启动配置 | M | 现有 project、workspace |
| CM-15 | P3 | 快捷键自定义与冲突提示 | S/M | 现有 shortcuts |
| CM-16 | P3 | PI 插件形式的命令与 Prompt 收藏库 | M | 现有 PI 面板/工具能力 |

## CM-01 · Hook 驱动的准确会话状态与通知

- 现状：[agent/contracts.rs](../src-tauri/src/agent/contracts.rs) 的 `structured_state` 为 false；[terminal/contracts.ts](../src/terminal/contracts.ts) 明确说明 activity 来自屏幕文字推断。已有 Hook 类型与状态映射不等于实际接线。
- 借鉴：[Hook 接收与鉴权][u-hook]、[Codex Hook 安装][u-codex-hook]。
- 最小范围：按 CLI 版本检测可用事件，绑定 Belfry tab 与原生 session；接入启动、等待输入、完成和失败事件，复用现有通知与协作队列。
- 验收：并行会话不串状态；重复事件不重复通知；等待批准不误报完成；不支持 Hook 时明确回退到推断状态；安装/移除保留用户原有 Hook。
- 风险：共享事件协议、CLI 配置改写与通知去重；产品内提供安装预览和显式启用入口。

## CM-02 · 历史全文检索、筛选与收藏

- 现状：[HistoryPanel.tsx](../src/history/components/HistoryPanel.tsx) 支持 Agent 分类、列表、恢复和删除，没有全文搜索、日期/项目组合筛选及收藏入口。
- 借鉴：[历史搜索、来源/项目筛选与收藏状态][u-history]。
- 最小范围：索引标题和对话文本，显示命中片段；按 Agent、项目、日期筛选；收藏与标签使用 Belfry 自有元数据。
- 验收：中文、命令与文件路径可搜索；组合筛选不混入其他项目；索引重建后收藏保留；继续会话仍使用原始 session ID。
- 风险：大日志增量索引、扫描取消与缓存失效；不改写 CLI 原始记录。消息定位展示在 CM-09 补齐。

## CM-03 · Git 状态与只读 Diff 面板

- 现状：[FilePreviewPane.tsx](../src/filepreview/FilePreviewPane.tsx) 提供文件树和只读文本预览，当前应用没有面向用户的 Git 改动审查面板。
- 借鉴：[Git 改动面板][u-git]。
- 最小范围：展示分支、已暂存/未暂存/未跟踪文件，查看文件和 hunk Diff，点击路径进入已有文件预览。
- 验收：新增、删除、重命名、中文路径可正确展示；大文件/二进制有清楚提示；非 Git 目录可正常退化；浏览操作不改动工作树或暂存区。
- 风险：嵌套仓库、外部文件变更与大 Diff；首期专注读取，提交/合并放入 CM-08。

## CM-04 · 项目级 Provider 覆盖与隔离

- 现状：[provider/service.rs](../src-tauri/src/provider/service.rs) 的切换接口只接收 Agent 与 Provider，改写全局 CLI 配置，缺少项目级选择和覆盖层。
- 借鉴：[项目/Worktree 覆盖及“跟随全局”][u-provider]。
- 最小范围：每个项目可跟随全局或指定 Provider，并显示实际生效来源；分别验证 Claude 与 Codex 的项目配置或启动隔离方案。
- 验收：项目 A/B 同时运行不同 Provider 时不串配置；取消覆盖正确回到全局；显示重启生效要求和环境变量冲突；密钥不落入仓库文件。
- 风险：配置优先级、凭据隔离和原有登录态；不把反复改全局文件当作项目隔离。Worktree 级覆盖在 CM-07 后接入。

## CM-05 · 当前会话的实时 Token 与工具统计

- 现状：[usage/contracts.ts](../src/usage/contracts.ts) 聚合模型/项目用量，没有当前活动 tab 的会话统计视图。
- 借鉴：[会话统计卡片][u-session-stats]、[Token 与工具明细组件][u-stats-cards]。
- 最小范围：依据原生 session 身份增量读取日志，展示当前会话四类 Token、模型、工具调用与更新时间；费用由 CM-10 的定价能力接入。
- 验收：切换 tab 显示对应会话数据；并行会话不交叉累计；日志续写后自动更新；缺失字段标为不可用，解析失败不阻塞终端。
- 依赖/风险：依赖 CM-01 的稳定身份绑定，需处理 resume、日志轮转和重复事件。

## CM-06 · PTY 后台保活与重新连接

- 现状：[workspace/storage.ts](../src/workspace/storage.ts) 明确“会话进程不能跨应用重启存活”，当前保存的是重新拉起进程的参数。
- 借鉴：[守护进程生命周期与恢复手册][u-daemon]、[有序输出回放][u-replay]。
- 最小范围：把 PTY 生命周期移至独立本机进程；区分“保留任务退出”与“终止任务退出”；重开时 attach 原进程并回放输出。
- 验收：真正退出 UI 后长任务继续，重开仍连接同一任务；不重复执行启动命令；回放有序且缺口可见；daemon 退出后准确说明任务已结束或只能恢复对话。
- 风险：进程树回收、IPC 鉴权、缓冲上限、版本兼容及 Windows ConPTY；需要独立设计和跨平台验证。

## CM-07 · Worktree 任务隔离与创建

- 现状：[WorkspaceTab](../src/workspace/contracts.ts) 绑定项目目录，多 Agent 协作没有 Worktree 创建和归属管理流程。
- 借鉴：[Worktree 创建、路径/分支校验与依赖检查][u-worktree]。
- 最小范围：为任务创建独立目录和分支，关联会话；提供手动创建和并行时提醒；显示依赖初始化建议。
- 验收：同一仓库两条任务分别在独立工作树写入；会话、文件预览和 Git 面板指向正确目录；重复任务名、非法分支和创建失败可安全处理。
- 依赖/风险：依赖 CM-03；涉及项目身份与 Git 写操作。只管理 Belfry 创建或用户明确接管的 Worktree，依赖安装由用户显式启动。

## CM-08 · Worktree 审查、合并与清理向导

- 现状：当前没有从协作任务完成到审查、提交、合并、回收工作树的产品闭环。
- 借鉴：[完成任务向导][u-worktree-finish] 与 [后端 Worktree 生命周期][u-worktree]。
- 最小范围：依次展示改动、提交内容、目标分支、合并结果和清理选项；每步可取消并保留任务成果。
- 验收：目标工作树有未提交改动时阻止合并；冲突时停止并列出文件；空差异不生成无意义提交；清理前检查未合并提交及文件占用。
- 依赖/风险：依赖 CM-03、CM-07；提交、合并、删除分别显式确认，禁止静默强制重置、丢弃改动或清理他人工作树。

## CM-09 · 历史对话详情与代码变更回看

- 现状：[HistorySession](../src/history/contracts.ts) 主要保存列表元数据，当前点击历史会话直接恢复 CLI，没有消息详情与历史 Diff。
- 借鉴：[历史文件变更与操作序列][u-history-diff]。
- 最小范围：只读展示用户/助手消息和工具调用；解析 Claude 编辑记录及 Codex patch；从文件 Diff 定位触发消息。
- 验收：同文件多次修改按时间区分；能从 Diff 跳回对应消息；原始日志没有内容时提示不足；大日志分段加载；浏览后原文件保持不变。
- 依赖/风险：复用 CM-02 查询；不把当前磁盘文件冒充历史版本，不纳入消息编辑/互转等高风险写入能力。

## CM-10 · 用量趋势、费用估算与下钻

- 现状：[UsagePanel.tsx](../src/usage/components/UsagePanel.tsx) 已有近 7/30 天、模型/项目 Token 汇总及配额，没有每日趋势、定价或交互式下钻。
- 借鉴：[统计面板][u-stats]、[模型定价][u-pricing]。
- 最小范围：新增每日 Token 趋势、日期/项目下钻和费用估算；支持可维护的价格表与自定义中转价格，标注价格来源和估算口径。
- 验收：四类 Token 不重复计费；未知模型显示“价格未配置”而非 0 元；日期边界正确；图表下钻与列表合计一致；明确估算不等同账单。
- 风险：缓存读写价格、模型别名、时区和历史价格版本；沿用本地日志数据，不新增请求代理。

## CM-11 · SSH 主机档案与远程项目入口

- 现状：[SshDialog.tsx](../src/workspace/components/SshDialog.tsx) 已支持主机、用户、端口、密码与钥匙串，并继承 OpenSSH 配置；没有主机目录和远程项目浏览入口。
- 借鉴：[SSH 主机管理][u-ssh] 与 [远端能力边界说明][upstream]。
- 最小范围：导入/选择 SSH 别名，保存主机分组和远程项目路径；提供显式连接诊断、远端目录选择和启动入口。
- 验收：配置别名、跳板连接与现有密钥可复用；取消浏览终止请求；失败可定位原因；凭据仍留在系统凭据库；不会把远端目录当本机目录扫描。
- 风险：网络超时、路径转义和远端能力检测。远端 Hook 后续复用 CM-01；首期不承诺远端 Git、历史同步或 Worktree。

## CM-12 · 命名工作区与分屏布局恢复

- 现状：[useSplitLayout.ts](../src/layout/useSplitLayout.ts) 的布局树仅在内存中；[workspace/storage.ts](../src/workspace/storage.ts) 保存 tabs 与活动 tab，没有布局树或命名工作区集合。
- 借鉴：[Workspan 创建、迁移与会话绑定][u-workspan]。
- 最小范围：保存工作区名称、分屏方向/比例、会话归属和焦点；支持切换与重开后的布局恢复。
- 验收：三窗格布局重开后还原；失效目录/缺失会话可提示并修复；旧存档继续可用；布局切换不重复创建已有任务。
- 风险：存档迁移和会话 ID 关联；可独立交付，实际进程跨退出存活仍由 CM-06 解决。

## CM-13 · 本地备份、选择性恢复与撤回

- 现状：工作区、外观和 Provider 数据分散保存；Provider 的登录态备份不等于整应用的导入导出与恢复流程。
- 借鉴：[备份/恢复产品流程][upstream]、[按设备快照与版本保留][u-sync]；仅取本地备份部分。
- 最小范围：导出带版本信息的本地包；首期覆盖工作区与外观，后续接入快捷键；导入前预览数据域、自动保存恢复前快照，并可撤回。
- 验收：全新配置下可还原所选数据；未选域保持不变；损坏包/新版本包有明确错误；失败可回退；导出包不包含 API Key、SSH 密码和私钥。
- 风险：多个存储域的一致性、路径差异和插件数据归属；不扩展为 WebDAV 或云同步，插件私有数据另行设计。

## CM-14 · 项目收藏、分组与启动配置

- 现状：[workspace/storage.ts](../src/workspace/storage.ts) 的最近项目上限为 6；[ProjectWorkspace](../src/workspace/contracts.ts) 没有收藏、分组或项目启动配置。
- 借鉴：[项目配置、启动命令和环境变量][u-project]、项目树与健康检查交互见 [README][upstream]。
- 最小范围：先补长期收藏和路径失效提示，再增加分组、默认 Shell、项目启动命令与非敏感环境变量配置。
- 验收：超过 6 个收藏项目不会被最近列表挤掉；目录移动后能修复路径；配置随项目切换；启动命令仅在用户启动会话时执行一次。
- 风险：项目/会话配置优先级和导入迁移；首期不自动执行仓库提供的脚本，不在普通环境变量配置中保存凭据。

## CM-15 · 快捷键自定义与冲突提示

- 现状：[resolveShortcut.ts](../src/shortcuts/resolveShortcut.ts) 使用固定键位映射，尚无录制、重绑定和恢复默认入口。
- 借鉴：[快捷键录制、冲突检测与默认值恢复][u-shortcuts]。
- 最小范围：为现有宿主动作增加可编辑映射；显示重复键位和系统/CLI 保留组合提示，支持逐项及整体恢复。
- 验收：新快捷键重启后保留；重复映射可见；macOS 与 Windows 规则正确；中文输入法组合输入不触发动作；不会吞掉 CLI 原生快捷键。
- 风险：应用快捷键与插件全局热键的作用域；优先覆盖已有动作，不扩展命令执行权限。

## CM-16 · PI 插件形式的命令与 Prompt 收藏库

- 现状：当前主界面的 Composer/Recipe 已移除；[PI 插件指南](plugins/pi-runtime-guide.md) 提供面板、设置与 Agent 工具，适合按需扩展。
- 借鉴：[全局/项目/会话命令模板和变量替换][u-prompts]。
- 最小范围：可选插件收藏常用 Prompt/命令，按项目分类，填充项目名/路径变量，预览后复制；直接投递能力先核实现有插件 API，再单独决定。
- 验收：跨项目不串模板；含空格/中文路径保持正确；用户编辑与预览后再执行；重启后收藏保留；禁用插件不影响核心工作台。
- 风险：模板变量转义和上下文边界；不恢复已移除的核心 Composer，不引入自动批量执行。

## 开发与验证安排

建议先做 CM-02、CM-03 两个直观增量，同时设计 CM-01、CM-04 的配置和身份边界。
依赖链为 `CM-01 → CM-05`、`CM-02 → CM-09`、`CM-03 → CM-07 → CM-08`。
CM-12 的布局恢复可先于 CM-06 独立交付；后台保活和 Worktree 属于需要专项设计的大项。

本轮只新增调研文档和待办，不实施这些功能。后续涉及共享类型、持久化、CLI 配置、
进程管理与 Git 写操作时，按项目实施门禁评审具体方案，再执行对应回归和跨平台验证。
上游示例是参考证据，不是直接复制方案；引用上游源码前应核对双方许可证的兼容要求。

[upstream]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/README.md
[u-hook]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/features/hooks/claude.rs#L597
[u-codex-hook]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/features/hooks/settings/codex.rs#L12
[u-history]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/history/components/HistoryListPane.tsx#L54
[u-git]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/git/api/GitChangesPanel.tsx
[u-provider]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/providers/api/ProviderSwitchModal.tsx#L323
[u-session-stats]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/history/components/SessionStatsPanel.tsx#L86
[u-stats-cards]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/stats/api/termStatsCards.tsx
[u-daemon]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/docs/pty-daemon-manual.md
[u-replay]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/infrastructure/daemon/server/replay.rs
[u-worktree]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/features/projects/worktree.rs
[u-worktree-finish]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/projects/api/WorktreeFinishDialog.tsx
[u-history-diff]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/history/components/SessionFileChangesView.tsx
[u-stats]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/stats/api/StatsPanel.tsx
[u-pricing]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/features/stats/model_pricing.rs
[u-ssh]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/settings/components/pages/SshHostsSettingsPage.tsx
[u-workspan]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/terminal/api/terminalWorkspan.ts
[u-sync]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src-tauri/src/features/sync/service/mod.rs
[u-project]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/projects/components/ConfigModal.tsx
[u-shortcuts]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/settings/components/pages/ShortcutSettingsPage.tsx#L94
[u-prompts]: https://github.com/dark-hxx/CLI-Manager/blob/bcc7604a9bd8e8b0c10e219c1e04a96e238a83f8/src/features/prompts/api/CommandTemplatePanel.tsx
