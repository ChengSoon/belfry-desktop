# 前端可靠性修复（2026-11-08）

T1–T3 的回归先在旧实现运行，确认失败后再修复。合成 IPC 仅用于控制返回顺序和注入错误，浏览器用例运行真实 React、xterm 和生成的生产资源。

| 任务 | 改动与入口 | 回归证据 |
| --- | --- | --- |
| T1 | `src/rooms/useRooms.ts`：读取代次、选择校验、操作前后失效、卸载守卫、轮询在途判断 | `useRooms.requests.test.ts` 的 9 项旧版全部失败；A/B、同房刷新、旧列表、删除、操作成功、迟到错误和卸载均覆盖 |
| T2 | `src/rooms/drafts.ts`：本次应用会话中按房间保留草稿、附件及发送状态，字段编辑代次保护续写；删除房间时清理草稿 | `rooms-reliability.case.mjs` 的草稿切换、关面板、延迟发送/导入、失败保留在旧版失败；`drafts.test.ts` 覆盖编辑后改回原文、重试和旧回执 |
| T2 | `useCollabTasks.ts`：操作错误与查询错误分开；失败操作显式重试，同一任务一次在途决定 | 5 项单测旧版全部失败，修复后通过 |
| T2 | `RoomView.tsx`：对话标签、窗口可见/聚焦、贴底和消息相交共同决定已读；窄窗折叠侧栏，消息操作进入正常布局 | 流程、失焦、隐藏窗口旧版误标已读；720×480 / 14px、20px 的发送、选人、回复、创建任务和成员入口通过真实点击 |
| T3 | `src/diagnostics/`、`src/main.tsx`：根级错误边界、全局异常日志、复制脱敏诊断和原生重启入口 | `production-security.case.mjs` 的 3 项在旧生产构建全部失败，修复后通过；5 项日志单测覆盖字段限制、任意对象不序列化、写日志失败不递归 |
| T3 | `tauri.conf.json`、`public/startup.js`：生产脚本只允许同源；样式保留运行时内联样式；IPC、资源及本地插件框架分别列白名单 | 生产 CSP 下终端输入和 WebGL 正常、内联脚本注入被拒绝、真实 PluginDock 可加载本地面板/预览地址；既有 `panel-browser.case.mjs` 的真实插件文件和网页预览两项通过 |
| T3 补验 | 生产与开发策略增加 `media-src 'self' blob:`、`img-src https:`，保留动态壁纸与 README 外链图片 | `production-security.case.mjs` 新增两项先在遗漏策略下稳定失败：真实 `AppBackground` 报 `media-src`，市场 README 图片报 `img-src`。修复后验证视频解码与播放进度、HTTPS 图片像素尺寸及无 Referer；HTTPS 响应用本地 CDP 固定夹具，无公网依赖 |
| T13 | `RoomReplyInbox.tsx`、`model.ts`、`flow.ts`：合并保留消息、按 id 去重，支持编号回复、引用原文和流程待回复状态 | 旧流程模型忽略保留消息的用例先失败；模型覆盖重复投影、短号歧义；`rooms-retained.case.mjs` 验证实际编号回复参数与引用原文 |
| T15 | `taskTone.ts`、`DeliveryActions.tsx`：独立展示投递事实与工作结果；不确定任务可按稳定终端 ID 定位，人工确认/放弃使用原回执的严格 CAS | `deliveryView.test.tsx` 的 9 项旧版全部失败，房间投递模型 6 项先红后绿；协作/Prompt/房间 159 项单测通过。`collab-delivery.case.mjs` 验证改名后定位、过期确认拒绝、重新核对后确认/放弃，整个处理流程无 PTY 写入 |
| T15 | 仅 outbox 改变也更新消息；人工处理成功后按任务 ID 清理内存观察者，残留输入未空时仍暂停后续任务 | 浏览器轮询回归在旧 memo 比较规则下稳定失败，修后排队→不确定→已提交即时更新。Prompt 回归覆盖迟到 not-written 回调不重贴、清空后只提交下一条。点击确认按钮卸载时用原事件路径判定所属面板，避免误关 |

T8 补验：加载失败卡片的面板标题使用 getter，保持懒加载组件身份与重试状态；`i18n.case.mjs` 新增失败期间切换语言后仍可重试的回归，修前稳定残留中文标题，修后三项通过。

前端浏览器回归通过模拟 Tauri IPC，不冒充 Windows WebView2 或 macOS 原生窗口端到端验收。T7 的日志落盘、脱敏和诊断文件由后端独立测试。开发 CSP 单独允许 Vite 的内联入口及 `ws://127.0.0.1:1420`；生产 CSP 不允许任意内联脚本或 eval。测试采用隔离 Chromium，不连接用户现有的 Agent/PTY。

## T16：历史浏览和容量说明

`Room` / `RoomSummary` 接入 `ledgerBytes`（旧缓存缺字段时显示暂不可用）。房间操作菜单新增信息页，显示本地化历史大小和“历史原文保留到删除房间，长期保存请先备份应用数据目录”。时间线顶部提供只读历史分页，没有归档动作。

`RoomHistoryPager` 原样回传 opaque cursor，越过近期消息的重叠页，禁止重叠读取，保留失败前成功页面以便重试，退出房间使迟到结果失效。`historyTimeline` 按消息 ID 合并历史、浏览期间已见消息和最新投影；最新投影优先，窗口滚动不会删掉已见内容。原始历史请求不推断当前待回复状态。无法解析、未知 kind / 版本和截断原文均有可读兜底，原文按文本转义。

`TimelineAnchor.getSnapshotBeforeUpdate` 在 DOM 变化前捕获当前可见消息及位置，更新后恢复位置；它覆盖分页等待期间用户继续滚动、新消息到达及近期窗口滚动。贴底行为和原有前台已读判断保持原有条件。

验证：新增 `history.test.ts` 8 项，房间/协作/Prompt 共 22 文件、167 项通过；tsc、check:i18n 通过。`rooms-history.case.mjs` 两项在旧界面上稳定失败，修后通过，实际核对游标原值、新旧消息去重与不遗漏、插页及实时到达前后的像素坐标、异常原文转义、容量说明和切房迟到结果。原有房间可靠性 9 项及 retained 浏览器回归通过。浏览器是 Chromium + 模拟 native IPC，未代替 Windows/WebView2 真机验证。

日志：`/tmp/belfry-t16-before.log`、`/tmp/belfry-t16-history-final.log`、`/tmp/belfry-t16-unit.log`；原有 9 项浏览器回归见 `/tmp/belfry-t16-browser.log`（同次历史样本不够长，扩充样本后已单独重跑并通过上述 final 日志）。

## T9：全界面国际化与切换保护

所有界面模块进入 `src/i18n/locales/{zh-CN,en}`，共 3,359 条/语言，其中 967 条来自 T10 最终错误目录。`check:i18n` 要求硬编码基线保持空，并检查中英 key、参数、复数 count、空白/标点片段及无语义的 `valueN`。`sync-backend-i18n.mjs --check` 已接 CI，防止共享错误目录更新后遗漏前端词库。

数量与整句提示使用插值/复数，日期、数字、货币和列表使用 Intl。Provider/SSH/快捷键/环境等操作反馈延迟到渲染时翻译；验证错误保留翻译 key，结构化错误保留 code/params。`useCollabTasks.test.ts` 增加语言切换回归，确认失败操作仍保留、轮询不清除、不触发再次批准。终端输出回归同时检查中英退出提示的 CRLF/ANSI 边界、最终输出与退出诊断顺序；恢复判断继续使用原始诊断及稳定码。

| 浏览器用例 | 验证内容 |
| --- | --- |
| `i18n.case.mjs`（3 项） | 系统/手动语言、持久化、原生同步、输入与终端保留、加载失败后切换和重试 |
| `rooms-i18n.case.mjs`（1 项） | 英文房间、历史和对话框，切换保留草稿，720×480 |
| `analytics-i18n.case.mjs`（2 项） | 历史检索和详情、用量、文件预览，英文与最小窗口 |
| `git-provider-i18n.case.mjs`（2 项） | Git 分组即时翻译、保留选中 diff；worktree 与 Provider 保存、未保存输入 |
| `plugins-i18n.case.mjs`（1 项） | 市场、详情、权限、来源保存和模板；语言同步至插件 context/appearance，保留表单 |
| `workspace-shortcuts-i18n.case.mjs`（2 项） | 项目保存、SSH 校验错误、快捷键编辑/恢复、帮助；切换后输入和错误仍可用 |
| `setup-terminal-i18n.case.mjs`（1 项） | 同步 skill 的单复数及已有提示、Hook 预览/确认、后台任务操作 |
| `production-security.case.mjs`（5 项） | 原安全场景；崩溃页新增英文窄窗、复制诊断提示切换与重启真实点击 |

最终组合还运行 `collab-delivery`、`rooms-history`、`rooms-retained`、`rooms-reliability`：31 项通过、零跳过。全量 Vitest 为 185 文件、1,096 项通过，生产 build、目录同步、`check:i18n` 和 `git diff --check` 通过。日志为 `/tmp/belfry-t9-final-all-unit.log`、`/tmp/belfry-t9-final-all-build.log`、`/tmp/belfry-t9-final-all-browser.log`。各模块也已分别写入 Belfry T9 进度 note，长期证据以仓库内回归用例为准。

完整 CI 插件/浏览器入口 `node .github/workflows/verify-plugins.mjs` 已在本机运行：254 项通过，失败/取消/跳过均为 0，退出码 0，用时约 282 秒；日志 `/tmp/belfry-t9-ci-browser.log`。该次覆盖仓库自带全部必跑用例；环境未提供 `BELFRY_PI_SOURCE`，因此脚本未纳入另行验收的 4 项原版 PI 互操作用例。浏览器运行平台为 macOS/Chromium，原生 IPC 为受控夹具，Windows/WebView2 原生运行仍需对应平台验证。
