# T29：工作台右上工具区与统计条

用户指出该区域仍为旧布局。本次以 `directions/workbench.html?dir=b` 曜石 B 稿为依据，独立完成实现和验证。

[设计稿 / 修前 / 修后对照与完整截图](index.html)。

## 实现

- 右上仅保留分屏、文件与 Git、更多三个图标按钮；30×30、间距 2px、r6。文件图标与稿一致，更多的提醒点为 5px，位置 top6/right5。
- 搜索在侧栏常驻；更多在所有宽度下保留 Quick Open、协作、插件、文件与 Git、快捷指令和主题切换。协作待确认数、同目录多 Agent 提醒保留在更多及其可访问名称中。
- 分屏选择当前命名工作区中尚未显示的已有会话，调用已有 `layout.dropTab(..., 'right')`。没有候选时禁用并给出原因；原拖拽分屏和移出分屏仍可用，不额外创建会话。
- Worktree 弹窗状态由工具栏持有，关闭更多菜单后弹窗仍保持挂载，关闭后焦点返回更多按钮。
- Hook 来源与统计移到窗格的同一条 34px 状态行，删除额外的 24px Agent 工具条。统计按钮按稿使用 13px 图标、5px 间距、4×7px 内边距与 r6。保留真实会话查询、错误/未绑定说明、键盘关闭与焦点返回。
- 状态条为统计保留空间；长目录按可用宽度缩短，窄窗不会把统计挤到右侧之外。分屏隐藏重复的 Hook 来源，保留统计与窗格关闭入口。
- 没有添加设计示意中的固定模型/上下文数据。终端输出及统计内容均使用已有数据流。

相关源码：`WorkbenchToolbar.tsx`、`Workbench.tsx`、`App.tsx`、`WorkbenchToolbar.test.tsx`、`workbench.css`、`obsidianWorkbench.css`、`Sidebar.tsx`、`WorktreeReminder.tsx`、`TerminalPane.tsx`、`TerminalViewport.tsx`、`hooks.css`、`sessionStatistics.css`、`target.ts` 及中英文工具栏文案。

## 验证

最终生产构建：`index-CSn30ygW.js` / `index-DKp4B1ay.css`。

- `pnpm build` 通过；196 个文件 / 1267 项单元测试通过。
- 既有生产回归 23/23：工作台、设置、Provider、侧栏、动效、协作投递及收件箱。因入口调整更新协作用例的操作路径，原断言保留。
- 新增生产浏览器用例 2/2：macOS / Windows 平台标记，亮暗，1440×960 / 720×480；三个按钮、2px 间距、34px 单状态行、13px 统计图标、统计不越界；更多最后一个操作可滚动到并点击；统计读取会话模型与用量；分屏、移出、Worktree、收起侧栏后搜索、Escape 和焦点归还。
- 上述交互验证终端 DOM 始终保持连接，无终端创建/关闭/分离，无浏览器错误或未处理 IPC。
- `pnpm check:i18n` 通过：3525 条/语言，0 旧文案；曜石对比度脚本通过；`git diff --check` 通过。
- 对照页 34/34 图片实际加载；1280px / 700px 无横向溢出。修前 2 张、修后 28 张、同尺度裁切 6 张，日志和几何记录见同目录；SHA-256 见 `manifest.json`。

截图使用隔离 Chrome、生产构建、合成 IPC，不读取用户配置。平台标记用于验证样式，原生窗口验收范围沿用现有交付。

复现：

```sh
pnpm build
pnpm test
pnpm check:i18n
node docs/design/belfry-ui/obsidian-contrast.mjs
node --test --test-concurrency=1 src/components/lazy/testing/workbench-tools.case.mjs
node --test --test-concurrency=1 src/components/lazy/testing/production-ui.case.mjs src/components/lazy/testing/sidebar-layout.case.mjs src/components/lazy/testing/motion.case.mjs src/components/lazy/testing/collab-delivery.case.mjs src/components/lazy/testing/inbox.case.mjs
```
