# 批次 1：主题一致性与基础令牌

2026-11-12，房间「UI设计」T4。对应 [refresh-plan](../refresh-plan.md) A01、基础令牌入口及追加的 A06。

启动页、首帧脚本和 React 运行时的 meta theme-color 已统一为深色 `#171a19` / 浅色 `#fcfbf7`，与 CSS 和 xterm 画布一致。颜色唯一来源为 `src/theme/canvas.json`：React/xterm 直接引用，Vite 的 `scripts/theme-canvas.ts` 为 CSS 和 HTML 注入取值，首帧脚本读取 HTML meta。下一批只需修改这份 JSON 的画布值；没有新增内联脚本、运行时请求或全局对象。保留原画布、ANSI 色、文字层级和浅色 raised 取值。

[styles.css](../../../../src/styles.css) 新增 space、控件/行/头部尺寸、radius-full 与统一 motion 入口；保留 radius-xs/sm/md/lg、duration、ease 等旧变量名，旧 duration/ease 映射到统一时序/曲线。动效定义从局部 motion.css 收到全局入口，退出仍为 **180ms**，与 Presence 生命周期定时器一致。此次只提供尺寸令牌，现有模块的尺寸引用后续逐批迁移。

插件中心的浅色搜索规则修正为根主题在前的选择器，普通状态使用 `--surface`，焦点状态使用 `--canvas`，替代失效规则中的独立灰白色。

## 验证

| 检查 | 结果 |
| --- | --- |
| 主题/xterm/备份启动/存储/排版/终端主题定向 Vitest | 6 文件、69 项通过（包含在全量回归中） |
| `pnpm test` | **193 文件、1250 项通过** |
| `pnpm build` | **通过**；仍有大于 500kB 的分块提示 |
| 生产 UI 浏览器回归 `production-ui.case.mjs` | **9 组通过，0 失败、0 跳过**；运行时 meta/CSS 一致，插件浅色普通/焦点表面验证通过 |
| T2 截图脚本，macOS/Windows 布局各一次 | **2 组通过**；主工作台、设置、房间 × 双主题 × 1440×960，共 12 张改后截图；浏览器 errors/unhandled 为空 |
| 改前/改后截图 SHA-256 对照 | **12/12 一致**；本批 meta/令牌基础修复不改变这些视图的稳定像素 |
| T6 独立完整矩阵复核 | **36/36 全页严格 0 差异，0 / 29,808,000 像素**；36 处 meta/canvas 一致 |
| JS 语法与 whitespace 检查 | 通过 |

新增回归验证了替换唯一画布配置后，构建 HTML/CSS 和首帧会共同采用新值；并执行了真实 `public/startup.js`：显式亮/暗偏好覆盖系统、未固定时跟随系统、无效偏好回退、存储不可用时的深色回退，以及 HTML 默认色/CSS/xterm 一致性。生产浏览器另验证 React 切换主题后的 meta。

全量回归首次暴露原有 `src/collab/useCollabTasks.test.ts` 在 Node 中只模拟 window、没有 navigator，语言切换用例报 `navigator is not defined`，单独运行同样失败。已在该测试夹具补充 navigator.languages/language，之后全量通过；协作生产代码未修改。

浏览器使用生产 `dist` 和合成 IPC 数据，独立 Chrome profile，未读取真实用户数据。这些截图采用 macOS/Windows 的平台标记和宿主布局，**不是原生 Tauri 窗口截图**，不验收原生材质、系统缩放或真实 PTY。现有 remote/rooms 未提交功能改动保持原状，本批未编辑这些文件。

## 改前 / 改后截图

T2 的改前基线保留在 [baseline](../baseline/)。本批改后图另存 `verified/`，每个平台的 manifest 包含资产/截图哈希与合成数据边界。表内为 1440×960；改前基线还包含 1080×700、720×480，生产 UI 浏览器回归额外覆盖 1024×768、820×768。

| 平台 / 视图 | 深色 | 浅色 |
| --- | --- | --- |
| macOS 工作台 | [改前](../baseline/macos/workbench-dark-1440x960.png) · [改后](verified/macos/workbench-dark-1440x960.png) | [改前](../baseline/macos/workbench-light-1440x960.png) · [改后](verified/macos/workbench-light-1440x960.png) |
| macOS 设置 | [改前](../baseline/macos/settings-dark-1440x960.png) · [改后](verified/macos/settings-dark-1440x960.png) | [改前](../baseline/macos/settings-light-1440x960.png) · [改后](verified/macos/settings-light-1440x960.png) |
| macOS 房间 | [改前](../baseline/macos/rooms-dark-1440x960.png) · [改后](verified/macos/rooms-dark-1440x960.png) | [改前](../baseline/macos/rooms-light-1440x960.png) · [改后](verified/macos/rooms-light-1440x960.png) |
| Windows 工作台 | [改前](../baseline/windows/workbench-dark-1440x960.png) · [改后](verified/windows/workbench-dark-1440x960.png) | [改前](../baseline/windows/workbench-light-1440x960.png) · [改后](verified/windows/workbench-light-1440x960.png) |
| Windows 设置 | [改前](../baseline/windows/settings-dark-1440x960.png) · [改后](verified/windows/settings-dark-1440x960.png) | [改前](../baseline/windows/settings-light-1440x960.png) · [改后](verified/windows/settings-light-1440x960.png) |
| Windows 房间 | [改前](../baseline/windows/rooms-dark-1440x960.png) · [改后](verified/windows/rooms-dark-1440x960.png) | [改前](../baseline/windows/rooms-light-1440x960.png) · [改后](verified/windows/rooms-light-1440x960.png) |

插件搜索浅色：[普通状态](verified/plugins-search-light.png) · [键盘焦点状态](verified/plugins-search-light-focus.png)。这两张来自生产 UI 浏览器回归，T2 改前矩阵未包含插件页。

T6 已固定本批最终构建 `index-C0vVt1iT.js` / `index-Cm-BAe-t.css`，补齐两平台各 18 张完整矩阵并完成独立复核：[结论](visual-review.md) · [macOS 并排与像素差异](comparison/macos/index.html) · [Windows 并排与像素差异](comparison/windows/index.html)。插件另有 [控件报告](plugin-search/report/index.html)：同构建重现旧失效选择器，暗色普通/焦点均无差异，浅色表面与焦点环按预期变化；这组证据和真实改前基线明确分开。

## 重跑

先执行 `pnpm build`，再按顺序运行，避免多个浏览器实例争用渲染资源：

```sh
pnpm test
BELFRY_PANEL_ARTIFACTS=/tmp/belfry-ui-t4-browser-final node --test --test-concurrency=1 src/components/lazy/testing/production-ui.case.mjs
BELFRY_UI_PLATFORM=macos BELFRY_UI_SIZES=1440x960 BELFRY_UI_BASELINE_OUT=/tmp/belfry-ui-t4-after/macos node scripts/capture-ui-baseline.mjs
BELFRY_UI_PLATFORM=windows BELFRY_UI_SIZES=1440x960 BELFRY_UI_BASELINE_OUT=/tmp/belfry-ui-t4-after/windows node scripts/capture-ui-baseline.mjs
```

截图使用 T2 的 [capture-ui-baseline.mjs](../../../../scripts/capture-ui-baseline.mjs)，依赖现有仓库 Chrome 测试设施。完整生产浏览器截图位于本轮 `/tmp/belfry-ui-t4-browser-final/`；精选证据随此文档保存。
