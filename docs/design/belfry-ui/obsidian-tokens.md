# 曜石 Obsidian · 生产令牌定稿（T5）

用户已选定 B「曜石 Obsidian」作为默认主题。本文档给出亮、暗两套完整取值，以及和 `src/styles.css` 现有变量的逐一映射。前端照此实施即可。令牌结构沿用 `refresh-plan.md`（尺寸、间距、字号、动效体系不变），这里只替换颜色、阴影、圆角，并新增少量令牌。视觉参照见 `directions/workbench.html?dir=b`。

所有对比度由 `obsidian-contrast.mjs` 计算（`node docs/design/belfry-ui/obsidian-contrast.mjs`，全部达标时退出码为 0）。改任何色值都要重跑这个脚本，并把结果贴回本文档。

## 1. 设计要点

- **一体的底：** 侧栏和窗口底色是同一色（`--sidebar` = `--backdrop`），侧栏不再画右边线。
- **浮起的主区：** 工作主区是一块内缩 8px、圆角 12px 的内容面，层次靠 `--shadow-content`（1px 半透明描边 + 顶部高光 + 柔和投影）表达，不再靠分隔线。
- **边框一律用半透明色：** 在任何底色和壁纸上都协调。下表同时给出不透明的等效值，供无法用透明色的地方使用（xterm、原生窗口色）。
- **强调色只有靛蓝一个：** 只用于主要动作、选中标记和焦点。状态色（成功、警告、危险、信息）单独成组，不和强调色混用。
- **选中会话：** 沿用 A 方向的 2px 竖条，竖条用 accent 色，底色用 `--sidebar-active`，详见第 4 节。

## 2. 颜色令牌

「现值」指 `src/styles.css` 当前的 Graphite 值。「新增」表示这个变量现在不存在，要加进 `:root, [data-theme="dark"]` 和 `[data-theme="light"]` 两个块。

### 2.1 表面

| 变量 | 暗色 现值 → **新值** | 亮色 现值 → **新值** | 用途 |
| --- | --- | --- | --- |
| `--backdrop`（新增） | **`#0c0d10`** | **`#ececef`** | 窗口底；body 背景，主区内缩后露出的部分 |
| `--sidebar` | `#202422` → **`#0c0d10`** | `#eeeee7` → **`#ececef`** | 会话和设置导航；等于 backdrop |
| `--canvas` | `#171a19` → **`#131418`** | `#fcfbf7` → **`#ffffff`** | 内容面和终端底色；**必须和 xterm background 一致** |
| `--panel` | `#191c1b` → **`#16171b`** | `#f8f7f2` → **`#fafafb`** | 右侧上下文面板、工作台头部 |
| `--surface` | `#202422` → **`#1a1c21`** | `#f1f1eb` → **`#f4f4f6`** | 成组控件、次级容器、输入框底 |
| `--surface-raised` | `#242927` → **`#1d1f24`** | `#f8f7f2` → **`#ffffff`** | 菜单、popover、对话框（亮色靠阴影分层） |
| `--surface-hover` | `#2c322f` → **`#212328`** | `#e4e7de` → **`#e9e9ed`** | hover、次级交互背景 |
| `--sidebar-hover` | `rgb(237 240 235 / 6%)` → **`rgb(255 255 255 / 4%)`** | `rgb(37 45 40 / 5%)` → **`rgb(20 22 30 / 4.5%)`** | 侧栏行 hover |
| `--sidebar-active` | `#2c322f` → **`#1c1e23`** | `#e4e7de` → **`#e4e4ea`** | 当前会话底色，配 2px 竖条 |
| `--sidebar-active-shadow` | `none` → **`none`** | `none` → **`none`** | 保留变量；选中态不再用阴影，改用竖条 |
| `--card` | `#242927` → **`#1d1f24`**（同 raised） | `#fcfbf7` → **`#ffffff`** | 有分组作用的卡片 |
| `--scrim` | `rgb(8 12 10 / 64%)` → **`rgb(6 7 10 / 64%)`** | `rgb(25 35 28 / 28%)` → **`rgb(20 22 30 / 28%)`** | 模态遮罩 |

### 2.2 边框

| 变量 | 暗色 | 亮色 | 用途 |
| --- | --- | --- | --- |
| `--border` | `#38413b` → **`rgb(255 255 255 / 8%)`**（不透明等效 `#26282e`） | `#d1d7cc` → **`rgb(20 22 30 / 9%)`**（等效 `#e1e1e6`） | 普通分隔、容器收边 |
| `--border-soft`（新增） | **`rgb(255 255 255 / 5%)`** | **`rgb(20 22 30 / 6%)`** | 终端状态条底线等最弱的分隔 |
| `--border-strong` | `#56635a` → **`#60646f`** | `#8d9c8e` → **`#8e909a`** | 输入、开关描边，焦点窗格；非文本对比度 ≥3:1 |
| `--card-border` | → **`var(--border)`** | → **`var(--border)`** | 改为别名 |
| `--scrollbar` | `#56635a` → **`#3a3d45`** | `#8d9c8e` → **`#b4b6bf`** | 全局和 xterm 滚动条滑块；装饰性元素，不要求 3:1 |

### 2.3 文字与图标

| 变量 | 暗色 | 亮色 | 用途 |
| --- | --- | --- | --- |
| `--text` | `#edf0eb` → **`#ecedf0`** | `#252d28` → **`#16171c`** | 正文、标题；xterm foreground 和它一致 |
| `--text-muted` | `#a7b1aa` → **`#b0b2ba`** | `#59645b` → **`#474a54`** | 描述、次级信息 |
| `--text-faint` | `#a0aaa3` → **`#8c8f99`** | `#5e695f` → **`#5b5e68`** | 元信息、时间、路径、计数 |
| `--text-icon` | `#a7b1aa` → **`var(--text-muted)`** | `#59645b` → **`var(--text-muted)`** | 常规图标 |

暗色 faint 比现值暗了不少：refresh-plan 里的 Graphite 把 muted 和 faint 几乎压在一起（`#a7b1aa` 和 `#a0aaa3`），三档文字等于只有两档。曜石把三档拉开到 13.4 / 7.4 / 4.9:1。

### 2.4 强调与状态

| 变量 | 暗色 | 亮色 | 用途 |
| --- | --- | --- | --- |
| `--accent` | `#b2d5b6` → **`#8b93ff`** | `#285d37` → **`#484ed4`** | 主要动作、选中竖条、焦点环、链接 |
| `--accent-hover` | `#c7e4ca` → **`#a5abff`** | `#1e4b2b` → **`#3a40bd`** | 主要动作 hover |
| `--accent-contrast` | `#18271c` → **`#0c0d10`** | `#fff` → **`#ffffff`** | 实心主按钮上的文字 |
| `--accent-soft` | `#314b38` → **`#25284a`** | `#e0ecdf` → **`#ebecfc`** | 键盘候选、轻量强调底 |
| `--focus-ring`（新增） | **`var(--accent)`** | **`var(--accent)`** | 2px 焦点环，偏移 2px |
| `--success` | `#b2d5b6` → **`#5fd4a0`** | `#285d37` → **`#0f6c48`** | 运行中、已完成；和强调色**分开** |
| `--success-soft`（新增） | **`rgb(95 212 160 / 14%)`** | **`rgb(15 108 72 / 10%)`** | 运行中圆点外的光晕、成功徽标底 |
| `--warning` | `#e7c182` → **`#f2c46b`** | `#805713` → **`#835500`** | 待你确认、需要处理 |
| `--warning-soft`（新增） | **`rgb(242 196 107 / 13%)`** | **`rgb(214 150 20 / 13%)`** | 「待确认」徽标底 |
| `--danger` | `#f2a39b` → **`#ff8a80`** | `#a42f27` → **`#b02c25`** | 错误、危险动作文字 |
| `--danger-hover` | `#ffc0b9` → **`#ffaaa2`** | `#84251f` → **`#8f231d`** | 危险动作 hover |
| `--danger-soft`（新增） | **`rgb(255 138 128 / 12%)`** | **`rgb(176 44 37 / 8%)`** | 错误条底色 |
| `--info`（新增） | **`#7ab8f0`** | **`#195f9c`** | 仅用于信息提示；色相 208°，避开强调靛蓝的 236° |

Graphite 里成功色和强调色是同一个值。曜石的强调色是靛蓝，「运行中」改用绿色，于是「我选中的」和「它在跑的」是两种颜色。这是本次必须同步的语义变化：凡是 `var(--success)` 被当作「选中」用的地方，都要改用 accent。

## 3. 阴影与圆角

| 变量 | 暗色 | 亮色 | 用途 |
| --- | --- | --- | --- |
| `--shadow-sm`（新增） | `0 1px 2px rgb(0 0 0 / 30%)` | `0 1px 2px rgb(20 22 30 / 6%)` | 小浮层、分段控件选中块 |
| `--shadow-md` | `0 0 0 1px rgb(255 255 255 / 6%), 0 8px 24px rgb(0 0 0 / 40%)` | `0 0 0 1px rgb(20 22 30 / 7%), 0 8px 24px rgb(20 22 30 / 10%)` | 菜单、popover、toast；自带 1px 描边，浮层不再另加 border |
| `--shadow-lg` | `0 0 0 1px rgb(255 255 255 / 7%), 0 24px 64px rgb(0 0 0 / 55%)` | `0 0 0 1px rgb(20 22 30 / 8%), 0 24px 64px rgb(20 22 30 / 16%)` | 对话框、抽屉 |
| `--shadow-content`（新增） | `0 0 0 1px rgb(255 255 255 / 6%), inset 0 1px 0 rgb(255 255 255 / 5%), 0 12px 40px rgb(0 0 0 / 45%)` | `0 0 0 1px rgb(20 22 30 / 7%), 0 1px 2px rgb(20 22 30 / 6%), 0 8px 28px rgb(20 22 30 / 7%)` | 工作台浮起的内容面，全局只用这一处 |

| 变量 | 现值 → **新值** | 用途 |
| --- | --- | --- |
| `--radius-xs` | 4px → **4px** | 键帽、徽标 |
| `--radius-sm` | 6px → **6px** | 按钮、输入框、侧栏行、标签 |
| `--radius-md` | 8px → **8px** | 菜单、popover、分组 |
| `--radius-lg` | 10px → **12px** | 对话框、Provider 卡片、内容面 |
| `--radius-full` | 999px → **999px** | 胶囊 |
| `--content-inset`（新增） | **8px** | 内容面和窗口边缘、侧栏之间的间隙（上下右各 8px，左侧贴侧栏） |

动效、字号、间距、控件尺寸全部沿用 refresh-plan 和现行 `styles.css`，不改。`--motion-exit: 180ms` 和 `Presence.EXIT_MS` 的绑定保持不变。

## 4. 选中会话：2px 竖条

把 `src/workspace/sidebar.css:177` 起的「浮起卡片」改成「底色 + 竖条」：

```css
.session-row { position: relative; }
.session-row.is-active {
  background: var(--sidebar-active);
  box-shadow: none;                     /* 不再用卡片描边 */
}
.session-row.is-active::before {
  content: "";
  position: absolute;
  left: 0; top: 8px; bottom: 8px;       /* 32px 行高下竖条长 16px */
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.session-row.is-active .session-row__name { font-weight: 500; }  /* 现有字体已提供 500 字重 */
```

- 竖条用伪元素绘制，不会改变行高，没有现注释里担心的 border 撑高、整列跳动的问题。
- 竖条对 `--sidebar-active` 的非文本对比度：暗色 6.13:1，亮色 5.00:1。
- 状态不能只靠颜色：运行中是绿点，待确认是「待确认」文字徽标（warning + warning-soft），已结束只有文字。三者都有文字或形状区分。
- 房间（`remote.css:46`）、侧栏底部按钮（`quietSidebar.css:20`）、插件中心（`graphite.css:12`）继续引用 `--sidebar-active`，换值后自动跟进。是否也加竖条由前端按场景决定：持久的当前位置加，按钮的按下态不加。

## 5. 工作台结构

- `body` 和 `.app-shell` 的背景改为 `var(--backdrop)`。
- 主区容器加上 `margin: var(--content-inset) var(--content-inset) var(--content-inset) 0`，再加 `border-radius: var(--radius-lg)`、`background: var(--canvas)`、`box-shadow: var(--shadow-content)`、`overflow: hidden`。
- 侧栏右边线去掉，侧栏和底色一体。
- macOS 的 Overlay 标题栏仍让出 `--titlebar-inset: 28px`。内容面的上 inset 和标题栏 inset 叠加时，取 `max(var(--content-inset), var(--titlebar-inset) - 20px)`，交通灯仍在侧栏列里。具体数值由前端在真机上目测确认。
- **壁纸开启时：** 内容面背景按现有 veil 逻辑叠加，`--shadow-content` 保持不变。
- **窄窗或侧栏收起时**（`.app-shell.is-collapsed`）：内容面左侧也补 `--content-inset`，四边一致。
- **全屏终端、专注模式：** 可把 `--content-inset` 设为 0、圆角设为 0，回到贴边。

## 6. 终端配色（`src/theme/xtermTheme.ts`）

`background` 必须和 `--canvas` 逐字一致，`foreground` 必须和 `--text` 一致，`scrollbarSliderBackground` 必须和 `--scrollbar` 一致。`src/theme/graphite.test.mjs` 会做这三项断言，下面的取值都满足。

**ANSI 蓝和强调靛蓝的区分：** 强调靛蓝的色相是 236–237°。ANSI blue 和 brightBlue 改成色相 208° 的天蓝，比现在的 `#6e8bff`（230°，和新强调色几乎撞色）往青色方向偏了约 28°；magenta 往紫红偏到 285–297°。终端里的蓝色链接、路径不会再被误认为 UI 的选中或动作色。

| 键 | 暗色 | 亮色 |
| --- | --- | --- |
| background | `#131418` | `#ffffff` |
| foreground | `#ecedf0` | `#16171c` |
| cursor / cursorAccent | `#ecedf0` / `#131418` | `#16171c` / `#ffffff` |
| selectionBackground | `rgba(139, 147, 255, 0.28)` | `rgba(72, 78, 212, 0.16)` |
| scrollbarSlider / Hover / Active | `#3a3d45` / `#4a4d56` / `#60646f` | `#b4b6bf` / `#9c9ea8` / `#8e909a` |
| overviewRulerBorder | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` |
| black / brightBlack | `#2a2c33` / `#6e717c` | `#26272b` / `#8e909a` |
| red / brightRed | `#ff7b72` / `#ffa198` | `#c4342a` / `#d94334` |
| green / brightGreen | `#5fd4a0` / `#85e3b9` | `#12875a` / `#16a06c` |
| yellow / brightYellow | `#f2c46b` / `#f7d58f` | `#9a6b0f` / `#b8811a` |
| blue / brightBlue | `#5aa9f0` / `#86c3f7` | `#1d6fb8` / `#2f86d6` |
| magenta / brightMagenta | `#d08be8` / `#e0aaf2` | `#a23aa8` / `#bf52c4` |
| cyan / brightCyan | `#5cc8d0` / `#85dce2` | `#0e7490` / `#128aa8` |
| white / brightWhite | `#c9cbd2` / `#f5f6f8` | `#4a4c53` / `#17181b` |

- **亮色继承现有规则：** `white` 压到 8.57:1，确保越过 `minimumContrastRatio = 7`，不被 xterm 改写。`brightBlack` 刻意停在 3.18:1，落在 dim 兜底窗口（低于 3.5）里面。理由见 `xtermTheme.ts` 里那段注释，不要压深。
- **亮色 bright 档低于 4.5:1 是预期行为：** 亮色开启了 `minimumContrastRatio = 7`，渲染时 xterm 会把它们往深处改写；暗色没有兜底，下表里暗色各色号都 ≥7:1（black 除外，它本来就是近背景色）。

## 7. 必须同步的硬编码

| 位置 | 现值 | 新值 |
| --- | --- | --- |
| `index.html:6` `<meta name="theme-color">` | `#171a19` | `#131418` |
| `public/startup.js:11` | `#fcfbf7` / `#171a19` | `#ffffff` / `#131418` |
| `src/theme/ThemeProvider.tsx:15` `CANVAS_COLOR` | `#171a19` / `#fcfbf7` | `#131418` / `#ffffff` |

> **待前端确认：** 系统标题栏同步的是 `--canvas`。但曜石的窗口顶边左侧是 `--backdrop`（侧栏），右侧是内容面上沿外的 backdrop 间隙，所以顶边实际可见的颜色是 backdrop。macOS 用 Overlay 时这个值不影响画面；Windows 原生标题栏建议改为同步 `--backdrop`（`#0c0d10` / `#ececef`）。这样做要同时改 `graphite.test.mjs:54` 的断言，改不改由前端在 T4 中决定。T2 记录的 theme-color 旧值问题也在这一步一并解决。

- `src/theme/graphite.test.mjs`：测试名里的「Graphite」可以改为「theme」，断言逻辑不用动（canvas/text/scrollbar 一致，三档文字在六种表面上 ≥4.5:1）。新取值已用同样的公式验证通过。
- `--success` 被当作选中、强调使用的地方要改用 `--accent`（见 2.4）。前端可以用 `grep -rn 'var(--success)' src` 逐个核对语义。

## 7.5 侧栏毛玻璃（macOS vibrancy / Windows Mica）

**结论：默认不开，只作为「外观」里的可选开关；可选开启时要守住下面的取值。** 曜石的高级感来自「底和侧栏一体、内容面浮起」的明度层次，这一点用不透明色就能完整表达。毛玻璃是锦上添花，不是方向成立的前提。

不默认开启的理由：

1. **对比度要求把透明度压得很低。** 窗口后面可能是任意内容。按最坏情况测算（暗色主题后面是纯白页面，亮色主题后面是纯黑页面），侧栏 tint 至少要 90%（暗）/ 94%（亮）不透明，`--text-faint` 才能保住 4.5:1。在 85% 时暗色 faint 只有 4.03:1，accent 只有 4.78:1。到了 90% 以上，毛玻璃已经只是隐约透色，收益有限。
2. **成本不小。** 要开透明窗口（T2 结论），首帧、resize、全屏切换都有闪白或色缝的风险。Windows 的 Mica 只在 Win11 22H2 及以上可用，Win10 和 Linux 只能回退。壁纸功能也已经在使用透明背景链路，两者叠加会让 `veil` 的计算更复杂。
3. **终端不能透。** 内容面（`--canvas`）在任何情况下都必须保持不透明，否则 xterm 的对比度兜底和 OSC 11 颜色应答会失真。所以真正能透的只有侧栏和内容面四周 8px 的缝，可见面积小。

可选开启时的令牌（只在 `[data-window-material="translucent"]` 下生效，由原生层确认毛玻璃效果真的生效后再写这个标记）：

| 变量 | 暗色 | 亮色 | 说明 |
| --- | --- | --- | --- |
| `--backdrop` / `--sidebar` | `rgb(12 13 16 / 90%)` | `rgb(236 236 239 / 94%)` | tint 色和不透明值同色相。最坏情况下：faint 文字 4.75 / 4.82:1，强调色 5.63 / 4.72:1，状态色均 ≥4.79:1 |
| `--sidebar-hover` | 不变（半透明叠加） | 不变 | |
| `--sidebar-active` | 不变（不透明 `#1c1e23`） | 不变（`#e4e4ea`） | 选中行保持不透明，竖条对比不受背景影响 |
| `--canvas` 及所有内容面、浮层 | 不变，**必须不透明** | 不变 | 终端、菜单、对话框一律不透 |
| 原生材质 | macOS `NSVisualEffectMaterial.sidebar`，`state = followsWindowActiveState` | Windows Mica（不用 Acrylic，它的模糊更透、更耗电） | |

**回退：** 原生层没有成功启用材质（Win10、Linux、macOS「降低透明度」打开、窗口失焦被系统降级），或用户关闭开关时，不写这个标记，直接使用第 2 节的不透明值（`#0c0d10` / `#ececef`）。回退色和 tint 同色相，切换时只有质感变化，不会跳色。

**还需要确认的：** macOS 窗口失焦时系统会把材质变灰，需要在真机上看侧栏文字有没有降到 4.5:1 以下。如果降了，失焦时也改用不透明值。

### 7.6 和壁纸的关系（T8）

现有壁纸方案（`src/background/background.css:90`）把侧栏铺成 `color-mix(var(--sidebar) 78%, transparent)`，不加 backdrop-filter（为了避免 stacking context 裁掉 popover）。换成曜石取值后，按最坏情况测算 78% 不达标：

| 侧栏不透明度 | 暗色 faint / muted / accent（背后是白图） | 亮色 faint / muted / accent（背后是黑图） |
| ---: | --- | --- |
| 78%（现值） | 3.11 / 4.75 / 3.69 ✗ | 3.27 / 4.46 / 3.20 ✗ |
| 90% | 4.75 / 7.24 / 5.63 ✓ | 4.37 / 5.98 / 4.28 ✗ |
| 94% | 5.28 / 8.06 / 6.27 ✓ | 4.82 / 6.58 / 4.72 ✓ |

（同向的图，即暗主题配暗图、亮主题配亮图，在任何不透明度下都 ≥5.5:1，最坏情况只出现在反向的图上。）

规则：

1. **壁纸开启时不叠加毛玻璃。** `data-background="on"` 时原生层不启用 vibrancy/Mica，也不写 `data-window-material`。壁纸已经是「窗外的景」，两层透明效果叠在一起只会更花，对比度也更难保证。设置里两个开关互斥：开壁纸时毛玻璃开关置灰，并显示「壁纸开启时不可用」。
2. **壁纸下的侧栏不透明度下限是 90%（暗）/ 94%（亮）。** 和毛玻璃用同一组值。把 `background.css:92` 和 `:98`（Windows 标题栏，必须和侧栏同值）的 78% 换成变量：

   ```css
   :root { --sidebar-translucency: 90%; }
   :root[data-theme="light"] { --sidebar-translucency: 94%; }
   :root[data-background="on"] .sidebar:not(.is-eject-target),
   :root[data-background="on"] .window-titlebar {
     background: color-mix(in srgb, var(--sidebar) var(--sidebar-translucency), transparent);
   }
   ```

   毛玻璃开启时同样引用 `--sidebar-translucency`，两处共用一个来源。
3. **代价：** 壁纸在侧栏上的可见度比现在弱，是主动的取舍，因为侧栏全是小字（元信息 12px）。如果用户觉得透得太少，可以通过 veil 滑块调整终端区，侧栏不跟着调。
4. **内容面：** 壁纸开启时，曜石的浮起内容面沿用现有 veil 逻辑（终端底是 `color-mix(var(--canvas) var(--app-bg-veil))`），`--shadow-content` 保留；窗口底部 8px 缝透出的是壁纸本身，不需要再加处理。

## 7.7 毛玻璃结论汇总（T8）

| 状态 | 侧栏 / backdrop | 原生材质 | 内容面、浮层 |
| --- | --- | --- | --- |
| 默认 | 不透明 `#0c0d10` / `#ececef` | 无 | 不透明 |
| 用户开启毛玻璃，且原生层确认生效 | `--sidebar` 按 `--sidebar-translucency`（90% / 94%） | macOS sidebar 材质 / Win11 Mica | 不透明 |
| 毛玻璃开启但不支持或被系统降级 | 回退为不透明值 | 无 | 不透明 |
| 壁纸开启 | `--sidebar-translucency` 叠在壁纸上 | 无（和毛玻璃互斥） | 终端底按 veil；浮层不透明 |

## 8. 对比度（脚本输出）

列为七种标准表面。要求：所有文字 ≥4.5:1；非文本（描边、竖条、焦点环）≥3:1。
#### 暗色：文字 × 表面

| 文字 \ 表面 | sidebar | canvas | panel | surface | raised | hover | sidebar-active | 最小 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 16.60 | 15.72 | 15.30 | 14.56 | 14.08 | 13.43 | 14.24 | **13.43** |
| muted | 9.18 | 8.70 | 8.46 | 8.05 | 7.79 | 7.43 | 7.88 | **7.43** |
| faint | 6.02 | 5.70 | 5.55 | 5.28 | 5.11 | 4.87 | 5.16 | **4.87** |
| accent | 7.14 | 6.76 | 6.58 | 6.26 | 6.06 | 5.78 | 6.13 | **5.78** |
| success | 10.56 | 10.00 | 9.73 | 9.26 | 8.96 | 8.54 | 9.06 | **8.54** |
| warning | 11.92 | 11.29 | 10.99 | 10.46 | 10.12 | 9.65 | 10.23 | **9.65** |
| danger | 8.51 | 8.06 | 7.85 | 7.47 | 7.22 | 6.89 | 7.30 | **6.89** |
| info | 9.20 | 8.71 | 8.48 | 8.07 | 7.81 | 7.44 | 7.89 | **7.44** |

| 组合 | 对比度 | 要求 |
| --- | ---: | ---: |
| accent-contrast on accent（实心主按钮） | 7.14 | ≥4.5 |
| text on accent-soft（候选/轻强调） | 12.11 | ≥4.5 |
| accent on accent-soft | 5.21 | ≥4.5 |
| border-strong on canvas（控件描边，非文本） | 3.11 | ≥3 |
| accent on sidebar-active（2px 竖条，非文本） | 6.13 | ≥3 |
| accent on canvas（焦点环，非文本） | 6.76 | ≥3 |


暗色终端（背景 `#131418`）：

| 色号 | 值 | 对比度 |
| --- | --- | ---: |
| foreground | `#ecedf0` | 15.72 |
| black | `#2a2c33` | 1.32 |
| red | `#ff7b72` | 7.30 |
| green | `#5fd4a0` | 10.00 |
| yellow | `#f2c46b` | 11.29 |
| blue | `#5aa9f0` | 7.33 |
| magenta | `#d08be8` | 7.49 |
| cyan | `#5cc8d0` | 9.31 |
| white | `#c9cbd2` | 11.36 |
| brightBlack | `#6e717c` | 3.78 |
| brightRed | `#ffa198` | 9.47 |
| brightGreen | `#85e3b9` | 11.99 |
| brightYellow | `#f7d58f` | 13.03 |
| brightBlue | `#86c3f7` | 9.78 |
| brightMagenta | `#e0aaf2` | 9.82 |
| brightCyan | `#85dce2` | 11.69 |
| brightWhite | `#f5f6f8` | 17.02 |

强调靛蓝 #8b93ff 色相 236°；ANSI blue #5aa9f0 208°、brightBlue #86c3f7 208°、magenta #d08be8 285°

#### 亮色：文字 × 表面

| 文字 \ 表面 | sidebar | canvas | panel | surface | raised | hover | sidebar-active | 最小 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 15.18 | 17.90 | 17.16 | 16.29 | 17.90 | 14.78 | 14.13 | **14.13** |
| muted | 7.50 | 8.84 | 8.48 | 8.05 | 8.84 | 7.30 | 6.98 | **6.98** |
| faint | 5.49 | 6.47 | 6.20 | 5.89 | 6.47 | 5.34 | 5.11 | **5.11** |
| accent | 5.37 | 6.33 | 6.07 | 5.77 | 6.33 | 5.23 | 5.00 | **5.00** |
| success | 5.47 | 6.44 | 6.18 | 5.87 | 6.44 | 5.32 | 5.09 | **5.09** |
| warning | 5.46 | 6.43 | 6.17 | 5.86 | 6.43 | 5.31 | 5.08 | **5.08** |
| danger | 5.51 | 6.50 | 6.23 | 5.91 | 6.50 | 5.36 | 5.13 | **5.13** |
| info | 5.64 | 6.65 | 6.37 | 6.05 | 6.65 | 5.49 | 5.25 | **5.25** |

| 组合 | 对比度 | 要求 |
| --- | ---: | ---: |
| accent-contrast on accent（实心主按钮） | 6.33 | ≥4.5 |
| text on accent-soft（候选/轻强调） | 15.29 | ≥4.5 |
| accent on accent-soft | 5.41 | ≥4.5 |
| border-strong on canvas（控件描边，非文本） | 3.18 | ≥3 |
| accent on sidebar-active（2px 竖条，非文本） | 5.00 | ≥3 |
| accent on canvas（焦点环，非文本） | 6.33 | ≥3 |


亮色终端（背景 `#ffffff`，渲染时有 minimumContrastRatio 7 兜底）：

| 色号 | 值 | 对比度 |
| --- | --- | ---: |
| foreground | `#16171c` | 17.90 |
| black | `#26272b` | 14.92 |
| red | `#c4342a` | 5.42 |
| green | `#12875a` | 4.53 |
| yellow | `#9a6b0f` | 4.68 |
| blue | `#1d6fb8` | 5.23 |
| magenta | `#a23aa8` | 5.67 |
| cyan | `#0e7490` | 5.36 |
| white | `#4a4c53` | 8.57 |
| brightBlack | `#8e909a` | 3.18 |
| brightRed | `#d94334` | 4.37 |
| brightGreen | `#16a06c` | 3.34 |
| brightYellow | `#b8811a` | 3.39 |
| brightBlue | `#2f86d6` | 3.82 |
| brightMagenta | `#bf52c4` | 4.02 |
| brightCyan | `#128aa8` | 4.02 |
| brightWhite | `#17181b` | 17.75 |

强调靛蓝 #484ed4 色相 237°；ANSI blue #1d6fb8 208°、brightBlue #2f86d6 209°、magenta #a23aa8 297°

徽标补充：warning 文字在 warning-soft 合成底上，暗色约 9.1:1、亮色约 5.6:1。普通 `--border` 的不透明等效值对 canvas 只有 1.25–1.30:1，它只负责组织内容；需要靠描边识别的控件一律用 `--border-strong`。

以上全部是对不透明色值的计算。半透明的 `--border`、`--sidebar-hover` 按第 2 节给出的不透明等效值核算。计算不包括壁纸混色、字体实际光栅化和原生窗口透明效果，不能替代真机和 WebView 验收。

## 9. 建议落地顺序

1. 改 `styles.css` 的两个主题块（第 2、3 节），同时改 `xtermTheme.ts` 和第 7 节的三处硬编码，跑 `graphite.test.mjs`。
2. 工作台结构（第 5 节）和选中竖条（第 4 节）。
3. 用 `--success` 当「选中」的地方逐处改用 accent；浮层统一用 `--shadow-md/lg`，去掉重复的 border。
4. 用 T2 的截图脚本出亮、暗两套前后对比图，并在 macOS 和 Windows 真机检查标题栏衔接。
