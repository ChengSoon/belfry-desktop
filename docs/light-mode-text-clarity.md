# 亮色模式终端文字发虚：根因与整治方案

## 现象

亮色模式下终端文字发灰、边缘模糊，尤其是 statusline、框线这类次要文字。暗色模式无此问题。

## 实测数据

对用户截图（996×240，亮色 + 背景图开启）逐像素测量：

| 采样区域 | 笔画最暗核心 | 背景 | 实测对比度 | 通道偏差(R/G/B spread) |
|---|---|---|---|---|
| statusline 主行 | RGB(127,124,131) | RGB(255,255,255) | **4.11 : 1** | 均值 4.9 / p99 16 |
| 路径行 | RGB(115,115,120) | RGB(255,255,255) | **4.72 : 1** | 均值 5.2 / p99 24 |

两个关键读数：

- **对比度 4.1:1** —— 低于 WCAG AA 的 4.5:1。而亮色主题的 `foreground: #26272b` 对 `#fafafa` 本应是 14.29:1，差了三倍多，说明这段文字没走 `foreground`，走的是被刻意压浅的 ANSI 色号。
- **通道偏差仅 4.9** —— 子像素抗锯齿会在字形边缘产生 30~80 的 R/G/B 偏差。只有 4.9 意味着**当前是灰度抗锯齿**，那点偏差来自背景图本身的彩色。这是"虚"的直接来源。

## 根因：四层叠加，只在「亮色 + 背景图开启」时同时发作

### L1 · 子像素抗锯齿被关掉（"虚"的主因）

`src/terminal/terminalController.ts:499` — `allowTransparency: transparent`，开背景图时为 `true`。

传导到 `node_modules/@xterm/addon-webgl/lib/addon-webgl.js`，字形图集的 canvas 这样创建：

```js
getContext("2d", { alpha: this._config.allowTransparency, willReadFrequently: true })
```

`alpha: true` → 浏览器无法对字形做子像素抗锯齿，只能灰度 AA。灰度 AA 下细笔画靠"整体变浅"表达覆盖率，而子像素 AA 靠 RGB 错位保持边缘锐度——这就是实测通道偏差只有 4.9 的原因，也是肉眼"虚"的物理来源。

顺带，同一文件里 `!allowTransparency && fontSize >= 12` 才执行的下伸部修正也被跳过了（次要）。

### L2 · 文字背景不是纯色，是半透明 veil 叠图

`src/background/background.css:130`：

```css
background: color-mix(in srgb, var(--canvas) var(--app-bg-veil, 50%), transparent);
```

默认 50%，即亮色下 = 50% `#fafafa` + 50% 背景图。文字周围背景带高频细节、亮度不确定，人眼判定边缘时被噪声干扰。浓度由设置里的滑块经 `src/background/BackgroundProvider.tsx:94` 写入。

### L3 · 亮色调色板偏浅，且 `minimumContrastRatio` 完全没开

`src/theme/xtermTheme.ts` LIGHT 里两个"防隐形"色号压得不够狠：

| 色号 | 当前值 | 对 `#fafafa` 对比度 |
|---|---|---|
| `white`（ANSI 37） | `#5f6169` | 5.92 : 1 |
| `brightBlack`（ANSI 90） | `#8a8c94` | **3.21 : 1** ← 连 AA 都不到 |

statusline / 框线正是走这两个色号，实测 4.11 与 4.72 恰好落在两者之间（抗锯齿把峰值往浅处拉）。

同时 `createXterm` 未设置 `minimumContrastRatio`。已在 `@xterm/xterm/lib/xterm.mjs` 确认其默认值为 `1`，即**完全关闭**；有效范围 1~21。这是 xterm 官方专门用来兜底对比度的开关，目前白给。

### L4 · dim 文字再砍一半

`addon-webgl.js` 中 `DIM_OPACITY = .5`，dim 文字前景色乘 0.5。且 `xterm.mjs` 里目标对比度对 dim 文字要**除以 2**：

```js
const u = minimumContrastRatio / (r.isDim() ? 2 : 1)
```

所以 dim + `brightBlack` 在亮色下等效约 1.64:1 —— 基本等于看不见。

### 为什么暗色模式没事

浅字在暗底上有视觉光渗（halation），灰度 AA 反而显得更粗更实；亮色是反过来的，深字在浅底上灰度 AA 显细。这是人眼的感知不对称，不是代码 bug——所以**所有改动都应只作用于亮色，不要动暗色现有观感**。

---

## 方案（按性价比排序）

### P0 · 开启 `minimumContrastRatio`（一行，收益最大）

在 `src/terminal/terminalController.ts` 的 `createXterm` 里增加该选项，并且**必须随主题模式变化**——同步点在同文件 `:242-243`，和 `terminal.options.theme` 一起改。

建议取值：

- 亮色：**7**。不要设 4.5：L4 说明 dim 文字的目标会被除以 2，设 4.5 时 dim 只剩 2.25:1 仍然虚；设 7 才能让 dim 拿到 3.5:1。
- 暗色：保持 **1**（关闭）。暗色观感本来是好的，开了只会让精心调的配色被 xterm 改写。

两点注意：

1. 已确认 `@xterm/addon-webgl` 支持该选项（`minimumContrastRatio` 在其中出现 6 次，含 `ensureContrastRatio` / `halfContrastCache`），强制 WebGL renderer 不影响它生效。
2. 开背景图时 xterm 用来算对比度的背景是 `rgba(250,250,250,0)`——RGB 分量被 `withTransparentBackground` 刻意保留了（见 `xtermTheme.ts:88-91` 注释），所以计算不会退化，方向正确，但**偏乐观**（真实背景比 `#fafafa` 更脏）。这是取 7 而非 4.5 的第二个理由。

副作用：它会改写 ANSI 颜色，个别程序的配色会偏离原意。亮色下这个取舍值得。

### P1 · 把亮色调色板那两个"隐形色"压深

`src/theme/xtermTheme.ts` 的 `LIGHT`：

- `brightBlack: #8a8c94` → 约 `#6b6d75`（≈4.6:1），可以更深到 `#5f6169`
- `white: #5f6169` → 约 `#4a4c53`（≈7.5:1）

与 P0 有重叠但不冗余：P1 治源头色值，P0 是兜底。源头对了之后 `minimumContrastRatio` 很少需要介入，程序原本的配色意图能保留更多。

顺带一并看 UI 侧同源问题：`src/styles.css:125` 的 light `--text-faint: #8a8c94` 对 `--canvas` 约 2.9:1，是全 App 最弱的文字对，而 `src/collab/collab.css:277` 的 `.collab-event__id` 还在它上面叠了 `opacity: 0.5`。

### P2 · 亮色下字重 +1 档

`src/terminal/terminalController.ts:506-507`，`fontWeight: 400 / fontWeightBold: 500` → 亮色时 `500 / 600`，补偿灰度 AA 在浅底上的视觉变细。

**前置确认**：`src/styles.css:76` 有全局 `font-synthesis: none`，所以字体文件必须真的带 500 字重，否则浏览器不合成、**静默无效**。请先核对候选等宽字体是否有 Medium 字重再动这条。

### P3 · 亮色下提高 veil 默认浓度

`src/background/BackgroundProvider.tsx:94` 及设置滑块默认值：亮色默认从 50% 提到 **75~85%**，让文字底下接近纯色，消掉 L2 的背景噪声。

建议做成「亮色/暗色各记一个 veil 默认值」——暗色 50% 观感是好的，不要动。

### P4 · 可选，天花板最高但要产品决策，先不做

目前"开背景图 ⇒ `allowTransparency: true` ⇒ 丢子像素 AA"是死锁，L1 无法靠调参解决。真要根治需要让 xterm 背景重新变成不透明，例如把背景图只透在终端以外的区域（侧栏、面板、边距），正文区不透——不少终端 App 就是这个取舍。

**等 P0~P3 落地看效果后再评估，不要现在动。**

---

## 验证要求（不接受"感觉清楚了"）

按仓库既有手法：`tmp/` 下探针页 + headless Chrome 截图（原生窗口截不到，`osascript` 无辅助功能权限）。改动前后各截一张，用与本文档相同的方式量像素：

1. 笔画最暗核心 RGB
2. WCAG 对比度 —— **目标：从 4.11:1 提到 ≥ 7:1**
3. 通道偏差（若 P4 未做，这项预期仍然很低，属正常）

四个场景都要覆盖：亮色/暗色 × 背景图开/关。特别确认**暗色模式观感零变化**。

类型检查用 `tsc -b`，不要用 `--noEmit`（会静默空转，零输出 + exit 0 不等于通过）。

---

## 实施结果（P0~P3 已落地，P4 未做）

验证手法：`tmp/` 下探针页用假 Tauri IPC 跑**真实的 `mountTerminal`**（不复刻它的 xterm 选项），
每个场景截两帧——有字帧 + 同场景无字参考帧，墨的位置靠两帧求差得到，不靠"和背景色差多少"
（开背景图时底下是高频图案，单帧分不出哪儿是字）。`--enable-unsafe-swiftshader` 是必需的，
不给它 headless 拿不到 WebGL2，xterm 会静默退回 DOM renderer，量到的就不是真实渲染路径。
Retina 保真用 `--force-device-scale-factor=2`。

### 亮色（笔画最暗核心 → 对比度）

| 色号 | 背景图关 · 前 | 关 · 后 | 背景图开 · 前 | 开 · 后 |
|---|---|---|---|---|
| white(37) | #5f6169 → **5.92** | #4a4c53 → **8.21** | 2.94 | **6.14** |
| brightBlack(90) | #8a8c94 → **3.21** | #505156 → **7.59** | 1.60 | **5.68** |
| dim + 90 | #c1c2c6 → **1.71** | #7c7e85 → **3.88** | 1.60 | **5.68** |
| foreground | 14.29 | 14.29 | 7.11 | **10.70** |

背景图开启时的通道偏差 p99 从 67~71 降到 25~30——veil 提到 80% 之后透进来的图案噪声少了一大截。
背景图关闭时偏差仍在 5~9（灰度 AA，P4 未做，属预期）。

### 暗色

四项读数与改动前**逐字节相同**（`cmp` 比对 PNG 通过，背景图开/关都是）。

---

## 两处勘误（实测与本文档原判断不一致）

### 1. L4/P0 对 dim 的推理是反的：`ratio / 2` 是**触发线**，不是保证值

原文说"设 7 才能让 dim 拿到 3.5:1"。实测不成立。xterm 的实际次序是：

```js
// addon-webgl 的 _getForegroundColor
const c = this._getMinimumContrastColor(...);   // 内部用 ratio / (isDim ? 2 : 1)
if (c) return c;                                // 命中兜底就直接返回，跳过 DIM_OPACITY
...
return dim ? multiplyOpacity(color, DIM_OPACITY) : color;   // 没命中才乘 0.5
```

所以 `ratio / 2` 只决定**兜底要不要介入**。原色一旦高过这条线，兜底不管，而 0.5 照样乘下去，
最终对比度没有任何下限。

后果：**P1 把 brightBlack 压深会让 dim 文字更虚**。实测三组：

| brightBlack 取值 | 对 #fafafa | 非 dim 实测 | dim + 90 实测 |
|---|---|---|---|
| `#8a8c94`（原值，留在窗口内） | 3.21 | 7.59 | **3.88** |
| `#6b6d75`（文档 P1 建议值） | 4.94 | 7.85 | **1.98** |

非 dim 那侧两种取值都被兜底拉到 7.6~7.9，没有区别；dim 那侧差了近一倍。
statusline 大量用 dim + 灰，所以 **brightBlack 保持 `#8a8c94` 不动**，
只把 white 压到 `#4a4c53`（8.21，越过 7 之后 xterm 不再改写它，程序的配色意图能完整留下）。
这个耦合已经用测试钉住（`xtermTheme.test.ts` 的"brightBlack 留在 dim 的兜底窗口内"）。

### 2. `minimumContrastRatio: 7` 的副作用比"个别程序"大得多

原文说"个别程序的配色会偏离原意"。实测是：亮色调色板里除 `black` / `brightWhite` /
`foreground`（都 ≥14:1）之外，**14 个色号全部会被改写**，因为 7:1 对彩色很苛刻。
改写方向是逐步降亮度，色相保留，但 bright 与常规两档会被压到一起
（如 `brightRed #d94334` → `#8d2b20`，比常规 `red #c4342a` → `#9e2921` 还深，两档次序反了）。

亮色下可读性优先，这个取舍仍然值得，但它是"整套彩色变深变闷"，不是"个别程序"。
如果之后觉得彩色损失太大，能调的只有这个数值本身——而降到 4.5 会让几乎所有灰漏出 dim 兜底窗口，
是拿 dim 换彩色。这已经是 P4 的范畴了。

---

## P2 的前置确认结果：默认字体栈吃不到这一档

实测本机（canvas 逐字重量墨，与 WebGL 字形图集同一条路径）：

| 字体 | 400 → 500 |
|---|---|
| 默认栈实际命中的 Menlo | **逐字节相同**（只有 Regular/Bold） |
| SF Mono（可变，wght 294~900） | Chrome 不暴露给网页，取不到 |
| Helvetica Neue（有 Medium） | 墨像素 +15%、总墨量 +21% |

也就是说：**改动本身生效**（用带 Medium 的字体实测，墨量确实上去了），
但本机 headless Chrome 把 `ui-monospace` 解析失败、一路落到 `monospace` = Menlo，量不出变化。
真实 App 跑在 macOS 的 WKWebView 上，那里 `ui-monospace` → SF Mono（可变字体带 500），
预期生效；Windows 的 WebView2 上会走到 Cascadia Mono（同为可变字体）。
**这一档在本机无法证实，只能证实链路是通的。**

顺带一个既有问题：原来 `fontWeightBold: 500` 在 Menlo/Consolas 这类只有两档的字体上等于 400,
也就是**粗体和正文渲染完全一样**。已把亮色的 bold 提到 600（至少能命中 Bold）；
暗色仍是 500，没动——那是"暗色零变化"的约束，需要单独决策。

## 一处越出"暗色零变化"的改动

P1 顺带提到的 `.collab-event__id`：`--text-faint` 上再叠 `opacity: 0.5` 等效只剩 1.9:1，
而 shortId 是要逐字认出来复制的（`user-select: all`）。改成 `faint → muted` 两档颜色之后，
**暗色下这处也实了一档**（3.7:1，原先是 opacity halved），hover 反馈从"提不透明度"变成"提一档色"。
方向是变清楚，但严格说不是"零变化"，需要确认。

