# 曜石 Obsidian · 二级界面设计稿（T10）

这是 refresh-plan 批次 3–4 的落地参照，覆盖设置面板、Quick Open、插件中心、确认弹窗和 Toast。取值和 `../obsidian-tokens.md` 逐字一致，尺寸角色、间距、选中语义来自 `../refresh-plan.md`（A09 / A10 / A13 / A14）。本轮只出设计稿，没有改 `src`。

## 打开方式

| 页面 | 内容 |
| --- | --- |
| `settings.html` | 设置导航（分组、当前位置、hover）、外观页：分段控件、开关、滑块、下拉、焦点态、字段错误、warning notice、主/次/幽灵按钮 |
| `quick-open.html` | 搜索栏、范围筛选、分组结果、键盘候选与 hover、底部快捷键提示 |
| `plugins.html` | 已安装列表（启用、关闭、启动失败、有更新）、错误 notice、右侧详情（权限、信息） |
| `dialogs.html` | 危险确认（输入名称确认）、未保存离开、三种 Toast、按钮与状态一览 |

- 每个页面都支持 `?theme=dark|light` 切换主题。
- 加 `&spec=1` 会叠加粉色标注层，标出尺寸、圆角、令牌和状态。
- `shots/` 里有 1440×960 截图：每个页面各一张 `-dark`、`-light`、`-spec`（暗色加标注），共 12 张。
- 所有内容都是演示数据，地址使用 `example.invalid`。

## 通用规格

| 角色 | 规格 | 令牌 |
| --- | --- | --- |
| 按钮 | 高 32，左右内边距 14，r6，13px/500；一个操作区只有一个实心主按钮 | `--control-height-sm`、`--radius-sm` |
| 输入框、下拉 | 高 38，左右内边距 12，r6，`surface` 底，`inset 1px border-strong` 描边 | `--control-height-md` |
| 导航行 | 高 40，左右内边距 10，r6，图标间距 10 | `--row-height-nav` |
| 分段控件 | 外框 32（内边距 3），每段 26，外圆角 r6、段圆角 r4 | |
| 开关 | 36×20，滑块 14，关：`surface-hover` 底 + `border-strong` 描边；开：`accent` 底 | `--radius-full` |
| 设置行 | 至少高 64，内边距 16/20，行间用 `border-soft` 分隔；分组外框 r8，`panel` 底，`border` 描边 | |
| 页面 | 内边距 32，最大宽 880，页头底部留 24 再接分隔线，分区之间隔 32 | `--space-8`、`--space-6` |
| 弹窗 | 宽 440，内边距 24，r12，`surface-raised` 底，`shadow-lg`，按钮右对齐、间距 8 | `--radius-lg` |
| Toast | 宽 380，内边距 12/14，r8，`surface-raised` 底，`shadow-md`（自带 1px 描边，不再另加 border），右下角堆叠，间距 8 | |
| Notice | 内边距 10/12，r6，`*-soft` 底；结构为「图标 + 粗体原因 + 次级说明 + 恢复动作」 | A14 |
| 徽标 | 高 20，r4，11px/500，`*-soft` 底 + 同色文字 | |

### 状态语义（A13）

| 状态 | 表现 | 用在哪里 |
| --- | --- | --- |
| 持久的当前位置 | `sidebar-active` 底 + 左侧 2px `accent` 竖条 + 500 字重；图标着 accent 色 | 设置导航、会话侧栏、插件列表当前详情 |
| 键盘候选 | `accent-soft` 底 + 2px `accent` 竖条；副标题从 faint 提到 muted | Quick Open、下拉选项 |
| 鼠标 hover | 只换成 `surface-hover` 或 `sidebar-hover` 底，不加竖条 | 所有可点击的行 |
| 焦点 | 2px `accent` 外环，偏移 2px；字段用 `:focus-within` | 所有可聚焦元素 |
| 字段错误 | 描边改成 `inset 1px danger`，字段下方贴一行 12px 错误文字（带图标） | 内联字段错误不做成卡片 |
| 区块错误、警告 | `danger-soft` 或 `warning-soft` 底的 notice，带恢复按钮 | 插件启动失败、壁纸与毛玻璃互斥提示 |
| 禁用 | 透明度 0.45，鼠标显示 not-allowed | |

## 各界面要改的源码与令牌映射

> 行号基于本稿编写时的工作区；前端 T4/T7 正在改这些文件，落地时以选择器名为准。

前端照此落地。

### 1. 设置面板（`settings.html`）

| 文件 | 改动 |
| --- | --- |
| `src/settings/settings.css:48` `.settings-nav__group button` | 补 `position: relative`，`min-height: var(--row-height-nav)`，圆角改用 `var(--radius-sm)`，过渡改用 `var(--motion-standard) var(--motion-ease)` |
| `src/settings/settings.css:51` 导航 hover | 底色由 `--surface-hover` 改为 `--sidebar-hover`（导航栏的底色就是 sidebar） |
| `src/settings/settings.css:52-53` `.is-active` | 底色由 `--surface-raised` 改为 `--sidebar-active`，加 `font-weight: 500`，再加 `::before` 画 2px accent 竖条（top/bottom 各 12）；图标保持 accent 色 |
| `src/settings/settings.css:41,45` 设置搜索框 | 描边改为 `box-shadow: inset 0 0 0 1px var(--border-strong)`，焦点仍是 2px accent outline；`6px` 改用 `var(--radius-sm)` |
| `src/settings/settings.css:47` 分组标题 | 颜色由 `--text-muted` 改为 `--text-faint`（标题要比导航项弱一档） |
| `src/settings/settings.css:57` `.settings-nav__guard` | 左侧竖线的写法改成 warning notice 结构（A14） |
| `src/settings/settingsShell.css` `.settings-content` | 内边距 24 改为 32（`--space-8`），窄窗下保留现有的 24/16 |
| `src/background/components/appearance.css:217-240` `.appearance__segments` | 按分段控件规格：外框内边距 3、段高 26；选中段改为 raised 底 + `shadow-sm` + 1px border + 500 字重（暗色下选中段底色写死为 `#2a2c33`，因为 raised 和 surface 太接近，需要再提一档；建议新增令牌 `--segment-selected`） |
| `src/components/controls/fields.css:8,22-23` `.ui-field` | 描边一律用 `border-strong`（现在只有 hover 时才变强）；hover 时改用 `text-faint`；焦点时外加 2px accent outline，而不是只换边框色 |
| `src/components/controls/controls.css:20` `.ui-control__error` | 12px，`danger` 色，前面加图标，贴在字段下方 6px；同时给字段加 `[aria-invalid=true]` → `inset 1px danger` |
| `src/components/controls/choices.css` 复选、单选 | 方框 16，r4，未选用 `border-strong` 描边，选中用 `accent` 底 + `accent-contrast` 勾 |

### 2. Quick Open（`quick-open.html`）

| 文件 | 改动 |
| --- | --- |
| `src/quickopen/quickOpen.css:28` 面板 | 宽 640，圆角 `--radius-md` 改为 `--radius-lg`，`surface-raised` 底 + `shadow-lg`；遮罩用 `--scrim`，面板顶部距窗口顶 14vh |
| `quickOpen.css` 搜索区 `.quick-open__head` / `__search-wrap` | 高 52，输入 15px，底部 1px `border`，右侧 `esc` 键帽 |
| `quickOpen.css:89` `.quick-open__item` | 至少高 44（现为 52），内边距 6/10，图标框 28×28、r6、`surface` 底 + 1px border |
| `quickOpen.css:104,110` `.is-active` | 保留 `accent-soft` 底；`inset 2px` 的 box-shadow 改为 `::before` 画的圆头竖条（top/bottom 各 8），和导航保持一致。**hover 和 `.is-active` 要分开写**（现在第 103-104 行合在一条规则里）：hover 只用 `surface-hover`，不加竖条 |
| `quickOpen.css:146` `.is-active .quick-open__item-kind` | 副标题和 kind 由 faint 提到 `--text-muted`，原因见下面「对比度」第 1 条 |
| `quickOpen.css` 匹配高亮 | 命中的字符改用 `accent` 色 + 500，不加底色 |
| `quickOpen.css` `.quick-open__foot` | 高 36，`panel` 底，顶部 1px `border`，12px faint 文字，键帽见 `obsidian.css` 的 `kbd`（高 20、底边 2px） |
| 范围筛选（新增） | 搜索框下方一排 24 高的 tag，当前范围用 `accent-soft` 底。只是视觉提议，有没有这个功能以 `quickopen/model.ts` 为准；没有的话这一排不做 |

### 3. 插件中心（`plugins.html`）

| 文件 | 改动 |
| --- | --- |
| `src/plugins/center/styles/graphite.css:12` | `--ds-bg-active: var(--sidebar-active)` 保持不变，换值后自动跟进 |
| `graphite.css:29-32` 开关令牌 | `--ds-switch-track-off` 由 `--border-strong` 改为 `--surface-hover`（关的时候是浅底 + 描边，而不是一整块灰）；`ring-off` 保持 `border-strong`；`knob-off` 保持 `text-muted`；新增 `--ds-switch-track-on: var(--accent)` |
| `host.css:10-11` `.settings-toggle` | 30×18 改为 36×20，滑块 14，左右各留 3 |
| `page-02.css:68` `.plugins-row` | 由一张张独立卡片改为一个分组列表：外框 r8 + `panel` 底 + `border`，行间用 `border-soft` 分隔，行至少高 68；当前详情行用 `sidebar-active` 底 + 2px 竖条 |
| `page-02.css` 行内容 | 图标框 36×36、r8；名称 14/500；ID 和版本用 12px mono faint；作用范围是 28 高的描边胶囊；开关放在行尾 |
| 启动失败 | 页面顶部用 danger notice（「查看日志 / 重试」），行内同时显示 `err` 徽标，两处都写明原因 |
| 详情栏（`MarketDetail` / `PluginSettingsSheet` 的宿主容器） | 宽 380，`panel` 底，左侧 1px border，内边距 24；权限逐条一行（`surface` 底、r6），高风险权限（网络、Shell）用 `warning-soft` 底 + 警告图标；卸载用 danger 色的幽灵按钮 |
| `pluginBridge.css` / `scope-01.css` / `page-01.css` 里写死的投影 | 改用 `--shadow-md` / `--shadow-lg`（refresh-plan A07） |

第三方插件 iframe 内部的样式不覆盖。

### 4. 确认弹窗与 Toast（`dialogs.html`）

| 文件 | 改动 |
| --- | --- |
| `src/workspace/workspace.css:280-300` `.modal-scrim` / `.modal` | 宽 440，内边距 24，`--radius-lg`（换值后为 12）；圆角和阴影现在已经走令牌，换值即可生效 |
| `workspace.css` `.modal__title` | 字号由 `--fs-display`（20）降到 `--fs-lg`（15）/500：弹窗标题不应该比页面标题还大 |
| `workspace.css` 弹窗顶部图标（新增 `.modal__icon`） | 36×36、r8；危险用 `danger-soft` 底 + danger 色，警告用 `warning-soft` 底 + warning 色 |
| `workspace.css:322-369` `.modal__actions` 按钮 | 高 32、r6；次要按钮 = `surface` 底 + inset border，hover 时描边变 `border-strong`；`.modal__primary` = accent 实心；`.modal__danger` = danger 实心，文字暗色用 `#0c0d10`、亮色用 `#fff`（也就是 `--accent-contrast`，两套主题对 danger 都 ≥6.5:1）。一组按钮里只能有一个实心按钮 |
| `src/components/ConfirmDialog.tsx` | 结构不变；需要输入名称确认的场景，用 38 高的字段，标签放在字段上方 |
| `workspace.css:243` `.failure-toast` 和 `pluginBridge.css:1` `.plugin-toast` | 合并到同一套规格：宽 380，内边距 12/14，r8，`surface-raised` 底 + `shadow-md`，右下角 16；左侧放状态图标（success / danger / info），粗体标题 + muted 说明 + 可选的 accent 文字动作；关闭按钮是 faint 色图标，hover 时换成 `surface-hover` 底。`plugin-toast` 的关闭按钮现在用的是 20px 字符，改成 16 的图标 |

## 对比度

T5 已覆盖的组合不重复列出，这里只列这四个界面新出现的组合。计算方法与 `../obsidian-contrast.mjs` 相同，半透明底先按实际铺设的底色合成再算。

| 组合 | 暗色 | 亮色 |
| --- | ---: | ---: |
| 危险按钮文字 / danger | 8.51 | 6.50 |
| warning 文字 / warning-soft | 8.62 | 5.74 |
| muted 说明 / warning-soft | 6.64 | 7.88 |
| danger 文字 / danger-soft | 6.69 | 5.72 |
| muted 说明 / danger-soft | 7.22 | 7.78 |
| success 徽标 / success-soft | 7.41 | 5.35 |
| info 图标、文字 / accent-soft | 6.71 | 5.68 |
| muted / accent-soft（Quick Open 候选副标题） | 6.70 | 7.55 |
| text / 分段选中段（暗色 `#2a2c33`） | 11.91 | — |
| kbd muted / surface | 8.05 | — |

需要注意的两点：

1. **faint 文字落在 accent-soft 上，暗色只有 4.39:1，不达标。** 所以键盘候选行里的副标题和 kind 要提到 `--text-muted`（6.70:1），稿里已经这样处理。凡是 faint 文字可能落在 `accent-soft` 上的地方（下拉候选、Quick Open），都要照此处理。
2. **开关关闭态的描边刚过非文本 3:1 的线。** 对画布是 3.11:1（暗）/ 3.18:1（亮），对 `panel` 是 3.03 / 3.05，落在 `surface` 底上只有 2.88 / 2.89，状态全靠描边识别会不够。所以稿里的关闭态同时让滑块用 `text-muted` 色（对各种底都 ≥7:1），状态靠滑块位置和滑块颜色表达，不只靠描边。前端实现时不要把关闭态的滑块调淡。

## 截图验证

`shots/` 里的截图都用无头 Chrome 渲染（独立临时 profile，结束后删除），4 个页面 × 亮、暗、标注共 12 张，逐张目视检查过。画面只依赖本地字体和相对路径，没有外部请求。这是 HTML 原型的渲染效果，不能代替真实 WebView 里的验收。

---

# T19 补充：设置其余分区稿 `settings-sections.html`

和 `settings.html` 共用同一套导航、分组卡片、设置行和控件规格（`obsidian.css`）。分区特有的结构写在 `sections.css`。

## 打开方式

- `settings-sections.html?section=provider|project|hooks|shortcuts|backup|environment|about`，可以和 `theme=dark|light`、`spec=1` 组合使用；左侧导航也能直接点击切换。「外观」和「插件」链接到原有的 `settings.html`、`plugins.html`。
- `shots/sections-<分区>-{dark,light,spec}.png` 共 21 张，尺寸 1440×1200。
- 文案都取自现有 `src/i18n/locales/zh-CN/*.json`，没有新增功能。演示数据使用 `example.invalid`。

## 所有分区通用的变化（相对现状）

| 现状 | 稿子 | 原因 |
| --- | --- | --- |
| 内容区是一整块铺开的纯文字和细线（`.settings-card` 只有上下边线） | 每组用 **group 卡片**包起来：r8 + `panel` 底 + 1px `border` 内描边，行内用 `border-soft` 分隔 | 和 settings.html / plugins.html 统一；纯文字和细线在 1440 宽下层次太平 |
| 内容区宽度铺满（最宽约 1100px） | 页面**最大宽 880px**，内边距 32 | 行太长时右侧动作离标签太远，读起来费劲 |
| 页头下的说明是裸文字段落 | 改为 **notice**：中性说明用 info（accent-soft 底），风险提醒用 warning-soft | A14：说明、提醒和正文区分开 |
| Agent 名前没有图标，或者每个分区自己画一套 | 统一用 **28px 图标块**（r6、`surface` 底、内描边），Claude Code 用 `#d9825b` | 和工作台侧栏的会话图标块是同一种语言 |
| 状态是纯色文字（比如「可启用 Hook」蓝字） | 统一改为 **徽标**：`tag` 加 `ok` / `warn` / `err` / `accent` 四档 | 状态不能只靠颜色表达，徽标有底色和字形 |
| 每行的动作按钮有大有小、有实有虚 | 一个区域**只有一个实心主按钮**，其余用次要（surface + 描边）或幽灵按钮，统一 32 高 | 和 T10 规格一致 |

## 各分区

| 分区 | 稿子要点 | 源码 | 主要选择器和令牌 |
| --- | --- | --- | --- |
| **全局 Provider** | 页头：刷新按钮（幽灵）+「新增 Provider」（唯一实心）；Agent 切换用 6 段等分的分段控件（32/26）；「当前选择」放进 group，单行，右侧显示 `accent` 徽标「已选用」；自定义服务**保留卡片网格**：r12、`panel` 底、内描边，选中卡为 `sidebar-active` + `border-strong` 描边 + 2px 竖条；卡片底部是「已选用」徽标或次要「启用」按钮，加编辑和更多两个幽灵按钮；「高级配置」单独一行 | `src/provider/components/ProviderSection.tsx`、`ProviderCard.tsx`、`src/provider/provider.css` | `.provider-card` 的圆角改为 `--radius-lg`，背景改为 `--panel`；选中态的 `.provider-card__selection` 改为竖条表达；分段控件复用 T12 的 `.appearance__segments` 规格。**`ProviderCard.tsx` 和 `shatterCard.ts` 的翻转、碎裂动效不要动**，只改静态样式 |
| **项目 Provider** | 项目头放进 group（名称 + 等宽路径）；环境变量覆盖提醒改为 warning notice；各 Agent 一行：图标块 + 名称 + 状态徽标（跟随全局 / 项目覆盖 / 已删除）+ 第二行说明（端点和模型用等宽字）+ 右侧 38 高下拉；失效选择时下拉用 danger 描边，说明改为 danger 色 | `src/provider/project/ProjectProviderSection.tsx`、`projectProvider.css` | `.project-provider__agent` 改为 group 内的行；`.project-provider__source` 改为 tag；`.project-provider__error` 让字段带 `aria-invalid`，复用 T12 的字段错误规格 |
| **会话状态（Agent Hooks）+ 后台任务** | 介绍文字改为 info notice；每个 Agent 从一个大块改为 **group 内一行**：图标块 + 名称 + 状态徽标（已连接 ok / 可启用 accent / 屏幕推断 / 未检测到）+ 「已安装 n/m 个事件 · 版本号（等宽）」+ 可展开的「配置位置」（等宽路径框）；行尾动作：可启用的是次要「预览启用」，已连接的是 danger 色幽灵「预览移除」；**后台任务**单独分组，每行 56 高：状态点 + 名称 / 等宽路径 + 状态徽标 +「结束」（danger 幽灵）或「清除」 | `src/agent/hooks/HookSettingsSection.tsx`、`HookCards.tsx`、`hooks.css`；`src/terminal/daemon/BackgroundSessions.tsx`、`daemon.css` | `.hook-agent-card` 改为行；`.hook-agent-card__summary` 里的状态文字改为 tag；`.hook-config-path` 用 `surface` 底 + 等宽字；`.background-sessions__list` 改为 group；`.daemon-button` 改为 `.btn` 规格（32、r6）。Hook 变更预览弹窗（`.hook-preview`）沿用 T12 的 `.modal` 规格 |
| **快捷键** | 平台说明改为 info notice（标题行 + 说明行）；每个分组用一个 group；行内是名称 + 徽标（默认 / 自定义 / 已停用），右侧是键帽（24 高，按键拆开显示）+「更改」幽灵按钮；**录制态**：整行 `accent-soft` 底，键帽加 2px accent 环，第二行显示「请按下新的组合键…」，冲突时第三行用 danger 字说明，行尾为取消 + 保存（实心；冲突时禁用）；折叠的分组是一行（名称 +「9 项 · 展开」） | `src/shortcuts/custom/ShortcutSettingsSection.tsx`、`ShortcutEditor.tsx`、`shortcutSettings.css` | `.shortcut-settings__rows` 改为 group；`.shortcut-settings__keys` 里每个键单独一个 `kbd`；`.shortcut-editor` 改为行内录制态，不另起卡片；「全部恢复默认」保持次要按钮，没有自定义时禁用 |
| **本地备份** | 页头右上角的两个按钮**挪进内容区**，变成两张动作卡（导出 / 从备份恢复），每张有图标块、标题、说明和按钮：导出是实心，恢复是次要；**恢复预览**是 group 内的复选行（只有现有的「工作区」「外观」两个域），下方是取消 +「安排下次启动恢复」；已安排时显示 warning notice + 「取消安排」；可撤回时（`backup-undo`）同样用 notice 结构 | `src/backup/BackupSection.tsx`、`BackupRecovery.tsx`、`backup.css` | `.backup-actions` 从页头移到内容区，`.backup-card` 改为 `.action-card` 规格；`.backup-domain` 改为复选行；`.backup-recovery` / `.backup-undo` 改为 notice。复选框复用 `components/controls` 的 Checkbox（T12 已更新规格） |
| **协作环境** | 页头加一句说明（现在没有）；右侧是重新检查（幽灵图标按钮）+「同步全部 skill」（实心）；**总状态**放进 group：32px 圆形图标，按 ok / warning / error 三态换色，加标题和计数；**检查项**是 group 内的行，每行 56 高：状态图标 + 标题 + 说明。按现有能力，**行内没有单项动作**，动作只在页头 | `src/setup/EnvironmentSection.tsx`、`environment.css` | `.environment-summary` 改为 group 内的 summary；`.environment-checks` 改为行；`.environment-checks__icon` 按 `state` 换色；页头说明需要新增一条 i18n 文案（中英文都要加） |
| **关于（含更新）** | 产品块放进 group：48px 圆角 logo、标题、一句话描述、版本徽标；右侧三个链接用幽灵按钮，「检查更新」是唯一实心按钮；**有新版本**时显示 info notice +「下载并安装」，状态和文案来自现有 `updaterState`；Agent CLI 是 group 内的行，每行 60 高：图标块 + 名称 / 当前版本（等宽）+「最新版本」列 + 右侧状态（「已是最新」用 ok 色加图标）或次要的升级 / 安装按钮；「全部升级」放在列表下方，用次要按钮 | `src/about/AboutSection.tsx`、`about.css` | `.about-app` 改为 hero 规格；`.about-app__version--available` 改为 info notice；`.about-card` 改为 `.cli` 行；`.about-card__install` 按 T10 的按钮规格 |

## 实施边界（T20）

- 不改设置导航、外壳、外观页和共用控件（`components/controls`、`settings.css`、`settingsShell.css`、`obsidianSurfaces.css`）。如果需要新增共用的 group、行、notice 类，先和 UI设计工程对齐，再放进 `obsidianSurfaces.css`，不要在各分区里各写一套。
- 未保存保护（`onGuardChange`）、焦点归还、Provider 翻转和碎裂动效、Hook 变更必须先预览、备份恢复安排在下次启动生效，这些行为一律不改。
- **本稿新增的文案只有一处：** 协作环境页头的说明「检查 Agent CLI、belfry 命令与 skill 是否就绪。」实施时需要中英文各加一条。其余文案都是现有文案。
- 对比度：这几个分区用到的组合都已经在 T5 和 T10 核算过（徽标、notice、faint 字落在 accent-soft 上要提到 muted 等），没有新增颜色。
