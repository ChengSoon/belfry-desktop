# T22 房间界面对齐曜石规则（UI设计工程走查 4 项）

修前 `before/macos`（T20 构建）· 修后 `after/macos`（构建 `index-D16QI4zA.js` / `index-D_CL3DCp.css`）· 对比报告 `comparison/index.html`（阈值 0）。

| # | 走查意见 | 改法 | 位置 |
| --- | --- | --- | --- |
| 1 | 当前房间竖条改成圆头短竖条 | `.room-nav-current::before`：上下各留 10px、2px 宽、r2、accent 色，和工作台会话行、设置导航同一规格（原来是 Tailwind 的 `before:inset-y-2`，上下各 8px） | `RoomView.tsx` 房间列表 + `room.css` |
| 2 | 任务卡改为 group + 行分隔 | 每个状态分组外面包一个 `.room-task-group`（1px border、r8、panel 底），每条任务是 `.room-task-row`，行间用 1px `--border-soft`；去掉每张卡自己的描边、圆角、阴影和展开时的 ring；展开中的行用 sidebar-active 底，hover 只换底色 | `TaskCard` + `room.css` |
| 3 | 「+ 新建任务」改为次要按钮 | `.room-task-add`：32 高（`--control-height-sm`）、r6（`--radius-sm`）、surface 底 + inset border，hover 时换成 border-strong；展开表单时 `aria-pressed` 用 sidebar-active 底 | 任务板页头 |
| 4 | 三栏分隔线改用 border-soft | 侧栏 `border-r`、任务板 `border-l` 改为 `border-(--border-soft)`；任务展开区的上边线也同步改了 | `RoomView.tsx` |

只用了令牌，没有写 hex 或 px 色值（尺寸用的是 10px / 2px 这类间距值）。房间逻辑、IPC 和交互都没改：「新建任务」仍然是开关按钮，任务行点击后展开 / 收起的行为不变。

对比结果：12 对截图里只有 `rooms-*-1440x960` 两张有变化（约 6%，集中在左侧当前房间、任务板和分隔线）。720 宽时侧栏和任务板收成抽屉，截图没有差异；设置页和工作台的截图逐像素相同。

验证：tsc 通过；vitest 195 个文件 1263 项通过；build 通过；房间全部浏览器用例 + sidebar-layout + production-ui 共 106/106 通过，零错误。
