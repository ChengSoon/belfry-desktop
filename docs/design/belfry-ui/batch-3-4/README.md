# 批次 3–4（T12）：设置 / Quick Open / 插件中心 / 弹窗 / Toast 按 T10 稿落地

设计依据是 `../obsidian-screens/`（HTML 稿和 README 规格）。最终构建为 `dist/assets/index-Du1wrOI_.js` / `index-BYC0OYmW.css`。截图放在 `panels/`，由生产浏览器用例在 `BELFRY_PANEL_ARTIFACTS` 下拍摄。

## 改动

### 新增 `src/components/obsidianSurfaces.css`（在 `App.tsx` 里最后加载）

做法和 T15 的 `obsidianWorkbench.css` 一样：所有选择器前加 `:root` 提高一档特异度，覆盖各模块里旧的 Graphite 尺寸，不去改原文件里和焦点管理、未保存保护、浮层定位有关的规则。颜色全部用令牌。

| 区域 | 落地规格 |
| --- | --- |
| 设置外壳 | **修复 T9 问题 1：** macOS 顶部 28px 让位条改成按列铺色，导航列从窗口顶边开始就是 sidebar 色，内容列是 canvas 色，不再有横向色阶。导航右边线去掉 |
| 设置导航 | 行高 40（`--row-height-nav`），r6；当前项为 `sidebar-active` 底 + 2px accent 竖条 + 500 字重；hover 用 `sidebar-hover`；未保存守卫提示改为 warning-soft 底 |
| 字段、下拉 | 高 38，r6，`surface` 底，内描边用 `border-strong`；hover 时描边变为 `text-faint`；聚焦时外加 2px accent 外环（偏移 2），不再只换描边色；错误时描边为 `danger` |
| 复选、单选、滑块 | 16px 方框和圆点，未选中时为 `border-strong` 内描边；滑块轨道 4px，滑块 14px（canvas 底 + 2px accent 环） |
| 外观页 | 分段控件外框 32、内段 26，选中段为 raised 底 + `shadow-sm` + 500 字重（暗色下用 hover 档，否则看不出来）；**修复 T9 问题 3：**「主题」下拉改为和「语言」一致的 38 高带描边字段 |
| Quick Open | 宽 640，r12，遮罩用 `--scrim`，不再模糊背景，面板距顶部 14vh；搜索栏 52 高、15px 字号、无边框；结果行 44 高，28px 图标框；**hover 和键盘候选分开写：** hover 只换成 `surface-hover`，候选为 `accent-soft` + 2px 圆头竖条 + 500，副标题提到 muted（faint 落在 accent-soft 上暗色只有 4.39:1）；底栏 36 高，`panel` 底 |
| 确认弹窗 | 宽 440，内边距 24，r12，`shadow-lg`；标题从 20 降到 15/500；按钮 32 高、r6；次要按钮为 surface 底 + 内描边；主要按钮 accent 实心；危险按钮 danger 实心，文字用 `accent-contrast`（暗 8.51 / 亮 6.50:1） |
| Toast | `.failure-toast` 和 `.plugin-toast` 统一为宽 380、内边距 12/14、r8、`surface-raised` 底 + `shadow-md`；插件 toast 的关闭按钮从 20px 字符改为 20×20 的图标按钮 |

### 插件中心：`src/plugins/center/styles/graphite.css`（A05–A08）

- **A05 宿主令牌桥接：**
  - `--ds-tile` 改为 `panel`，`--ds-raised-shadow` 改为 `shadow-sm`，开关关闭态底色改为 `surface-hover`；
  - `.pi-plugins` 内的 `--radius-*` 对齐宿主（tokens-01 原本在这里把 lg 定为 10、md-plus 定为 10），`--motion-duration-*` 和缓动桥接到宿主的 `--motion-*`（原来是自带的 150/200/300ms）。
- **A06：** `page-01.css` 里的浅色搜索选择器，当前代码已经是 `:root[data-theme="light"] .pi-plugins …`（根选择器在前），经复核有效，不需要改。
- **A07 投影统一：** 卡片 hover 原来写死 `rgba(0,0,0,.12)`，scope 菜单原来写死 `rgba(0,0,0,.22)`，都改为 `--shadow-md`。
- **A08 圆角：** 卡片和行原来写死 `8px`，改为 `var(--radius-md)`。
- **已安装列表按稿子改为分组列表：** 外框 r8 + `panel` 底 + 内描边，行内用 `border-soft` 分隔，行高至少 68。只有 hover、键盘焦点或菜单展开时整行高亮，鼠标点击后残留的 focus-within 不高亮。
- **开关从 30×18 改为 36×20：** 滑块 14，关闭时滑块保持 `text-muted` 色，状态不只靠描边。
- **内联错误：** 改为 `danger-soft` 底 + 正文色，和宿主 Notice 一致。
- **第三方插件 iframe：** 宿主令牌只写在 `.pi-plugins` 上，和原来一样不注入 iframe，graphite.css 文件头的约定保持不变。

## 验证

| 项 | 结果 |
| --- | --- |
| `pnpm exec tsc -b` | 通过 |
| `pnpm test` | 195 个文件 / 1262 项通过 |
| `pnpm build` | 通过 |
| 生产浏览器用例全量 `src/components/lazy/testing/*.case.mjs` | **30 个文件 / 155 项全部通过**，包括：设置全部栏目（亮暗、紧凑布局）；Provider 保留、替换、清除及未保存保护；插件已安装、权限、市场详情、来源设置；Quick Open 键盘操作；确认弹窗焦点归还；motion 用例里 Quick Open 和确认弹窗的进出场 |
| `obsidian-contrast.mjs` | 退出码 0 |
| `git diff --check` | 干净 |

截图核对（`panels/`）：

- **外观页：** 「主题」下拉已经和「语言」一致；导航当前项为中性底 + 竖条。
- **Quick Open：** 候选行有 accent-soft 底和竖条，hover 行没有竖条。
- **确认弹窗：** 尺寸、圆角、危险按钮唯一实心都对，焦点环正常。
- **插件页：** 截图里插件行是灰底，这是用例点完「详情」后鼠标还停在行上，属于正确的 hover 态。我用探针确认过：鼠标不悬停时行背景透明，衬在 `panel` 色的列表底上。

## 遗留

- 房间页 macOS 顶部的色阶（T9 问题 1 的另一半）在 `room.css`，归 T14 处理。
- 插件市场详情抽屉、模板弹窗等插件中心内部页面，这次只通过令牌桥接自动跟随（圆角、投影、动效、tile），没有按 T10 稿逐像素重排。
- 真实 WebView 渲染还需要原生验收。

---

# T21 补充：设计稿一致性对照 + 插件中心内页重排

最终构建为 `index-Bz9PoRBp.js` / `index-B4vs9kxa.css`。

## 设计稿 vs 实装并排对照

`fidelity/index.html`：把 `obsidian-screens/` 的 settings、quick-open、plugins（已安装列表和详情）、dialogs 四张稿，与实装逐屏并排放在一起，亮暗各一张，每屏下方逐条列出 ✓ 一致项和 △ 偏差及理由。实装截图在 `fidelity/after/`，1440×960，用生产测试夹具拍摄。

主要偏差都写明了理由：

- **外观页的内容、分组卡片和最大宽度：** 设置项不增删；分组卡片和最大宽度随 T20 统一处理。
- **Quick Open 的范围筛选 chip 和分组标题：** 现有模型没有按范围筛选的能力，需要新功能。
- **插件已安装页的常驻两栏详情：** 宿主页是从 PI-Desktop 移植过来的，要做两栏就得重写布局和选中状态模型。
- **作用域与启用开关合在一个控件里：** 拆开会改变交互。

## 插件中心内页按 plugins.html 重排

改动都在 `src/plugins/center/styles/graphite.css` 的「T21」一节：

- **市场卡片：** `panel` 底 + 内描边 + r12；hover 只提一档表面色，不再上浮；键盘焦点显示 2px 外环。
- **市场来源设置：** 用和已安装列表相同的分组外框，行间用 `border-soft` 分隔。
- **详情抽屉：** 按稿里的详情栏规格，宽 380，`panel` 底，左侧 1px 分隔加 `shadow-lg`，遮罩用 `--scrim`；头部是 48px r12 图标块、15/500 标题、等宽 ID；安装条为分组卡，安装是唯一实心按钮；分区标题 12/500 faint，不再全大写加字距；权限每条一行，中/高风险整行用 warning/danger-soft 底；版本列表选中项为 `sidebar-active` + 2px 竖条（A13）。
- **模板、发布、安装弹窗（`plugins-modal`）：** 按 dialogs 规格，宽 440、内边距 24、r12、标题 15/500、按钮 32/r6 右对齐；头部是 accent-soft 的 36px 图标块。
- **单选组（共用控件，`obsidianSurfaces.css`）：** 选中项在 `sidebar-active` 底上再加一圈 `border-strong` 内描边。原因是暗色下弹窗的 raised 底和 `sidebar-active` 只差一档，只靠底色认不出选中项（模板弹窗里实测过）。
- **第三方插件 iframe：** 宿主令牌仍只写在 `.pi-plugins` 上，不注入 iframe，第三方插件页面的样式不受影响。

## code-review L2 / L3 已处理

- **L2（历史详情里每条失败记录都弹一次 `role="alert"`）：** `src/history/details/HistoryChanges.tsx` 里的失败提示改为 `role="status"`，危险色保留。新增单测 `src/history/details/components.test.tsx`「多条失败记录不连续打断读屏」，用三条失败记录断言输出中没有 `role="alert"`。
- **L3（`.workbench` 加了 `overflow: hidden` 后，内部浮层会被裁）：** 在 `src/workspace/workspace.css` 的 `.workbench` 规则上写明了这条约束：子树里的 absolute 浮层超出圆角面会被静默裁掉；现有浮层用 max-height 和 100cqw 收在面内，720×480 下有用例断言；以后新增浮层一律走 `ControlPopover` 的 portal。全量生产用例里的项目切换、更多工具、Worktree 提醒在 720×480 下都通过了不溢出的断言。

## 验证

| 项 | 结果 |
| --- | --- |
| `pnpm exec tsc -b` | 通过 |
| `pnpm test` | 195 个文件 / 1263 项通过（新增 1 项 L2 用例） |
| `pnpm build` | 通过 |
| 生产浏览器用例全量 `src/components/lazy/testing/*.case.mjs` | 30 个文件 / 155 项全部通过（包括插件已安装、权限、市场详情、来源设置，以及英文 720×480 下的市场和模板弹窗） |
| `obsidian-contrast.mjs` | 退出码 0 |
| `git diff --check` | 干净 |
