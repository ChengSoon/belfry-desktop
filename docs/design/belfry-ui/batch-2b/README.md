# 批次 2b：房间字号与层级（refresh-plan A02/A04 · T14）

## 改了什么

- **字号走令牌**（A02）：房间 JSX 里固定的 `text-[10px]`/`text-[11px]` 改为 `text-xs`（即 `--fs-xs`，默认 12px）；`text-[15px]` 标题改为 `text-base`（即 `--fs-lg`）。`room.css` 里 `0.6875rem`（实际 9.6px）、`0.75rem`、`0.8125rem`、`0.875rem`、`11px`、`12px` 全部映射到 `--fs-xs/sm/md`：元信息和状态用 xs，说明和辅助文字用 sm，问题和选项正文用 md。这些值都会随设置里的字号缩放。
- **字重统一 500**（A04）：中文只打包了 400/500 两档字重，并关闭了合成，写 `font-semibold`/600 实际不会生效。房间内的标题、成员名、徽标、头像、Markdown 标题统一为 500，去掉 `tracking-*`。头像字重从工具类挪到 `.room-avatar-label`，避免和 @ 补全测试里按 `.font-medium` 取名字的选择器冲突。
- **长文本不裁剪**：成员名、成员状态与当前任务、模型覆盖、任务负责人、阻塞徽标、房间列表名称，都由 `truncate` 改为 `overflow-wrap:anywhere` 折行。选择卡片的成员名也不再用省略号。
- **选中语义**（A13）：当前房间改为中性填充加 2px accent 竖条（伪元素，不改变行高）。终端选择卡片的当前选项和 @ 补全的候选项改为 `--accent-soft` 加 inset 2px 侧标，hover 只换底色。
- **颜色、圆角走曜石令牌**：窄窗抽屉遮罩和 shadcn dialog、alert-dialog 的遮罩用 `--scrim`；展开后的待处理浮层用 `surface-raised` 加 `shadow-lg`，去掉描边；焦点环用 `--focus-ring`；7px、6px、4px、12px 这些圆角改用 `--radius-*`。
- **顺手修的 bug**：`BriefSummary` 收起时只做了一次 `scrollTop = 0`，展开状态下按 End 触发的平滑滚动动画还在进行，会把它覆盖掉。结果是收起后需求摘要停在中间，`rooms-brief.case` 因此偶发失败，改动前在原代码上也能复现。现在收起状态下监听 scroll 事件，持续把滚动位置钉在顶部。

房间逻辑、IPC 契约、`useRooms` 等 hook 都没有改动。

## 验证

- `tsc` 通过；`pnpm test` 194 个文件、1256 项全部通过；`pnpm build` 通过；`obsidian-contrast.mjs` 退出码 0。
- 浏览器用例 `room-creation`、`room-role-model`、`rooms-*`、`production-panels` 共 97/97 通过。`rooms-brief` 连跑 3 轮，每轮 10/10。
- 前后对比报告：`comparison/index.html`（macOS，亮暗两种主题，1440/1080/720 三种尺寸）。
  - 房间视图 6 对图的差异在 1.3–2.7%，内容就是上面列的这些：成员说明折行、房间竖条、徽标字号放大、字重统一。
  - 设置视图 6 对图逐像素一致。
  - 工作台视图的差异来自同时在进行的 T15，不属于本批。
- 720×480 下，紧凑导航、关闭按钮、发送按钮、要求回复按钮都可见且可以点击，见 `after/macos/rooms-*-720x480.png`。

## T18 补充：顶部让位条色阶 + Windows / 最大字号截图（2026-11-13）

### 顶部让位条
- 问题：macOS 下 `.room-view` 顶部有一条 28px 的让位条（`padding-top: var(--titlebar-inset)`），底色取的是整个容器的 `bg-background`，也就是 canvas（暗 `#131418` / 亮 `#ffffff`）。下方左侧侧栏是 backdrop（`#0c0d10` / `#ececef`），于是侧栏上方横着一条更亮的色带，和 B 稿「窗口底与侧栏一体」不一致。
- 做法：容器改铺 `--backdrop`（`room.css` 的 `.room-view`，去掉 JSX 上的 `bg-background`）；对话列 `.room-main` 自己铺 `--canvas`；侧栏（`--sidebar`，与 backdrop 同值）和任务板（`--panel`）原本就自带底色，没有改。这样让位条横贯整窗，都是窗口底色，三栏从让位条下方开始各自的面。空状态也用 `.room-main`，同样覆盖。
- **设置页（T12，由 UI设计工程处理）照同一做法**：容器铺 `--backdrop`，内容区和导航各自铺自己的面，不要让整个容器的 canvas 透进让位条。
- 修前修后的顶部特写在 `titlebar/{before,after}-{dark,light}.png`（取 1440×960 顶部 120px）。逐像素取样：暗色让位条由 `(19,20,24)` 变为 `(12,13,16)`，与侧栏一致；亮色由 `(255,255,255)` 变为 `(236,236,239)`，与侧栏一致；三栏本身颜色不变。
- Windows 走自绘标题栏，`--titlebar-inset` 为 40px，标题栏本身是侧栏色，所以这次改动在 Windows 上只影响标题栏下方，不产生新的色阶，见 `after/windows/rooms-*.png`。

### 补充截图
- `after/windows/`：`BELFRY_UI_PLATFORM=windows`，亮暗两套 × 1440/1080/720 三种尺寸，共 18 张，其中房间 6 张。
- `after/macos-font20/`：字号最大档 20px（`BELFRY_UI_FONT_SIZE=20`，是本次给截图脚本新增的可选参数），亮暗两套 × 1440/1080 两种尺寸。在最大字号下，三栏都保持可用：成员说明、任务标题、需求都正常折行，没有裁剪；发送和要求回复按钮可以点；1080 宽度下需求自动出现「展开简报」。房间标题和项目名在头部用省略号截断，完整名称在 title 提示里，这是窄头部里有意保留的截断。
- `after/macos/`：用当前构建重新拍的整套截图。

验证：`pnpm test` 195 个文件、1262 项通过；`pnpm build` 通过；`rooms-qa`、`rooms-brief`、`room-creation` 浏览器用例 24/24 通过。

## 未覆盖
- 原生窗口里真实的 macOS 交通灯与让位条的衔接只能在真机上看，见 code-review.md 中 T17 的真机步骤。
- 最大字号下的 720×480 没有截图：这一档房间会切换成紧凑导航，已由 `rooms-brief` 的 720×480 / 20px 用例覆盖布局断言。

## 与设计稿的对应关系（按 2026-11-13 统筹的硬性要求补充）

`directions/`（只覆盖主工作台）和 `obsidian-screens/`（设置、快速打开、插件中心、弹窗）都**没有房间视图的稿子**；`obsidian-tokens.md` 只在第 121 行提到房间沿用 `--sidebar-active`，竖条是否添加由前端决定。所以本批没有「实装 vs 设计稿」的并排截图，处理方式是沿用稿子的通用语言：
- 令牌：`obsidian-tokens.md` 的颜色、阴影、圆角，`refresh-plan` 的字号档。
- 选中语义：`obsidian-screens/README.md` 的 A13。当前位置用中性填充加竖条，键盘候选用 accent-soft 加侧标。
- 浮层：弹窗和浮层规格，即 raised 表面加 `shadow-lg`、不加描边、遮罩用 `--scrim`。

这批已请 UI设计工程确认。如果之后补出房间稿，按稿子再做一轮对齐。
