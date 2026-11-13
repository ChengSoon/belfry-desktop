# T28：右侧内容铺满

用户最新要求「右侧不允许留白」，覆盖 T23/T27 中照静态稿设置的 880px 页面上限和 Provider 空轨道。

[修前 / 修后并排截图](index.html)。本次全部由资深全栈工程师2独立完成。

## 改动

- 外观与其余 7 个设置分区全部填满导航右侧的可用正文宽度，删除固定最大宽度限制。页面边缘保留桌面 32px / 窄窗 24px 或 16px 的正常内边距。
- Provider 网格改为 `auto-fit`，没有卡片的轨道收起。只有一张卡时占满整行，2 张等分为两列，3 张等分为三列；窄窗按空间换行。
- 保留 240px 导航、浮起面 8px 内缩 / r12 / 投影、macOS 交通灯和 Windows 标题栏让位、壁纸 / 字号设置及 Provider 动效。

源码：`src/components/obsidianSurfaces.css`、`src/settings/obsidianSections.css`、`src/provider/provider.css`。

## 验证

- `pnpm build` 通过，构建 `index-CL108bek.js` / `index-C7otyy4J.css`。
- `pnpm test`：196 文件 / 1267 项通过。
- 设置布局生产用例 **4/4**：1920 / 1440 / 640 视口实际正文宽等于可用宽度；1 / 2 / 3 张 Provider 卡片亮暗主题没有空轨道；两平台标记、亮暗、1440 / 720 / 640 下内容铺满且无横向溢出。
- 分区截图与最大字号脚本 **3/3**：7 个分区亮暗截图逐一断言正文占满可用宽度；两平台标记 720×480、字号 20 的 28 张截图无横向溢出；终端保持挂载。
- 现有设置 / Provider / 工作台和动效回归 **15/15** 通过，零 console error、页面异常或未处理 IPC；`logs/regression.log`。
- 并排报告实际打开验证：54/54 图片加载完成，1280px / 700px 无横向溢出；`logs/report.log`。
- `git diff --check` 通过。本次没有更改颜色、原生窗口或 Git 逻辑。

所有截图使用最终生产构建、合成 IPC 与隔离 Chrome。原生 WebView 验证范围沿用 T27 说明。

## 产物

- `before/`：T27 的 24 张原始截图（本次改动前保留）。
- `after/`：两平台浮起外壳，以及 1 / 2 / 3 张 Provider 的亮暗截图。
- `sections/`：7 分区与快捷键录制态，亮暗共 16 张。
- `stress/`：两平台、7 分区、亮暗、720×480 / font20 共 28 张。
- `manifest.json`：构建资产、截图、日志 SHA-256；`logs/`：本次实际运行记录。

复现：

```sh
pnpm build
pnpm test
BELFRY_HANDOFF_ARTIFACTS=docs/design/belfry-ui/settings-shell/full-width/after node --test --test-concurrency=1 --test-name-pattern=settings src/components/lazy/testing/ui-handoff.case.mjs src/components/lazy/testing/settings-layout.case.mjs
BELFRY_SECTIONS_OUT=docs/design/belfry-ui/settings-shell/full-width/sections BELFRY_SETTINGS_STRESS_OUT=docs/design/belfry-ui/settings-shell/full-width/stress node --test --test-concurrency=1 scripts/capture-settings-sections.case.mjs scripts/capture-settings-stress.case.mjs
node --test --test-concurrency=1 src/components/lazy/testing/production-ui.case.mjs src/components/lazy/testing/motion.case.mjs
```
