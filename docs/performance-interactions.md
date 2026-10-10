# 主界面交互与性能验收

## 完成范围

- 会话行 hover、按下、焦点及选中反馈；侧栏、工具栏、确认框、Quick Open、协作/历史面板按钮按压反馈，禁用按钮不缩放。
- 分组采用自然高度 grid 过渡，折叠内容保持 inert；支持快速反转和行内重命名。
- 确认框/Quick Open 与协作/历史抽屉共用动效规则：进入 220ms、退出 180ms、按钮 120ms。逻辑关闭立即解除交互和焦点监听，退出画面由定时器移除，不依赖 animationend。
- `prefers-reduced-motion: reduce` 关闭新增高度、位移、缩放动画，并立即移除退出面板。
- 保留满高侧栏、底部工具区、独立列表滚动和不裁切菜单；收起时保留零宽轨道，设置页隐藏侧栏，右侧面板不引起主区域换行。
- 不对终端画面做动画，不通过卸载终端实现过渡；面板尺寸一次切换，动画仅使用 transform/opacity。
- 已成功加载的可选面板复用 `React.lazy` 实例，避免重开闪现加载壳；失败及显式重试更新实例，保留共享依赖失效保护。
- 新建会话菜单支持方向键、Home/End、Esc 分级返回、跳过不可用项、Tab 离开关闭和焦点返回；菜单进入 120ms，减少动态效果时关闭动画。
- 重新检测提供忙碌文字/图标和同步防连点锁；请求期间关闭重开仍保持忙碌，失败显示可读原因，支持重试，卸载后不更新局部状态。
- Quick Open 接入统一模态焦点层，Tab/Shift+Tab 不逃出弹窗；结果鼠标操作保留搜索焦点，快速重开重置搜索和选择，空结果及全部不可用时不会执行动作。
- Agent/SSH 重命名支持 F2；Enter 提交或 Esc 取消返回对应会话按钮，鼠标点击别处提交不抢焦点；校验原因以可见提示和 aria-describedby 关联输入。

## 已测热点及优化

1. `TerminalStage` 内 `SessionTerminal` 使用 `memo`，避免舞台拖拽或侧栏开合引起无关终端渲染；真实 tab、可见性、焦点或回调变化仍正常更新。
2. `useSessionDrag` 每帧提交最新坐标及命中测量；阈值逐事件判断，pointerup 使用松手坐标，而不是待提交坐标。取消、替换手势、卸载均清理监听及 RAF。
3. body 拖拽 class effect 依赖布尔值，不随每次坐标提交反复移除/添加。
4. Sidebar 分组计算使用 memo；本轮仅量化上述终端/拖拽热点，不推断分组缓存的收益。

### 前后实测

同一 Chrome `154.0.8037.99`、1440×960、三个合成会话 A/B/C；A 初始可见，B/C 隐藏。使用实际 `TerminalStage`、`useSessionDrag`、xterm 和模拟原生 IPC。基线在修改热点前采集；最终结果重新采集并通过回归断言，与此前三轮优化结果一致。

| 相同操作 | 指标 | 优化前 | 优化后 |
| --- | --- | --- | --- |
| 侧栏收起 | SessionTerminal A/B/C 渲染 | 1/1/1 | 0/0/0 |
| 侧栏展开 | SessionTerminal A/B/C 渲染 | 1/1/1 | 0/0/0 |
| A→B→A | SessionTerminal A/B/C 渲染 | 2/2/2 | 2/2/0 |
| 60 次 move，分 5 个帧批次 | 非空拖拽状态提交 | 60 | 5 |
| 同上，含松手清理 | 探针宿主提交 | 61 | 6 |
| 同上 | SessionTerminal A/B/C 渲染 | 61/61/61 | 0/0/0 |
| 同上 | body class 属性变更 | 120 | 2 |

渲染计数通过仅测试用 Vite transform 注入，生产代码无计数器。探针不挂载整个 App，不包含快照驱动的 tab 更新或 StrictMode 双渲染；pointer 事件用 flushSync 分隔，避免 React 自动批处理掩盖逐事件状态提交。因此这些是同条件热点计数，不是全应用正常调度的提交预测，也不是 FPS 或系统性能承诺。

生产构建的抽屉测试另外观察终端舞台 ResizeObserver：每种主题/尺寸的“打开协作→切换历史→关闭历史”均为 4 个宽度样本（含初始样本），两个合成终端共 6 次 terminal_resize，而非动画逐帧 resize。终端 DOM 未重建，输入仍能经模拟 IPC 写入。

CI 后续发现协作外部关闭在 mousedown 提前执行，慢速“按下→松开”切换历史时出现无面板轨道，额外产生两次 PTY resize。长按目的按钮 200ms 的回归在旧代码上稳定失败；协作抽屉改在 click 处理外部关闭后，同一事件切换面板，六组主题/尺寸仍保持 4 个宽度样本、6 次 resize。普通菜单维持 mousedown 行为，协作的外部点击和 Esc 另有回归。

hover 回归发送无按键鼠标移动、等待稳定命中及真实 :hover/按压样式，不依赖固定 150ms 睡眠。macOS 的完整插件/浏览器套件串行运行，避免并行 Chrome 的初始化/截图资源竞争；不跳过用例、不延长生产 CDP 超时。

## 验证结果

- `pnpm build`：通过；保留已有的 >500kB chunk 警告。
- `pnpm exec vitest run`：153 个文件、876 项测试通过。
- 以下浏览器套件合并串行执行：23 项全部通过，错误及未处理异常检查通过。
  - `sidebar-layout.case.mjs`：两种主题、1888×1070 / 1440×960 / 820×500，侧栏、菜单、调整宽度及持久化、右侧面板、设置页、终端存活。
  - `motion.case.mjs`：20 会话长列表、12 次中断折叠、F2/Enter/Esc 重命名及错误关联、禁用/按压状态、焦点返回及循环、重复确认保护、弹层重开、24 次抽屉切换、协作开关按钮、减少动态效果。
  - `perf-interactions.case.mjs`：前述计数断言及拖拽阈值、最终坐标、取消、最新目标、手势替换、卸载清理、终端输入。
  - `production-panels.case.mjs`：JS/CSS 加载失败重试、共享依赖失效保护、新文档恢复；退出等待避免误读旧面板的错误提示。
  - `production-ui.case.mjs`：既有工作台及面板行为回归。
  - `interaction-details.case.mjs`：实际菜单和 Quick Open 组件、StrictMode、真实浏览器键盘/鼠标；子菜单返回、禁用项、外部点击及 Tab 关闭、同一轮三次检测点击仅发起一个请求、重开忙碌状态、失败重试和卸载、焦点循环、搜索重置、空结果及不可用动作保护。
- `git diff --check`：通过。

### 复验命令

```sh
pnpm build
pnpm exec vitest run
node --test --test-concurrency=1 \
  src/components/lazy/testing/sidebar-layout.case.mjs \
  src/components/lazy/testing/motion.case.mjs \
  src/components/lazy/testing/production-ui.case.mjs \
  src/components/lazy/testing/production-panels.case.mjs \
  src/components/lazy/testing/perf-interactions.case.mjs \
  src/components/lazy/testing/interaction-details.case.mjs
```

可用 `PERF_REPORT=/absolute/path/report.json` 输出当前性能计数；`PERF_BASELINE=1` 仅关闭优化后计数断言，并不还原源代码，只有在优化前源码上运行才代表基线。`BELFRY_PANEL_ARTIFACTS=/absolute/path/artifacts` 输出浏览器截图及布局证据。

## 验证限制

浏览器使用隔离的合成会话和原生 IPC 适配器，没有读取真实用户数据、关闭正在运行的用户终端或修改 Rust 后端。尚未进行真实 Tauri 桌面/原生 PTY 验证，不能据此宣称 macOS/Windows 桌面运行已验证。当前没有阻止上述验收测试通过的 blocker。
