# 协作面板重做：时间轴事件流

面向 `src/collab/CollabPanel.tsx` + `src/collab/collab.css` 的一次视觉与信息层级重做。
形态不变——仍是右侧 `clamp(340px, 30vw, 460px)` 的窄栏，不做展开态、不做全屏页。
数据契约不变——不改 `TaskView`、不改 Rust、不加 IPC。

## 为什么改

现在的面板是一列等重的灰框，扫一眼分不出轻重缓急。具体五处：

1. **「进行中」反而最没有生命感。** `collab.css:107-110` 只给了 waiting / failed / done 左边框，
   `running` 和 `gone` 一道都没有。可「已送出 · 完成情况未知」恰恰是最需要表达"它还在跑"的那条。
2. **时间维度整个丢了。** `TaskView.createdAt` 有数据，`CollabPanel.tsx` 从头到尾没渲染。
   用户看到「已送出 · 完成情况未知」，下一个念头必然是"送出多久了"——5 秒和 20 分钟是两回事。
3. **`shortId` 占着右上角黄金位**，但用户几乎用不上（只有去 CLI 对表时才需要）。
4. **`result` 被压成底部一行 `--text-faint` 小字。** 它是对方交差时唯一的解释，
   是 done / failed 卡片上最该被读到的东西。
5. **路由 `A → B` 两个 `strong` 等重**，读不出活在谁手上。

## 骨架：一条贯穿的轨道

每条任务是轨道上的一个节点，时间自上而下流。分组标题（`等你确认` / `进行中` / `已结`）保留，
但组内的卡片边框拆掉——改由轨道承担视觉串联。

```
  等你确认
  ◇  产品经理 → UI            刚刚
  ┆  等你确认
  ┆  设计一个优雅的多 agent 协作 UI 界面。
  ┆                    拒绝   ✓ 批准
  ╵
  进行中
  ◌  产品经理 → UI           2 分钟
  ┆  已送出 · 等对方交差
  ┆  设计一个优雅的多 agent 协作 UI…
  ╵
  已结
  ✓  产品经理 → 测试          14:02
  ┆  已完成（对方自己说的）
  ┆  跑一遍回归测试
  └  都过了，3 个 skip
```

布局：每个事件是 `grid-template-columns: 20px minmax(0, 1fr)`，左列放节点与轨道线，右列放内容。
节点直径 10px，在左列水平居中（轨道线因此落在距事件左边缘 10px 处）。

### 轨道线不许穿过节点

这是本次唯一的实现硬约束，写在最前面：

**用 `::before` 画节点上方的线段、`::after` 画节点下方的线段，两段之间天然留出节点的位置。
不要画一条通长的线再用背景色画个圆盖住它。**

原因是背景图模式（`:root[data-background="on"]`）下面板是半透明毛玻璃，
任何"用 `var(--surface)` 遮挡"的手法都会在图上留一个不透明的小圆斑。分两段画则完全不需要遮挡。

收口规则：组内第一个事件不画 `::before`，最后一个事件不画 `::after`——
线在每组的首尾自然收住，不留断头。线宽 1px，颜色
`color-mix(in srgb, var(--text) 18%, transparent)`。

> 颜色是回修时改的（原为 `var(--border)`，见 `docs/collab-panel-review.md` 第一条）。
> `--border` 在暗色是 `#232428`，压在面板底 `≈#191b21` 上只差 10/255，实测对比度 1.05:1，
> 线整个糊进底色，时间轴的意象立不住。`--text` 兑透明的好处是两个主题自动反向、
> 不用为暗色单写覆盖，半透明还让它在毛玻璃上跟着背景走而不是糊一条实色线。
> 另外线要钉在整数像素上（`left: 10px`，不要 `50%` + `translate(-50%)`）：
> 20px 列里居中会把 1px 的线摆到 9.5px，浏览器劈成两列半强度抗锯齿，1x 屏上等于又暗一半。

## 节点形态

线性描边优先，不要实心块，彩色只落在真正需要注意的状态上。
tone 取值沿用 `src/collab/taskTone.ts` 现有的 `waiting | running | done | failed | gone`，不要新增。

| tone | 节点 | 状态文案色 |
|---|---|---|
| `waiting` | 10px 圆，`2px` 描边 `var(--warning)`，中心透明；外加 `box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent)` 做一圈光晕，让它在列表里拦得住人 | `var(--warning)` |
| `running` | 10px 空心环，`1.5px` 描边 `var(--accent)`，中心透明，**带呼吸动画** | `var(--text-muted)` |
| `done` | lucide `Check`，`size={12}`，`var(--success)`，无边框无底色 | `var(--success)` |
| `failed` | lucide `X`，`size={12}`，`var(--danger)`，无边框无底色 | `var(--danger)` |
| `gone` | 10px 圆，`1px dashed var(--border-strong)`，中心透明——虚线表达"这条线断了" | `var(--text-faint)` |

`running` 的呼吸是这次要补回的"生命感"，也是当前最大的缺口：

```css
@keyframes collab-node-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
```

约 2s、`ease-in-out`、`infinite`。先看 `src/styles.css:191-241` 那段全局工具类——
里面已有 `@keyframes pulse` 和 `.status-dot--*`，**能复用就复用，不要平行再造一套**。
另外确认 `styles.css:247-250` 的 `@media (prefers-reduced-motion: reduce)` 覆盖得到这个动画，
覆盖不到就在 `collab.css` 里补一条。

## 内容列的信息层级

四行，从上到下：

**1｜路由行**（`--fs-xs`）

```
产品经理 → UI                          2 分钟
```

- `fromLabel`：`var(--text-muted)`，字重 400
- 箭头 `→`：`var(--text-faint)`，`aria-hidden`
- `toLabel`：`var(--text)`，字重 500 ——**活在它手上，所以它重**
- 时间：`margin-left: auto`，`var(--text-faint)`，`font-variant-numeric: tabular-nums`
  （等宽数字，否则每次轮询刷新数字宽度会抖）

⚠️ 字重只有 400 / 500 两档可用（`styles.css:76` 设了 `font-synthesis: none`，
`:175` 把 `strong` 压到 500）。现在 `collab.css:119` 写的 `font-weight: 600` 是**无效声明**，顺手改掉。

**2｜状态行**（`--fs-xs`）

`taskTone()` 返回的 `label` 原样用，配色见上表。行尾放 `shortId`：
`var(--text-faint)`、`var(--font-mono)`、`opacity: 0.5`，`:hover` 时提到 `1`，
并加 `user-select: all` 方便双击整段复制。降权但不删除——去 CLI 对表时还得靠它。

**3｜指令行**（`--fs-sm`）

颜色从现在的 `var(--text-muted)` **提到 `var(--text)`** ——指令是任务的主体，
应该是卡片上最实的一行。层级靠字号拉开（路由 `xs` vs 指令 `sm`），不靠颜色压暗。
截断从 3 行收到 **2 行**（窄栏里 3 行太占），`title` 属性挂全文。

**4｜结果块**（仅 done / failed，`--fs-xs`）

从"底部一行 faint 小字"升级为引用块：`border-left: 2px solid var(--border-strong)`、
`padding-left: 8px`、颜色 `var(--text-muted)`（比 faint 亮一档）。
4 行截断，`title` 挂全文，加 `overflow-wrap: anywhere` 防长串撑破窄栏。
现在的 `border-top` 拆掉——轨道已经承担了分隔。

**按钮行**（仅 waiting）：`拒绝` / `批准` 右对齐，沿用现有 `.collab-button` 系列，不动样式。

## 新增：相对时间

新建 `src/collab/relativeTime.ts`，配套 `relativeTime.test.ts`（项目用 vitest，
`src/collab/taskTone.test.ts` 就是现成的写法样板）。

**`createdAt` 是毫秒 epoch**——真源是 `src-tauri/src/collab/server.rs:378-379` 的
`as_millis() as i64`，不是秒，别除错。

函数签名建议 `formatTaskTime(createdAt: number, now: number): string`，
`now` 显式传入而不是函数内部调 `Date.now()`，这样测试不用打桩时钟。

| 距今 | 显示 |
|---|---|
| < 60 秒 | `刚刚` |
| < 60 分钟 | `N 分钟前` |
| < 6 小时 | `N 小时前` |
| 同一天 | `HH:MM` |
| 昨天 | `昨天 HH:MM` |
| 更早 | `M-D` |

小时档是回修时补的（见 `docs/collab-panel-review.md` 第二条）：少了它，凌晨 01:24 看一条
3 小时前派出的活会显示成「昨天 22:24」——语义没错，读起来却像隔了很久。跨天就发生在凌晨，
而凌晨恰恰是这工具用得最多的时段之一。分界放在 6 小时，凌晨那几个钟头就不会被日历日切开。

这套规则不用按分组分叉逻辑就能自然分工：新派的活显示相对时长（回答"跑了多久"），
已结的老活显示时刻（回答"什么时候派的"）。注意最后一档是**创建时刻**不是完成时刻——
`TaskView` 里没有 `completedAt`，别写成"完成于"。

`title` 属性挂完整时间戳（如 `2026-09-03 14:02:31`），hover 能看准。

**不需要额外定时器。** `useCollabTasks.ts:31` 每 1.5s 都 `setTasks(view.tasks)`，
每次都是新数组引用，必定触发重渲染，`刚刚 → 3 分钟前` 会自己跟上。

## 分组头

保留三组，`h3` 沿用 `--fs-xs` / `--text-faint` / 字重 500。行尾补一个计数（`var(--text-faint)`），
让人不展开也知道每组多少条。`已结` 组的 `.collab-group--quiet { opacity: 0.62 }` 保留。

## 空态

保留全部信息，只重排版式——`CollabPanel.tsx:80-85` 那段注释说明了为什么必须把用法说全：
不说全，用户会在这儿找一个并不存在的"新建任务"按钮。现在是 4 段 `p` + 2 个 `code` +
2 个 `small` + 1 段 note，压成三层：一句引导、两条命令（每条带一行说明）、一句注脚。
不要为空态引入插画或大图标。

## 两处顺手修的既有缺陷

**1｜背景图模式下协作面板没垫玻璃。**
`src/background/background.css:87-98` 给 `.usage-panel` 和 `.history-panel` 都写了
`--app-bg-glass` + `--app-bg-glass-filter`，唯独漏了 `.collab-panel`。
背景图一开，这块面板就是一张生硬的不透明板贴在图上，和另外两个右侧面板不是一套东西。
按同样的写法补一条 `:root[data-background="on"] .collab-panel`。

补完要留意 `--text-faint` 压在半透明底上会和透出的图混成同亮度而发虚——
本次设计里 `shortId`（还叠了 `opacity: 0.5`）和路由行时间都吃这个色，是最可能中招的两处。
背景图模式下这两处提档到 `--text-muted`。

**2｜`src/workspace/workspace.css:36` 是死选择器。**
写的是 `.app-shell.is-settings > .collaboration-panel`，实际类名是 `.collab-panel`，
所以进设置页时协作面板不会被隐藏。改成正确类名。

## 边界与约束

- **只改前端呈现。** 不动 `src/collab/api.ts` 的类型、不动 `taskTone.ts` 的 tone 取值和分组谓词、
  不动任何 Rust。唯一新增文件是 `relativeTime.ts` 及其测试。
- **`state` 是开放 string**（`api.ts:33-36`），`taskTone()` 的 `default` 分支会把未知值落到
  `gone`。新样式必须覆盖全部五个 tone，尤其别再漏掉 `running` 和 `gone`——这次就是漏在这儿。
- **间距没有 token**，项目里全是硬编码 px，跟着来即可（面板内现用 13px padding、6/8/16px gap）。
- 图标尺寸走 `src/theme/sizing.ts` 的 `ICON`；节点里的 12px 比 `ICON.xs`(16) 小，
  直接写字面量 12 并在旁边留一句为什么（节点内图标要比常规图标小一档）。
- 面板宽度、`grid-template-rows`、头部、底部工具条、`.collab-button` 系列都不动。
- 可访问性：节点是纯装饰，`aria-hidden`；状态语义由状态行的文字承担。
  轨道线不要用 `border` 画在内容元素上以免被读屏念成分隔。

## 完成前自查

- [ ] `pnpm tsc -b`（**必须 `-b`**，`--noEmit` 在这个仓库会静默空转、零输出且 exit 0，不等于通过）
- [ ] `pnpm vitest run src/collab/`
- [ ] 五个 tone 都有节点样式，`running` 会呼吸，`gone` 是虚线
- [ ] 深色 / 浅色两主题都看过
- [ ] 背景图开 / 关两态都看过，重点看：轨道线有没有在节点处露出不透明圆斑、
      `shortId` 和时间在图上还读不读得清
- [ ] `prefers-reduced-motion: reduce` 下呼吸动画停掉
- [ ] 长指令、长 result、长会话名（窄栏 340px）不撑破布局
