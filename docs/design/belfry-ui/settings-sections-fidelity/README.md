# T20 设置各分区按曜石稿实施：设计稿 vs 实装

并排对照：`index.html`（左边是 `obsidian-screens/shots/sections-*.png` 设计稿，右边是 `after/` 下的实装截图），7 个分区亮暗各一组，另加快捷键录制态。

- 拍摄方式：`pnpm build && node --test scripts/capture-settings-sections.case.mjs`，尺寸 1440×1200，和设计稿一致。使用合成测试数据（`production-uiNative.js`），条目数和文案与稿子里的演示数据不同属正常。
- 构建：`index-LzCjuhv1.js` / `index-CR0aEzFM.css`

## 改了什么

公共部分：新增 `src/settings/obsidianSections.css`，类名统一用 `os-` 前缀，规格逐条取自稿子的 `obsidian.css` / `sections.css`，包括页面（最大宽 880）、组头、group 卡片（r8 · panel · 内描边 · 行间 border-soft）、设置行、32 高的主 / 次 / 幽灵 / 危险按钮、四档徽标、28px Agent 图标块、动作卡、复选行、空状态、等宽路径框。只给这 7 个分区用，T12 负责的外壳、导航、外观页和 `components/controls` 都没改。说明和提醒统一用现有的 `Notice` 组件（info / warning / neutral / danger）。

| 分区 | 源码 | 落地内容 |
| --- | --- | --- |
| 全局 Provider | `ProviderSection.tsx`、`ProviderOfficial.tsx`、`ProviderSettingsHeader.tsx`、`provider.css` | 页头：刷新（幽灵图标）+「新增 Provider」（唯一的实心按钮）。Agent 切换：分段 32/26，等分铺满。「当前选择」放进 group 单行，生效时显示 accent 徽标，未生效时显示「切回官方」次要按钮。卡片：r12、panel 底、选中时 sidebar-active + strong 描边 + 2px 竖条；「启用」为次要按钮，「已选用」为 accent 徽标；卡片最小宽改为 260。**`ProviderCard.tsx` 和 `shatterCard.ts` 没改**，翻转、碎裂和选中过渡都保留原样 |
| 项目 Provider | `ProjectProviderSection.tsx`、`projectProvider.css` | 项目头放进 group（名称 + 等宽路径）；环境变量覆盖改为 warning notice（原来是折叠块）；每个 Agent 一行：图标块 + 名称 + 来源徽标（跟随全局为中性、项目覆盖为 accent、已删除为 err）+ 说明 + 端点和模型（等宽）+ 下拉；失效选择时下拉用 danger 描边、说明改为 danger 色 |
| 会话状态 + 后台任务 | `HookSettingsSection.tsx`、`HookCards.tsx`、`hooks.css`、`BackgroundSessions.tsx`、`daemon.css` | 介绍改为 info notice；组头显示「n 个 Agent · m 个已连接」；每个 Agent 一行，状态徽标为已连接 ok / 可启用 accent / 屏幕推断 / 未检测到 CLI；「配置位置」可展开，展开后是等宽路径框；行尾是「预览启用」（次要）或「预览移除」（danger 幽灵）。变更预览改为 panel + r12 + shadow-md 面板，确认移除用 danger 实心按钮。后台任务单独分组且常驻展开，每行 56 高：状态点 + 名称 / 等宽路径 + 状态徽标 +「结束」（danger 幽灵）或「清除」 |
| 快捷键 | `ShortcutSettingsSection.tsx`、`ShortcutEditor.tsx`、`ShortcutResetPreview.tsx`、新增 `ShortcutKeys.tsx`、`shortcutSettings.css` | 平台说明改为 info notice（标题行 + 说明行）；每组一个 group；行内是名称 + 默认 / 自定义（accent）/ 已停用徽标，右侧是拆开的键帽（24 高）+「更改」幽灵按钮。折叠组收成一行（名称 +「9 项 · 展开」）。**录制态改为行内**：整行 accent-soft，左侧是提示、说明、保存后预览和冲突（danger），右侧是 accent 环键帽 + 停用 / 恢复此项默认 / 取消 + 保存（实心）。「全部恢复默认」为次要按钮 |
| 本地备份 | `BackupSection.tsx`、`backup.css` | 导出和恢复从页头移到内容区，做成两张动作卡（图标块 + 标题 + 说明 + 按钮，导出为实心、恢复为次要）；恢复预览为组头 + group 内复选行 + 取消 /「安排下次启动恢复」；已安排时用 warning notice +「取消安排」；可撤回时用 neutral notice，二次确认在 notice 内完成 |
| 协作环境 | `EnvironmentSection.tsx`、`environment.css` | 页头加了说明（新增 i18n 一条，中英文都加了）；动作区是重新检查（幽灵图标）+「同步全部 skill」（实心）。总状态放进 group：32px 圆形图标，按 ok / warning / error 换色。检查项为 group 内的 56 高行 |
| 关于 | `AboutSection.tsx`、`about.css` | 产品块放进 group：48px r12 logo + 标题 + 描述 + 版本徽标；三个链接为幽灵按钮，「检查更新」为唯一实心按钮。有新版本时显示 info notice +「下载并安装」（打开现有更新对话框）。CLI 为 group 内的 60 高行：图标块 + 名称 / 当前版本 + 最新版本列 + 状态或次要的升级 / 安装按钮；「全部升级」放到列表下方，改为次要按钮 |

新增文案（中英文各一份）：`backup.BackupSection.restoreTitle/restoreHint`（动作卡标题和说明，取自稿子）、`setup.EnvironmentSection.description/checks`、`about.AboutSection.updateAvailable/updateAvailableHint`、`agent.HookCards.connected/previewEnable/previewRemove`、`agent.HookSettingsSection.agentsTitle/agentsMeta`、`provider.ProjectProviderSection.agentsTitle`。

## 偏差逐条说明

| # | 位置 | 稿子 | 实装 | 原因 |
| --- | --- | --- | --- | --- |
| 1 | 全局 Provider「高级配置」行 | 列表页底部单独一行，带「打开」按钮 | 没有加 | 现在「高级配置」（CLI 原始文件）在编辑某个 Provider 时才出现，要绑定一份草稿才能读写。在列表页加入口需要新的数据流，超出「只改布局、不改行为」的边界。已经通知 UI设计工程 |
| 2 | 全局 Provider 卡片「已选用」位置 | 徽标在卡片底部左侧，「启用」按钮不显示 | 徽标和「启用」叠在同一格，交叉淡入淡出 | 选中切换的过渡（`provider-card__selection`）是动效契约的一部分，生产用例会检查。只把「已选用」换成了 accent 徽标的样式 |
| 3 | 会话状态的行尾按钮 | 「预览启用」「预览移除」 | 按钮显示同样的短文案，完整的「预览启用 Codex Hook」放在 aria-label | 6 行按钮都写 Agent 名会把行挤得参差不齐；读屏时仍能读到是哪个 Agent |
| 4 | 会话状态 · 已连接时 | 只给「预览移除」 | 事件全部装好、没有过期时只给「预览移除」；有缺失或过期时同时给「预览启用」 | 部分安装需要能补齐，这是原有能力，不能删 |
| 5 | 会话状态 · 后台任务 | 列表常驻 | 常驻展开，进入分区自动读取一次（原来要点开折叠块） | 照稿子做。用例里去掉了「点开折叠」这一步，其他断言不变 |
| 6 | 快捷键录制态 | 右侧只有取消 + 保存 | 还保留了「停用」「恢复此项默认」 | 这两个是现有功能，单测要求保留；都是幽灵按钮，不抢主按钮 |
| 7 | 快捷键录制态 · 冲突 | 第三行 danger 字 | 同样处理，另外多一行「保存后：⌘+U」预览 | 「录制后预览」是这一页的核心说明，单测要求保留 |
| 8 | 协作环境 · 检查项 | 每行一个检查（CLI / skill） | 行数和内容由后端报告决定，合成数据只有 1 行 | 数据差异，不是结构差异 |
| 9 | 关于 · CLI 行的 note | 没画 | release 有 note 时显示在名称下方（faint，小字） | 现有字段；为空时不渲染 |
| 10 | 全宽 | 稿子是 1440 窗口里的浮起内容面 | 设置页沿用 T12 的外壳（导航贴边，内容区不浮起） | 外壳归 T12，不在 T20 范围 |

## 验证

- `tsc --noEmit` 通过
- `pnpm test`：195 个文件，1263 项全部通过。快捷键、项目 Provider、Hook 的组件单测按新结构核对过；Hook 单测里一处断言改为匹配 aria-label，其他断言不变
- `pnpm build` 通过
- 生产浏览器用例全量 `src/components/lazy/testing/*.case.mjs`：155/155 通过，零错误、零未处理命令。其中包括 Provider 卡片 / 分段滑块 / 翻转动效（reduced-motion 下不播放）、Provider 未保存保护、英文 720×480 下的环境 / Hook / 后台任务、快捷键编辑和保存 / 全部恢复且不重建终端
- `node docs/design/belfry-ui/obsidian-contrast.mjs` 退出码 0。没有新增颜色组合：徽标、notice 和 accent-soft 上的文字都沿用 T5 / T10 已核算的组合，faint 字没有放在 accent-soft 上
- `git diff --check` 干净

## 未覆盖

- Windows 平台截图和最大字号截图没有拍（用的是 macOS 平台标记，默认字号）
- 环境检查的警告 / 异常态、关于页的「有新版本」notice、备份的恢复预览 / 已安排 / 可撤回状态：代码已按稿实现，但合成数据没有构造这些状态，所以没截图
