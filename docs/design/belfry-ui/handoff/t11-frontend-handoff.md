# T11 前端交接（未验收）

按统筹最新安排，前端已停止 UI 文件修改，不再重建 dist；T11/T12/T14 已转交 UI设计工程。下面只记录本轮 T11 的在制源码，不把它标记为完成。

## 已做

- 17 个模块 CSS 接入 space/radius/motion 令牌。持久当前项用 sidebar-active 中性底 + 500；键盘焦点候选用 accent-soft + inset 2px 侧标。鼠标 hover 用 surface-hover。
- 新增共用 Notice（图标、正文、恢复动作），采用 danger-soft/warning-soft/中性 surface。历史读取错误、用量、Git diff、工作树和项目 Provider 的现有重试/刷新入口放进 Notice；字段错误仍在字段旁。
- 空状态用 empty-inset/empty-gap；元信息沿用 fs-xs/muted/faint。用量金额补 tabular-nums，保留 flex-end/等宽布局与计算逻辑。
- 文件预览十条亮暗语法 hex 未改；路径保留/补等宽。Git 增删颜色保留，review anchor 与预览跳转行改为中性底 + 2px 侧标。
- Provider 卡片网格/列数与结构保留；卡片选中改中性，周边 280/260/130ms CSS 时序命名为局部变量。ProviderCard.tsx 和 shatterCard.ts 没有改；520ms 翻转、340ms 回落、1050ms 碎裂与 reduced-motion 逻辑仍沿用原实现。
- 快捷键保存反馈改 success；Guide 当前 tab 中性填充，键帽用 shadow-sm。

## 本轮文件（39 个）

共享：
- src/styles.css（仅新增 notice-inset/gap/radius、empty-inset/gap；T7 主题值不改）
- src/components/Notice.tsx（新增）
- src/components/notice.css（新增）

CSS：
- src/history/history.css
- src/history/historySearch.css
- src/history/details/historyDetails.css
- src/usage/usage.css
- src/usage/insights/usageInsights.css
- src/usage/pricing/priceBook.css
- src/usage/session/sessionStatistics.css
- src/git/git.css
- src/git/review/review.css
- src/git/worktrees/worktrees.css
- src/filepreview/filePreview.css
- src/filepreview/filePreviewTrigger.css
- src/shortcuts/custom/shortcutSettings.css
- src/shortcuts/shortcutGuide.css
- src/provider/provider.css
- src/provider/configEditor.css
- src/provider/project/projectProvider.css

JSX：
- src/history/components/HistoryPanel.tsx
- src/history/details/HistoryDetailPanel.tsx
- src/history/details/HistoryChanges.tsx
- src/history/details/HistoryMessages.tsx
- src/usage/components/UsagePanel.tsx
- src/usage/insights/UsageBreakdown.tsx
- src/usage/pricing/PriceBookEditor.tsx
- src/usage/session/StatisticsBody.tsx
- src/git/GitPanel.tsx
- src/git/GitDiffView.tsx
- src/git/review/GitReviewComposer.tsx
- src/git/worktrees/WorktreeDialog.tsx
- src/filepreview/FilePreviewPane.tsx
- src/provider/components/ProviderSection.tsx
- src/provider/components/ProviderConfigEditor.tsx
- src/provider/project/ProjectProviderSection.tsx
- src/shortcuts/custom/ShortcutSettingsSection.tsx
- src/shortcuts/custom/ShortcutResetPreview.tsx
- src/shortcuts/custom/ShortcutEditor.tsx

## 验证与待办

已通过：pnpm exec tsc -b；pnpm test（193 文件 / 1252 项，耗时 7.71 秒）；git diff --check。
测试日志：/tmp/belfry-ui-t11-tests.log。

未做：T11 的 pnpm build、生产浏览器用例、截图、obsidian-contrast.mjs。不能把 T7 验证冒充 T11 验证。
生产用例扩展只是计划，src/components/lazy/testing/production-ui.case.mjs 在本轮 T11 没有修改（现有 diff 属于 T7）。

接手后仍需生产验证：窄窗 Notice 原因/动作的换行与命中，current 与 focus-visible 的实际层叠、历史详情/工作树的密度、金额对齐与 Provider 动效/碎裂。CSS 按完整选择器复核过，但尚未得到浏览器证据。

## 构建和基线

现有 dist 仍为 T7：index-C1gJpsbW.js / index-Diatt1Dn.css，没有 T11 重建。
T7 dist 另存 /tmp/belfry-ui-t7-dist-C1gJpsbW。
本轮 T11 修改前的 17 CSS + styles.css + production-ui.case.mjs 快照在 /tmp/belfry-ui-t11-before/src/（保留了 T4/T7 在制修改，可用来隔离 T11 diff，不要直接按 HEAD 还原）。
T7 生产浏览器证据仍在 /tmp/belfry-ui-t7-browser-final/；完整 T7 两平台矩阵已由 UI设计工程拍到 docs/design/belfry-ui/batch-2/after/，按统筹安排留作 T15 的改前参照。

没有提交/暂存本轮变更。前端未编辑 remote/rooms；这些文件在并行远程功能清理中已发生删除/还原，交接不对其当前状态作“零变化”断言。
