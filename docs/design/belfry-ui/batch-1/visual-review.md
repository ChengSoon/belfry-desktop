# T4 批次 1：截图回归复核

结论：最终构建 `index-C0vVt1iT.js` / `index-Cm-BAe-t.css` 在已捕获的工作台、外观设置和房间视图中，没有意外像素变化。主题 meta 与画布色一致；插件搜索框的浅色普通/聚焦背景按预期修正，深色保持不变。

## 完整矩阵

| 平台样式 | 图片配对 | 相同 | 差异像素 / 检查像素 | 差异比例 | 报告 |
| --- | ---: | ---: | ---: | ---: | --- |
| macOS | 18 | 18 | 0 / 14,904,000 | 0% | [并排与高亮](comparison/macos/index.html) · [JSON](comparison/macos/summary.json) |
| Windows | 18 | 18 | 0 / 14,904,000 | 0% | [并排与高亮](comparison/windows/index.html) · [JSON](comparison/windows/summary.json) |

每个平台覆盖三个视图（主工作台、外观设置、房间对话/任务板）、亮暗主题、1440×960 / 1080×700 / 720×480 三种尺寸。严格阈值为 0，不忽略字体抗锯齿，不使用图片缩放对齐。所有 36 对截图完整配对，没有缺图、尺寸或哈希错误。

改前来自 `../baseline/{macos,windows}`，改后与 manifest 保存在 `after/{macos,windows}`。两组改后构建入口均为 `index-C0vVt1iT.js`，完整资源哈希在 manifest 和报告中。

改后 36 张截图的 `themeColor` 与 `canvas` 全部相等：暗色 `#171a19`，亮色 `#fcfbf7`。这是 DOM 证据，不依赖 PNG 是否能显示浏览器/系统主题色。入口 HTML 已包含两套 canvas meta，由首帧脚本读取；React/xterm/CSS 来源统一属于前端 T4 的实现和一致性测试范围。

两组生产截图检查通过：无页面错误提示、无横向页面溢出、资源正常加载；两个终端 DOM 在视图切换后保持连接，未关闭或重建；浏览器异常、未处理命令、控制台错误均为 0。

## 插件搜索框

[组件并排与差异报告](plugin-search/report/index.html) · [逐项 JSON](plugin-search/report/summary.json) · [计算样式/几何证据](plugin-search/control-evidence.json)

原有历史基线没有插件页，因此这里使用**同一最终构建中重现旧不可达选择器**作为控制条件，并与修复规则比较；不是历史构建截图。报告、manifest 顶端均标记这个边界。

截图裁切为搜索框及 3px 焦点环边距，尺寸 286×39，不能把组件差异比例当作全页比例。

| 条件 | 差异像素 | 组件差异比例 | 结果 |
| --- | ---: | ---: | --- |
| 暗色普通态 | 0 | 0% | 保持不变 |
| 暗色聚焦态 | 0 | 0% | 保持不变 |
| 浅色普通态 | 8,413 | 75.42586% | 背景变为 `--surface`，差异范围正好为输入框的 280×32 |
| 浅色聚焦态 | 9,261 | 83.02851% | 背景变为 `--canvas`，差异范围为输入框与 1px 焦点环的 282×34 |

浅色普通背景为 `rgb(241, 241, 235)`，聚焦背景为 `rgb(252, 251, 247)`。输入框几何未改变；旁边市场按钮的背景、文字、边框、圆角、阴影和位置尺寸也未改变。组件检查没有浏览器错误或未处理命令。

## 工具与复现

工具说明见 [截图对比工具](../compare-ui-baseline.md)。后续批次可直接复用：

```sh
BELFRY_UI_BASELINE_OUT=docs/design/belfry-ui/batch-1/after/macos node scripts/capture-ui-baseline.mjs
BELFRY_UI_PLATFORM=windows BELFRY_UI_BASELINE_OUT=docs/design/belfry-ui/batch-1/after/windows node scripts/capture-ui-baseline.mjs

node scripts/compare-ui-baseline.mjs docs/design/belfry-ui/baseline/macos docs/design/belfry-ui/batch-1/after/macos --out docs/design/belfry-ui/batch-1/comparison/macos
node scripts/compare-ui-baseline.mjs docs/design/belfry-ui/baseline/windows docs/design/belfry-ui/batch-1/after/windows --out docs/design/belfry-ui/batch-1/comparison/windows

BELFRY_UI_PLUGIN_REVIEW_OUT=docs/design/belfry-ui/batch-1/plugin-search node scripts/capture-plugin-search-review.mjs
node --test scripts/compare-ui-baseline.case.mjs
```

以上复现截图时须使用该批次构建，不能拿后续曜石构建覆盖这些产物。工具测试 4 项通过（像素计数/阈值/边界、manifest 配对、真实 PNG 解码与哈希校验、HTML 转义）；同一构建 18 对零差异控制组亦已通过。

此次后端复核只修改 scripts 和文档/截图产物，未编辑 src 业务代码或 remote/rooms 现场。结论限于所捕获视图与控件，不代表真实原生窗口、所有设置页或全功能验收。
