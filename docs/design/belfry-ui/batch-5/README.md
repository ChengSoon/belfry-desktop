# 批次 5（T11）：历史/用量/Git/文件预览/快捷键/Provider 曜石统一 · 验收

源码改动由前端完成，清单见 `../handoff/t11-frontend-handoff.md`（39 个文件）。本文记录 UI设计工程接手后的验证结果和一处修复。

## 构建

`dist/assets/index-LFD4gnW4.js` / `index-JTSabTvg.css`，是在下文 Notice 修复之后构建的。

## 验证

| 项 | 结果 |
| --- | --- |
| `pnpm exec tsc -b` | 通过 |
| `pnpm test` | 193 个文件 / 1252 项全部通过 |
| `pnpm build` | 通过（只有原有的 chunk 体积提示） |
| 生产浏览器用例：`production-ui`、`production-panels`、`settings-layout`、`motion` | 20 / 20 通过，没有浏览器错误、未处理命令或异常。其中「Provider preserves original cards, segment slider and selection motion」通过 |
| `node docs/design/belfry-ui/obsidian-contrast.mjs` | 退出码 0 |
| `git diff --check` | 无输出 |

Provider 的 `ProviderCard.tsx` 和 `shatterCard.ts` 没有改动，所以 520ms 翻转、340ms 回落、1050ms 碎裂以及 reduced-motion 的逻辑都保持原样。

## T7 → T11 截图对比

- 同一套生产用例拍下的 48 对截图，覆盖历史、用量、Git、文件、Provider 卡片、全局 Provider、项目 Provider、快捷键，亮暗两套，各 3 种尺寸。
- 改前：`before-t7/`，来自 T7 dist `index-C1gJpsbW`。
- 改后：`panels/`。
- 报告：`comparison/index.html`。

| 视图 | 严格差异 | 差异位置与判断 |
| --- | ---: | --- |
| 文件 | 0.7–1.8% | 只在右侧面板：选中行改为中性底 + 2px 侧标 ✓ |
| 用量 | 1.5–3.1% | 只在右侧面板：分段、元信息间距对齐令牌，金额用 tabular-nums ✓ |
| Git | 2.8–4.8% | 只在右侧面板：头部、筛选框、分组行距改为 space 令牌，变化在几像素以内，没有错位 ✓ |
| 历史 | 3.1–7.2% | 只在右侧面板：筛选区和条目间距统一；820 宽下 Agent 筛选换行正常，没有裁剪 ✓ |
| 快捷键 | 4.7–8.2% | 当前 tab 改为中性填充，键帽改为 shadow-sm ✓ |
| 项目 Provider | 5.9–10.1% | Notice 结构、间距令牌 ✓ |
| Provider 卡片 / 全局 Provider | 27–42% | 卡片网格和结构没变（3 列、卡片尺寸一致），卡片内部各行整体移动了约 1–2px（间距令牌化），加上「已选用」改为中性色，所以像素差异比例大。逐张目视检查过，不是布局变化 ✓ |

没有发现裁剪、横向溢出或控件错位。语法高亮色、路径等宽、Git 增删色都保留了。

## 修复：窄面板下 Notice 的动作挤压正文

交接时列为待验证的风险：「窄窗 Notice 原因/动作的换行与命中」。实际渲染发现，右侧面板宽度在 240–330px 时，`.ui-notice__actions` 是 `flex: none` 且不换行，会把正文挤成每行 4–6 个字的窄列，按钮仍然排在正文右边。

改动只在 `src/components/notice.css`：

- `.ui-notice` 加 `flex-wrap: wrap`；
- `.ui-notice__message` 改为 `flex: 1 1 12em`，正文至少保留约 12 个字的宽度；
- `.ui-notice__actions` 改为 `flex: 0 1 auto` 加 `margin-left: auto`：放不下时整组折到正文下方并靠右，放得下时和原来一样排在右侧。

在 240、328、640px 三种宽度渲染核对过：窄的两档按钮折到第二行，正文恢复正常行宽；640px 下保持单行布局，和修复前一致。组件结构、role 和按钮命中区域（32px 高）都没变。

## 没有覆盖的内容

- `current` 和 `focus-visible` 同时出现时的层叠，目前只做了 CSS 选择器审查，生产用例没有专门截取「当前项上的键盘焦点」这一帧。
- 真实 WebView 渲染需要原生验收。
- Quick Open 不在本批，由 T12 按 T10 稿处理。
