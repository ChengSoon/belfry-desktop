# Belfry UI 精修方案：统一 Graphite 的层级与交互

日期：2026-11-12。房间「UI设计」T1，交付为审计与实施规范；本任务只新增此文档。

## 设计结论与依据

延续 **石墨深色 / 暖白浅色 + 低饱和 sage 强调色**。高级感来自可预测的层级、精确对齐、稳定的阅读密度和反馈节奏。主工作台保持「工作区 → 项目 → 会话 → 终端内容」的顺序，设置保持「分类 → 页面标题 → 分组 → 控件」的顺序，房间保持「上下文 → 待处理 → 对话 → 输入」的顺序。

现有生产 UI 已有 Graphite 主题、字号变量、共用面板外壳与控件，适合分批精修。保留 Belfry 原图标、HarmonyOS Sans SC 400/500、现有等宽字体、用户字体/字号/壁纸偏好。产品界面的内容仍来自真实业务数据。

依据：[原型设计规范](design-spec.md)、[品牌资产说明](brand-spec.md)、[生产落地记录](../production-ui/README.md)，以及 `src/styles.css`、`src/theme/`、`src/typography/` 和各模块 CSS/相关组件。历史文档的“当前主色为蓝色”“尚未生产落地”描述只适用于当时原型阶段；本次以当前 `src/` 为准。

此次实际查看了历史生产截图 `../production-ui/screenshots/workbench-dark-1440x960.png`，其余判断来自当前源码静态审计。历史截图用于理解设计方向，不能当作当前版本运行截图。当前版本主工作台、设置、房间的双主题截图基线由 T2 提供。

## 现状审计

下列位置以本次读取的工作区为准。优先级：P0 为基础一致性/可读性，P1 为跨模块视觉统一，P2 为专项精修；“设计取舍”需要结合新版基线评估，不等同于已确认功能缺陷。

| 编号 / 优先级 | 证据（仓库根目录相对路径:行号） | 问题与影响 | 建议 |
| --- | --- | --- | --- |
| A01 / P0 | `src/styles.css:107`、`src/styles.css:140`；`src/theme/ThemeProvider.tsx:15`；`public/startup.js:11`；`index.html:6` | CSS/xterm 使用 `#171a19` / `#fcfbf7`，首帧和 React 写入的 meta theme-color 仍为 `#0a0a0b` / `#fafafa`。宿主读取 meta 时存在底色不一致风险；是否出现原生接缝需 WebView 验证。 | 同步四处主题数据；将首帧、运行时、xterm 的画布契约纳入同一校验。 |
| A02 / P0 | `src/styles.css:96`；`src/rooms/view/room.css:15`、`src/rooms/view/room.css:23`、`src/rooms/view/room.css:33`；`src/rooms/tailwind.css:43` | 房间混用固定 11/12px、自定义 rem 和已映射的 Tailwind 字号。默认根字号为 14px，`0.6875rem` 实际为 **9.625px**，`0.875rem` 为 **12.25px**；与辅助文字至少 12px 的既有规范不同，且随设置缩放的方式不一致。 | 房间正文/元信息/状态映射到 `--fs-md/sm/xs`；默认正文 14px、辅助 12px 起。保留用户主动选择小字号的既有能力。 |
| A03 / P0（排期受并行改动约束） | `src/remote/remote.css:4`、`src/remote/remote.css:8`、`src/remote/remote.css:28` | remote 采用 11/12/13/15/16px 固定字号，自定义 7/9px 圆角、按钮和表单尺寸，难以跟随外观设置。 | 记录为后续接入项；由 remote 当前维护者在功能稳定后使用同一令牌。本轮不编辑未提交的 remote/rooms 内容。 |
| A04 / P1 | `src/styles.css:99`、`src/styles.css:204`；`src/provider/provider.css:50`；`src/rooms/view/room.css:32`、`src/rooms/view/room.css:37` | 中文只有 400/500 且关闭字重合成，局部标题指定 600 无法得到预期字重，中文和拉丁文字可能表现不同。 | 宿主标题/选中项统一 500，用字号、留白和前景色拉开层级；JetBrains Mono 的真实 600 仅保留在适合的代码/终端强调中。 |
| A05 / P1 | `src/plugins/center/styles/tokens-01.css:110`；`src/plugins/center/styles/graphite.css:2`；`src/plugins/center/styles/scope-01.css:127` | 插件中心已桥接主背景/文字/语义色，但仍有自有 150/200/300ms 动效、未桥接的特殊表面/阴影等。不能据原始 tokens 中存在色值就断言实际颜色错误，要检查最终级联。 | 扩展宿主 `.pi-plugins` 桥接，覆盖实际使用的阴影、特殊表面、圆角与动效；第三方 iframe 保持自身主题能力。 |
| A06 / P1 | `src/plugins/center/styles/page-01.css:219`、`src/plugins/center/styles/page-01.css:222` | `.pi-plugins :root[data-theme="light"]` 要求文档根在插件容器内部，不会匹配正常文档；这两条浅色搜索样式失效。基础样式仍生效，不能据此推断搜索完全无样式。 | 改为根主题在前的选择器，或直接使用语义变量消除主题分支。 |
| A07 / P1 | `src/plugins/pluginBridge.css:1`；`src/plugins/center/styles/scope-01.css:127`；`src/shortcuts/shortcutGuide.css:67`；`src/styles.css:125` | toast、插件浮层、快捷键装饰各写黑色透明阴影，未随亮/暗主题采用共用 elevation；同级菜单的深浅和厚重程度不一致。 | 菜单/提示共用 `--shadow-md`，模态共用 `--shadow-lg`，行内状态不加投影；键帽内阴影明确为独立装饰例外。 |
| A08 / P1 | `src/settings/settings.css:41`、`src/settings/settings.css:48`；`src/provider/provider.css:73`；`src/provider/provider.css:217`；`src/plugins/center/styles/graphite.css:51` | 很多现有 6/8/10px 值本身符合规范，但仍直接写数值；另有 7px 控件圆角。统一修改令牌时会漏掉这些局部规则。 | 合法值换为现有 radius 变量，7px 默认归入 6px 控件档；全屏轨道保持直角、胶囊/头像作为明确例外。 |
| A09 / P1 | `src/components/controls/fields.css:8`；`src/settings/settings.css:48`；`src/workspace/quietSidebar.css:19`；`src/panel/panelShell.css:24`；`src/layout/layout.css:64`；`src/workspace/workspace.css:160` | 输入 38px、导航 40px、工具 36px、面板头 44px、终端把手 36px、工作台头 60px，各有用途但缺少“尺寸角色”契约；后续容易把不同角色强行拉齐，或继续增加近似尺寸。 | 提供尺寸角色令牌并保持现有有效值，按内容用途配对；大字号允许增高，不一刀切成同一高度。 |
| A10 / P1 | `src/workspace/quietSidebar.css:8`；`src/panel/panelShell.css:27`；`src/quickopen/quickOpen.css:39`；`src/workspace/sshDialog.css:160` | 14px 间距、7px gap、13/14px 内边距、17px 弹窗内边距分散。部分是光学校正，但目前没有区分布局节奏与图标/边框补偿。 | 布局采用 4px 基础、8px 主节奏；2px 仅微调，1/3px 仅边框/命中/分屏补偿。逐个核对，保留有依据的例外。 |
| A11 / P1 | `src/styles.css:83`；`src/components/motion/motion.css:2`；`src/components/workbench.css:54`；`src/settings/settings.css:48`；`src/components/motion/Presence.tsx:6` | `--duration/--ease`、`--motion-*`、插件 `--motion-duration-*` 及局部 110/140ms 并存。退出时长还与 JS 中的 180ms 生命周期绑定。 | 统一基础 motion 命名并保留旧变量别名；本轮默认不改 180ms 退出值。任何改动必须同时处理 Presence 定时器、焦点释放和测试。 |
| A12 / P2（设计取舍） | `src/provider/components/ProviderCard.tsx:89`、`src/provider/components/ProviderCard.tsx:93`；`src/provider/components/shatterCard.ts:19` | Provider 切换含约 520ms 立体翻转，删除含 1050ms 碎裂，明显长于原规范的 120–160ms 交互反馈。两者已有 reduced-motion 保护，也有现存交互测试，属于既有产品行为。 | 默认方案保留当前行为，先统一周边样式；后续若决定收敛为 140–220ms 的状态反馈，需要单独变更交互验收，不能顺手删除。 |
| A13 / P2（层级取舍） | `src/workspace/sidebar.css:178`；`src/workspace/quietSidebar.css:13`；`src/settings/settings.css:52`；`src/quickopen/quickOpen.css:110` | 会话/设置选中态主要是中性填充，Quick Open 是强调底色 + 2px 侧标。它们的用途不同，但“当前位置”与“当前键盘候选”的区别没有形成明确规范。 | 持久当前位置采用中性填充 + 500 字重，导航图标可着强调色；键盘候选采用强调软底 + 2px 侧标；鼠标 hover 只用 hover 表面。保持可见焦点环。 |
| A14 / P2（状态层级） | `src/git/git.css:41`；`src/remote/remote.css:16`；`src/settings/settings.css:57` | 错误/警告分别采用边框块、纯文字、侧边竖线；相同严重程度的密度和动作位置不同。 | 定义共用 notice 密度和语义规则：图标、简短原因、恢复动作；内联字段错误继续贴字段显示，不强制全部卡片化。 |
| A15 / P1 | `docs/design/belfry-ui/brand-spec.md:8`；`docs/design/belfry-ui/design-spec.md:11`；`docs/design/production-ui/README.md:5` | 历史品牌/原型文档称蓝色为当前主色，生产记录与代码已使用 sage，容易引导新页面继续分裂。 | 保留历史文件语境，在后续维护中标明“原型阶段快照”；新实现引用当前 refresh 规范和生产令牌。 |

### 不应机械替换的色值

- `src/theme/xtermTheme.ts:19` 起的终端调色板包含 ANSI 16 色、光标/选区、滚动条及 OSC 契约。代码语义色与 UI 强调色分别管理，画布/前景/滚动条需要一致性校验。
- `src/filepreview/filePreview.css:129` 起的语法高亮是双主题内容色；可归入 `--syntax-*` 命名，保留代码语义区分，不统一改成 sage。
- `src/rooms/view/room.css:110` 起的 HSL 头像用于成员身份。应验证对比度与明暗适配，不全部变成相同绿色。
- `src/workspace/workspace.css:151` 的 Windows 关闭按钮红色是平台交互反馈；`src/diagnostics/diagnostics.css:1` 起的回退色用于样式未就绪时的恢复界面。这些不是普通硬编码污染。
- 透明色、1px 边框、滚动条命中区域和分屏补偿均需按用途判断，不能仅凭“不是 8 的倍数”删除。

## 统一设计令牌提案

以下是**拟议规范**，尚未写入生产代码。颜色保留现有主方向与画布，优先使用已有变量名；扩大文字层级差异是独立的可评审精修。亮/暗共用排版、间距、圆角和时序，只切换颜色与投影强度。

### 中性色与语义映射

深色采用带少量暖绿的石墨阶梯，从深到浅：`#171a19` → `#191c1b` → `#202422` → `#242927` → `#2c322f` → `#38413b` → `#56635a` → `#a0aaa3` → `#b9c2bb` → `#edf0eb`。浅色采用纸白与灰绿墨色，以语义映射对应明暗，不将同一个数字阶梯简单反转。

| 令牌 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--canvas` | `#171a19` | `#fcfbf7` | 工作主区、终端底色；与 xterm 同步 |
| `--panel` | `#191c1b` | `#f8f7f2` | 上下文面板、工作台头部 |
| `--sidebar` | `#202422` | `#eeeee7` | 会话/设置导航轨道 |
| `--surface` | `#202422` | `#f1f1eb` | 成组控件、次级容器 |
| `--surface-raised` | `#242927` | `#fcfbf7` | 菜单、popover、对话框 |
| `--surface-hover` | `#2c322f` | `#e4e7de` | hover、次级交互背景 |
| `--sidebar-active` | `#2c322f` | `#e4e7de` | 持久当前位置，配字重和图标 |
| `--border` | `#38413b` | `#d1d7cc` | 普通分隔、容器收边 |
| `--border-strong` | `#56635a` | `#8d9c8e` | 控件 hover、焦点窗格、可操作边界 |
| `--text` | `#edf0eb` | `#252d28` | 主要正文、标题 |
| `--text-muted` | `#b9c2bb` | `#4d5a51` | 描述、次级信息；较现有值拉开层级 |
| `--text-faint` | `#a0aaa3` | `#5e695f` | 元信息、时间、路径辅助；仍要求可读 |
| `--text-icon` | `var(--text-muted)` | `var(--text-muted)` | 常规图标；装饰图标可用 faint |
| `--scrollbar` | `#56635a` | `#8d9c8e` | 全局与 xterm 滑块基础色 |
| `--card` / `--card-border` | raised / border 的别名 | canvas / border 的别名 | 有明确分组作用的卡片；避免每一行都围框 |

浅色 raised 从现有 `#f8f7f2` 调整为纸白，拉开与 panel 的差别；工作台 canvas 保持原值，避免终端选区/透明背景/OSC 重新定标。`--text-faint` 不通过 opacity 继续变淡，禁用态才使用独立透明度。

### 强调、状态与交互

| 令牌 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#b2d5b6` | `#285d37` | 主要动作、选中图标、键盘焦点 |
| `--accent-hover` | `#c7e4ca` | `#1e4b2b` | 主要动作 hover；替代 `filter: brightness()` |
| `--accent-contrast` | `#18271c` | `#ffffff` | 实心主要按钮文字 |
| `--accent-soft` | `#314b38` | `#e0ecdf` | 当前键盘候选、轻量强调背景 |
| `--success` | `#b2d5b6` | `#285d37` | 成功/已完成，配勾选图标和状态文字 |
| `--warning` | `#e7c182` | `#805713` | 待你选择、需要处理、警告 |
| `--danger` | `#f2a39b` | `#a42f27` | 错误、危险动作文字 |
| `--danger-hover` | `#ffc0b9` | `#84251f` | 危险动作 hover |
| `--info`（新增） | `#acbbeb` | `#3958a6` | 仅信息提示，避免与主要动作竞争 |
| `--scrim` | `rgb(8 12 10 / 64%)` | `rgb(25 35 28 / 28%)` | 模态遮罩；窄窗抽屉可新增 `--scrim-drawer` 为 36% / 20% |

一个操作区域原则上只有一个实心主要动作。次级按钮使用 surface + border，低频动作使用无底色按钮，危险确认使用明确文字与 danger；“已配置”“已选用”“连接已验证”继续分别表达。成功色和动作色可相同，因为图标与文字共同承担语义。

对上表不透明颜色进行了 sRGB 相对亮度计算：六类标准表面（canvas、panel、sidebar、surface、raised、hover）上的最小文字对比度如下。该计算不包含壁纸、透明混色、实际字体光栅化和全部控件状态，不代替浏览器/原生验收。

| 最小对比度 | 深色 | 浅色 |
| --- | ---: | ---: |
| text | 11.38:1 | 11.30:1 |
| text-muted | 7.17:1 | 5.79:1 |
| text-faint | 5.47:1 | 4.58:1 |
| accent | 8.16:1 | 6.19:1 |
| warning / danger / info | 7.70 / 6.54 / 6.89:1 | 5.10 / 5.57 / 5.38:1 |
| 实心主按钮文字（accent-contrast / accent） | 9.72:1 | 7.75:1 |

细分隔线用于组织内容，不承担全部控件识别。对于必须靠描边识别的输入/开关，需要单独测非文本对比度；必要时增加 `--control-border`，不能把普通 `--border` 当作已满足 3:1。焦点使用 2px accent 环、2px offset；紧凑菜单可内缩 2px，保证不被裁剪。

### 字体、图标与密度

默认尺寸沿用现有 `typographySizeTokens()` 的 **12 / 13 / 14 / 15 / 20px**，不新增固定字号覆盖用户偏好。使用字号变量而不是以 16px 为前提的 rem 换算。两种主题规格相同。

| 令牌 / 规格 | 默认值 | 用途 |
| --- | --- | --- |
| `--fs-xs` | 12px / 行高 1.5 | 时间、来源、分组标签、路径元信息 |
| `--fs-sm` | 13px / 行高 1.5 | 紧凑菜单、工具、终端标题 |
| `--fs-md` | 14px / 行高 1.5–1.6 | 正文、表单标签、会话名 |
| `--fs-lg` | 15px / 行高 1.5 | 面板标题、设置区块标题 |
| `--fs-display` | 20px / 行高 1.4 | 设置页面标题、品牌字 |
| 正文 / 强调 | 400 / 500 | 中文无合成粗体；标题常规负字距限西文显示标题 |
| 等宽 | 现有 `--font-mono` / `--font-terminal` | 路径、命令、配置、终端；金额/计数使用 tabular-nums |
| 图标 | 现有 `ICON.xs/sm/md/lg`：16/17/18/19px | 先消除 JSX 的零散 size；尺寸跟随字号设置的问题另作统一适配，不新增第三套尺寸 |

继续由 `src/typography/TypographyProvider.tsx` 写入五档字号。默认 12px 辅助文字下限是设计标准；用户主动设置的小字号保留既有缩放/10px 兜底规则，不能在单个模块强行重置用户选择。

### 间距、尺寸、圆角

两种主题使用同一尺寸体系。空间令牌建议新增：`--space-0: 0`、`--space-1: 4px`、`--space-2: 8px`、`--space-3: 12px`、`--space-4: 16px`、`--space-5: 20px`、`--space-6: 24px`、`--space-8: 32px`、`--space-10: 40px`、`--space-12: 48px`；微调另用 `--space-hair: 2px`。页面分区采用 24/32px，行内容 12/16px，文字与图标 8px，关联标签与说明 4px。

| 角色令牌 | 默认值 | 应用方式 |
| --- | --- | --- |
| `--control-height-sm/md` | 32 / 38px | 紧凑按钮 / 表单字段；大字号时为 min-height |
| `--row-height-nav` | 40px | 会话、设置导航；使用 min-height |
| `--toolbar-height` | 60px | 工作台头部；平台 titlebar inset 另加 |
| `--panel-header-height` | 44px | 右侧面板头部；必要时允许长标题换行增高 |
| `--pane-header-height` | 36px | 终端拖拽把手；保持终端布局行为 |
| `--radius-xs/sm/md/lg` | 4 / 6 / 8 / 10px | 微控件 / 控件 / 浮层与分组 / 对话框与 Provider 卡片 |
| `--radius-full`（新增） | 999px | 计数徽标、头像、键帽中的胶囊形态 |

全屏设置/房间、终端主画布、导航轨道不加大圆角。圆角只表达容器边界，不通过多层圆角卡片叠加表达信息层级。现有 220px 设置导航、用户可调整的侧栏/面板宽度继续保留；不要为了统一比例覆盖用户持久化的宽度。

### 阴影与动效

| 令牌 | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--shadow-sm`（新增） | `0 1px 3px rgb(0 0 0 / 18%)` | `0 1px 3px rgb(41 54 37 / 8%)` | 少量小浮层；普通列表不用 |
| `--shadow-md` | `0 8px 24px rgb(0 0 0 / 22%)` | `0 8px 24px rgb(41 54 37 / 10%)` | 菜单、popover、toast |
| `--shadow-lg` | `0 24px 64px rgb(0 0 0 / 36%)` | `0 24px 64px rgb(41 54 37 / 16%)` | 对话框、窄窗抽屉 |
| `--motion-fast` | 120ms | 120ms | 按压、键盘候选反馈 |
| `--motion-standard`（新增） | 140ms | 140ms | hover、边框、主题表面反馈 |
| `--motion-enter` | 220ms | 220ms | 抽屉/对话框进入，位移控制在 4–12px |
| `--motion-exit` | 180ms | 180ms | 退出，与 `Presence.EXIT_MS` 契约一致 |
| `--motion-ease` | `cubic-bezier(.2, .8, .2, 1)` | 同深色 | opacity、transform、交互反馈 |

旧 `--duration` 映射到 standard，旧 `--ease` 映射到 motion-ease；插件宿主的 fast/normal/slow 分别桥接 fast/enter/enter，退出显式使用 exit。迁移时逐项核对实际用途，避免只改变量名导致生命周期失步。Provider 既有 3D/碎裂暂为记录在册的例外。

reduced-motion 下取消位移、缩放、呼吸和旋转，保留静态状态、焦点和文字反馈。布局宽度/终端网格不做逐帧动画，保持现有一次 resize 和终端挂载规则。不要在终端输出区域、原生窗控或第三方插件中全局注入按压缩放。

## 分批实施清单

此表用于统筹后续派活，不表示这些批次已实施。remote/rooms 目前存在未提交的并行功能改动，涉及这些文件的批次需先由当前维护者合流；本任务不修改它们。

| 顺序 | 范围与主要文件 | 可交付结果与验收 |
| --- | --- | --- |
| 0 · P0 | 采用 T2 截图设施，主工作台/设置/房间，亮暗两套 | 同一合成数据、字体就绪、主题过渡结束后截图；记录窗口/平台/缩放/数据适配器，覆盖 1440×960、1024×768、820×768。保存改造前图，后续逐批对照。 |
| 1 · P0 | `styles.css`、`ThemeProvider.tsx`、`public/startup.js`、`index.html`、主题测试 | 修复 A01；新增 space/size/radius/motion 别名。第一批保留现有画布与 ANSI 色；若采纳文字/raised 精修则整批对照双主题。补首帧/运行时/xterm 一致性、基础文字与状态色对比检查。 |
| 2 · P0/P1 | `rooms/view/room.css`、房间 JSX、`rooms/tailwind.css`；remote 后续另批 | 合流后修复 A02–A04：正文/状态/历史不低于默认字号规范，设置放大时跟随，成员/任务/待选项长文本不裁剪，窄窗主动作能命中。保持房间逻辑与 IPC 契约。 |
| 3 · P1 | `components/controls/fields.css`、`settings/*.css`、`workspace/*.css`、`panel/panelShell.css`、`layout/layout.css` | 控件高度、布局间距、圆角统一到角色令牌；工作区/项目/会话层级清晰。设置焦点、未保存保护、侧栏折叠与终端拖拽通过；不改 PTY 生命周期。 |
| 4 · P1 | `plugins/center/styles/{graphite,page-01,scope-01,scope-02,page-03,page-05,page-07,controls-01}.css`、`plugins/pluginBridge.css` | 修复 A05–A08：宿主令牌桥接完整、浅色选择器有效、菜单/模态/toast 使用同级投影。安装、设置、权限、市场、详情均能操作；第三方 iframe 样式不被覆盖。 |
| 5 · P1/P2 | `history`、`usage`、`git`、`filepreview`、`quickopen`、`shortcuts`、`provider` 的样式 | 统一元信息/错误/空状态和选中语义；保留语法色、路径等宽、金额对齐、Provider 配置/选用/验证差异。先保留现有 Provider 动效与卡片结构。 |
| 6 · P2 | 文档维护、专项交互精修 | 标注旧文档阶段，汇总例外；依据基线评估 Provider 专项动效、头像色板、壁纸上的对比度和原生标题栏材质。原生窗口改动由 T2 负责验证，避免与前端尺寸调整重复。 |

首轮优先实施 A01、A02（合流后）、A06 与统一基础令牌，收益直接且边界明确。更换整体品牌色、全量组件重写、删除既有 Provider 动效，不列入首轮。

## 验证约定与本次完成情况

实施后的每批核查：深/浅主题，默认/最大设置字号，中/英文长标题，标准/窄窗，鼠标/键盘，reduced-motion。重点验证菜单/弹窗的焦点归还与 Escape、未保存编辑器、待确认操作、终端 DOM 持续挂载、无页面级横向溢出。原生 Windows/macOS 窗控、200% 系统缩放、真实 PTY 与材质效果另列验收；浏览器截图不代替它们。

可复用现有设施：

```sh
pnpm exec vitest run src/theme/graphite.test.mjs src/theme/xtermTheme.test.ts src/settings/SettingsPanel.test.ts src/settings/SettingsPanel.interactions.test.tsx
pnpm build
node --test --test-concurrency=1 src/components/lazy/testing/production-ui.case.mjs
```

浏览器测试依赖仓库已有宿主/Chrome 测试设施，按该设施要求配置环境；最终运行入口以 T2 截图脚本说明及现有 CI 为准。现有 `production-ui.case.mjs` 中的 Graphite 侧栏颜色和 Provider 翻转断言需要按真实设计决策维护，不能仅更新快照来掩盖功能退化。最终集成时执行前端完整测试与 `pnpm build`。

**本任务完成：**源码与历史规范审计、15 项可定位问题/设计取舍、亮暗令牌方案、颜色静态对比计算、优先级及验收计划。本次仅文档变更，检查文件引用/行号及文档 whitespace；未运行产品构建或浏览器测试，不引用历史通过数作为本次结果。
