# UI 截图对比报告

`scripts/compare-ui-baseline.mjs` 读取两份截图目录的 `manifest.json`，按 `captures[].filename` 配对，输出并排的改前/改后/差异高亮 HTML、每张差异 PNG，以及可供后续批次读取的 JSON 摘要。报告中的图片全部内嵌，可单独打开或分享 `index.html`。

首个实际交付见 [T4 批次 1 复核报告](batch-1/visual-review.md)：36 对全页严格零差异，附主题 meta 证据与插件搜索框的预期变化。

## 使用

先按 [截图说明](native-window-baseline.md) 构建和拍摄改后图，保留原基线目录，再执行：

```sh
node scripts/compare-ui-baseline.mjs \
  docs/design/belfry-ui/baseline/macos \
  /tmp/belfry-ui-after/macos \
  --out /tmp/belfry-ui-report/macos

node scripts/compare-ui-baseline.mjs \
  docs/design/belfry-ui/baseline/windows \
  /tmp/belfry-ui-after/windows \
  --out /tmp/belfry-ui-report/windows
```

需要 Chrome、Chromium 或 Edge；复用仓库的隔离浏览器解码 PNG，不安装额外图像依赖，也不访问真实应用或用户数据。结束时关闭进程、清理临时 profile。

产物：

- `index.html`：汇总表、按差异/相同/不完整筛选、原始像素模式、单图放大预览。
- `summary.json`：逐图状态、严格及阈值后百分比、差异边界、平均通道差、改前/改后构建来源。
- `diffs/<序号>.png`：红色显示差异像素，灰色为改后参考内容。

默认阈值为 0，任一 RGBA 通道发生变化即计入差异。`--threshold 8` 表示某个通道差值大于 8 时才计入；严格差异比例仍保留在 JSON/HTML 中。总差异比例为所有配对图片的差异像素之和除以总像素数，不取各图比例的简单平均。工具不忽略字体抗锯齿或透明通道。

默认检测到视觉差异仍退出 0，供设计批次人工评审；加 `--fail-on-diff` 可用于要求像素完全不变的回归。缺图、额外图片、哈希错误、尺寸不符或无法解码都会标为不完整并退出 1，已有可比较图片仍生成报告。manifest 平台不同、重复文件名或格式无效则直接失败。绝不自动缩放尺寸不同的图来制造对齐结果。

## 复核方式

先核对 manifest 中的构建资源哈希、平台、浏览器版本和视口。浏览器版本不同会有提示；跨系统字体栅格化可能产生差异，因此同批次应尽量使用同一运行环境。

再看每张图的差异范围，确认预期修改的位置与差异吻合。0% 只证明所捕获视图像素一致；`meta theme-color` 等非页面像素变化，应结合对应 DOM/主题一致性测试。外观设置页的截图不覆盖插件搜索框，后者需要单独拍摄或做浏览器控件检查。

该工具报告可量化变化，不会自动判断某个设计更好，也不替代键盘、可访问性或原生窗口回归。

## 验证

```sh
node --test scripts/compare-ui-baseline.case.mjs
```

覆盖：多通道和透明通道的像素计数/阈值/边界；缺图、额外图、重复与平台不匹配；独立编码 PNG 的真实解码（4 像素中变 1 个，结果 25%）；manifest 哈希错误；HTML 内容转义。本轮 4 项通过。

同一构建的 macOS 改前图与重复截图做过控制组：18 对、差异像素 0，0%。

## 插件搜索框的针对性检查

原有全页基线只拍了“外观”设置，不包含插件页。`scripts/capture-plugin-search-review.mjs` 可在最终构建中重现旧失效选择器与修复选择器，分别拍搜索框普通态和聚焦态，生成组件对比报告及计算样式证据：

```sh
BELFRY_UI_PLUGIN_REVIEW_OUT=/tmp/belfry-ui-plugin-review \
  node scripts/capture-plugin-search-review.mjs
```

“改前”是同一最终构建中将两条选择器恢复为旧的不可达结构，**不是历史构建截图**；报告顶端和 manifest 都明确标记这一条件。对比截图裁切为搜索框及其 3px 焦点环边距，完整视口为 1440×960，具体坐标、背景、焦点状态及旁边按钮的样式/几何记录在 `control-evidence.json`。

检查要求：深色普通/聚焦两态像素完全不变；浅色普通态为 `--surface`、聚焦态为 `--canvas`，两态确有可见变化；搜索框几何与旁边市场按钮的计算样式/几何保持不变。组件证据与主工作台/设置/房间的全页对比需要一起看。
