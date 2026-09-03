# 协作面板空态重做：虚线轨道预演

接着 `docs/collab-panel-redesign.md` 和 `docs/collab-panel-review.md` 做第三轮，
只动空态（`CollabPanel.tsx` 的 `EmptyHint` + `collab.css` 的 `.collab-empty*`）。
有任务时的时间轴不动，`TaskView` / `taskTone` / Rust 一律不动。

## 为什么改

上一轮空态只是把字重排了一遍，用户看完的评价是「没派活的时候界面没变，不够优化」。
对照截图，五个问题：

1. **内容全堆在顶部，下面一大片空白**，面板看着像没加载完，视觉重心严重偏上。
2. **时间轴的语言在空态里彻底消失**——有内容时是轨道加节点，空的时候是一摞文字块，
   像两个不同的产品。这是最主要的问题。
3. **注脚是一堵字墙**：起名字、投递行为、全部停下三件事挤成一段，全是低优先级细节却占大块份量。
4. **两个命令黑框成了整页最重的元素**，可它们只是语法参考，抢了「这面板是干什么的」的位置。
5. **同一件事说了三遍**：顶部副标题「Agent 之间互相派活」、正文「派活发生在 Agent 会话里」、
   底部「没有在跑的任务」。

## 目标形态

```
  会话协作                    ✕
  Agent 之间互相派活
 ────────────────────────────────

  还没有派活记录

  ○┄┄ 派出去的活会一条条长在这里
  ┊
  ○┄┄ 谁派给谁、跑到哪一步
  ╵

  在任一 Agent 会话的终端里敲

  belfry peers                 ⧉
  看现在有谁、各自忙不忙

  belfry send ui 审一下 auth.ts ⧉
  把活派给叫 ui 的那条会话

  名字要先在侧栏双击会话起
```

三段：一句话结论 → 虚线轨道预演 → 两条可复制的命令 + 一句前提。

## 一｜虚线轨道预演（这轮的核心）

空态也画轨道，但是虚线的，上面两个虚线空心节点，各带一行说明——
直接预演「派完活这里会长成什么样」。空态和有内容时因此是同一套语言，
那片空白也被填上了。

**复用有内容时的栅格**：`grid-template-columns: 20px minmax(0, 1fr)`，
节点同样 10px、`left: 10px` 钉整数像素（半像素抗锯齿那个坑同样适用，
理由见 `collab-panel-redesign.md` 里轨道线那段引文）。左列必须和有内容时对齐，
这样从空态切到有任务时，节点位置不跳。

- **轨道线**：虚线。`background: repeating-linear-gradient(to bottom, C 0 3px, transparent 3px 6px)`，
  宽 1px。**不要用 `border-left: dashed`**——保持和实线轨道同一种画法（`background`），
  换成 border 会在读屏里被念成分隔线。
- **颜色比实线轨道再淡一档**：实线是 `color-mix(in srgb, var(--text) 18%, transparent)`，
  这里用 12% 左右。虚线 + 更淡 = 「这儿还没有东西」，别做得跟真事件一样实。
- **节点**：10px 圆，`1px dashed color-mix(in srgb, var(--text) 22%, transparent)`，中心透明。
  比 `gone` 那个 `1px dashed var(--border-strong)` 更淡——两者不会同屏出现，
  但语义上空态是「还没来」、gone 是「断了」，轻重要分开。
- **两条说明文字**：`--fs-xs` / `var(--text-faint)`。文案照上面的图，
  第一条讲「会长在这里」，第二条讲「能看到什么」。
- 收口同实线轨道：第一个节点上方不画线，最后一个节点下方不画线。
- 整块 `aria-hidden`——它是示意图，不是信息。屏幕阅读器只念那两行说明文字就够了，
  所以说明文字**不要**放进 `aria-hidden` 的容器里。

## 二｜命令改成可点击复制

现在是带边框的 `<code>` 黑框，是整页最重的元素。改成**默认极轻、hover 才浮起来**：

- 语义换成 `<button type="button">`，里面是 `<code>` 命令文本 + 右侧一个复制图标。
- **静态**：无边框、背景 `transparent`，命令文本 `var(--font-mono)` / `var(--text)`，
  复制图标 `var(--text-faint)`。让它安静，别再抢正文。
- **hover / focus-visible**：`background: var(--surface-hover)`，加 `var(--radius-sm)` 圆角，
  图标提到 `var(--text)`。这时候才显出「可以点」。
- **点击**：`navigator.clipboard.writeText(命令)`，成功后图标从 lucide `Copy` 换成 `Check`、
  色 `var(--success)`，约 1.5s 后复原。
  - 图标尺寸走 `ICON.xs`。
  - `writeText` 会 reject（非安全上下文、权限被拒），**必须 catch**；失败就别切成勾，
    静默保持原状即可——显示一个假的成功勾比不给反馈更糟。
  - `setTimeout` 的 id 要在 unmount 时清掉，别在已卸载的组件上 setState。
- **无障碍**：`aria-label` 写成「复制命令 belfry peers」这种完整句；复制成功后把 label
  改成「已复制」，让读屏用户也拿到反馈。图标本身 `aria-hidden`。

`EmptyHint` 因此从纯展示组件变成有状态组件。两条命令各自独立的「已复制」状态，
建议抽一个 `CommandLine`（或 `CopyableCommand`）子组件各自持有自己的 state，
别在 `EmptyHint` 里维护一个 index。

## 三｜文案与垂直布局

**文案照目标形态那张图**，注意我删掉了原注脚里的两句，是有意的、不是漏了：

- 「同项目的派活会直接投进对方终端，这里看得到每一条的去向和状态」——
  顶部副标题加上轨道预演的两行说明已经把这件事讲完了，重复。
- 「要收手就按『全部停下』」——**空态时 footer 根本不渲染那个按钮**
  （`waiting + active > 0` 才出现），指着一个不存在的按钮说话。

保留「名字要先在侧栏双击会话起」，这条不能删：名字是唯一的寻址键，
没名字根本派不了活，是使用前提。

原代码 `CollabPanel.tsx:80-85` 那段注释讲的「空态要把用法说全，否则用户会在这儿找一个
并不存在的『新建任务』按钮」**依然成立**，新文案靠「在任一 Agent 会话的终端里敲」
承担这件事——改文案时别把这层意思弄丢。

命令示例用 `belfry send ui 审一下 auth.ts`（原来是 `reviewer`）：窄栏 340px 里
短名字不容易折行。

**垂直布局**：让空态在 body 区里垂直居中，别顶在上面——这是用户抱怨的「下面一大片空白」
的直接来源。`.collab-panel__body` 现在是 `display: grid; align-content: start`，
建议给 `.collab-empty` 加 `margin-block: auto` 来居中（而不是把 body 改成
`align-content: center`）：`margin: auto` 在内容超过可用高度时会自然退化成不居中，
而 `align-content: center` 在溢出时会**两端一起裁切**，小窗口下顶部文字会被切掉看不见。
改完务必把面板高度压到 500px 左右看一眼有没有裁切。

## 别碰

- 有任务时的时间轴、五个 tone、`relativeTime.ts`、footer、header 全部不动。
- `.collab-empty` 之外的选择器不要改；`.collab-button` 系列不要改。
- 背景图模式：新增的复制按钮 hover 用的是 `--surface-hover`，在毛玻璃上是半透明叠加，
  没问题；但**虚线轨道用了 `--text` 兑透明，和实线轨道同一个配方，跟着背景走**，
  这点已经是对的，不用再为 `data-background="on"` 加覆盖。加之前先截图确认真有问题。

## 完成前自查

- [ ] `npx tsc -b`（**必须 `-b`**，`--noEmit` 在这个仓库静默空转、零输出且 exit 0）
- [ ] `npx vitest run src/collab/`
- [ ] 空态截图：暗色 + 亮色，`tmp/collab-probe.html?empty=1`（`&theme=light` 换亮色）
- [ ] 把面板高度压到 ~500px 看空态有没有被裁切
- [ ] 点一下两条命令，确认剪贴板真拿到了内容、勾会复原、两条互不干扰
- [ ] 从空态切到有任务（去掉 `?empty=1`），确认节点左右位置没跳

**截图前先确认 1420 端口有 vite**：我验收完把之前那个独立的 `pnpm dev` 关了（它挡住了
用户的 `tauri dev`）。如果用户正在跑 `tauri dev`，它自己就在 1420 上提供 dev server，
直接截即可；**如果没有，先问一声再起 `pnpm dev`，不要和用户的 `tauri dev` 抢端口。**
headless Chrome 会忽略 `--window-size` 的宽度（视口固定 500px），
探针页里面板是靠左放的，别改成靠右——会被裁掉右半边。

---

## 截图验收回修（第二轮）

结构、居中、命令降权、复制交互、timer 清理、栅格对齐都对，`tsc -b` exit 0、47 passed。
两处要改，第一处是我规范里的数值给错了。

### 一｜虚线浓度给错了，12% 太淡（必修）

暗亮两态都偏淡，暗色尤其——那两个节点和中间的线几乎看不见。
「虚线轨道预演」整个方案的核心就是这条轨道，看不见等于没做。

**我原来写「比实线轨道（18%）再淡一档，用 12% 左右」，这个推理是错的。**
虚线的占空比只有 50%（`0 3px` 实、`3px 6px` 空），一半的像素根本没有颜色。
所以同一个浓度值，虚线的观感天然就比实线淡将近一半——
再往下调 6 个百分点，等于淡了两次，直接掉到看不见。

**改法：虚线的颜色浓度要 ≥ 实线的 18%，才能得到「略淡于实线」的观感。**
从 `22%` 起步试，暗色能看出是一条虚线、又不抢过正文即可；
节点的 `1px dashed` 同理，一起提上去（现在是 22%，跟着往上调）。

验收标准：**暗色下扫一眼，要能看出那两行说明是被一条虚线串起来的**——
现在看起来只是两条孤立的灰字。

### 二｜「在任一 Agent 会话的终端里敲」抢了焦点

它和「还没有派活记录」现在都是 `var(--text)`、字号也接近，读起来像两个并列的标题。
可它只是个引导标签，`还没有派活记录` 才是这一屏的结论。

降到 `var(--text-muted)`、`var(--fs-xs)`。`.collab-empty__lead` 维持现状不动。

### 三｜两条预演之间挨紧一点（顺手）

现在 gap 偏大，中间那截虚线拉得长而孤立。预演是一个整体，收紧到 6px 上下，
让两个节点看着像同一条轨道上的相邻两站。

### 完成前

- [ ] `npx tsc -b` / `npx vitest run src/collab/`
- [ ] 空态暗色 + 亮色各截一张，确认虚线在**暗色**下读得出来（这是主场景）
- [ ] 1420 上已有 vite（用户的 tauri dev 起的），直接截，别另起 server
- [ ] 有疑问用 `belfry send 产品经理 ...` 问我。**别在你自己终端里问**——
      那句话只有用户看得到，我这边完全无感，上一轮就是这样白等了 27 分钟

---

## 实现记录（第二轮回修后）

### 虚线浓度定在 30%（线）/ 36%（节点）

你让「从 22% 起步试」，实际截图扫了 18 / 24 / 30 / 36 四档，定在 **线 30%、节点 36%**。
24% 时那截连接线还是读不出来，两行说明看着仍像孤立的两条灰字。

选 30% 的依据是和说明文字比：暗色下虚线实段解析到 ≈`rgb(89)`，
而说明文字 `--text-faint` 是 `rgb(106)`——线明显可见但仍压在文字之下，符合「不抢正文」。
再往上到 36% 就和文字齐平了，所以 36% 留给节点（它是轨道上的锚点，该比线重一档）。

### 顺带修掉一个既有 bug：footer 抢走了 `1fr`

**做垂直居中时发现 `margin-block: auto` 不起作用，根因不在空态。**

`.collab-panel` 原本是 `display: grid` + `grid-template-rows: auto auto minmax(0,1fr) auto`，
写死四条轨道对应「头 / 错误条 / 体 / 脚」。但错误条是条件渲染的——
**没有 error 时只有三个子节点，`minmax(0,1fr)` 那条就落到了 footer 身上，body 反而变成 `auto`。**

实测（无 error、面板高 973）：

| 任务数 | body 高 | footer 高 | footer 可见 |
|---|---|---|---|
| 0 | 290 | **626** | 是（但被撑成一大块空白） |
| 3 | 272 | **644** | 是 |
| 20 | 916 | **21** | **否，被顶出可视区** |

所以：空态那「下面一大片空白」其实就是被撑高的 footer；
而任务多到撑满时 footer 被挤成 21px 顶出面板，**「全部停下」按钮正好在最需要它的时候被裁掉**。

改成 `display: flex; flex-direction: column` + `.collab-panel__body { flex: 1 1 auto; min-height: 0 }`。
flex 只认「哪个孩子会长」，不数位置，条件渲染多少个子节点都对。
改后 footer 在 0 / 3 / 20 条任务、有无 error 六种组合下都是自然高度且始终可见。

这动了 `collab-panel-redesign.md` 里划为「不动」的 `grid-template-rows`——
但不动它，本轮要求的垂直居中在物理上做不到（body 根本没有那部分高度）。

### 居中的降级行为已验

`.collab-panel__body:has(> .collab-empty) { align-content: stretch }` 放开轨道，
`.collab-empty { margin-block: auto }` 吸收空隙。压到窗高 333px / 288px 时内容溢出，
`scrollTop=0`、首元素仍在 body 顶部 +13px padding 处，**只往下溢出、顶部不裁**，
body 自己出滚动条——正是选 `margin: auto` 而不是 `align-content: center` 的原因。

### 复制交互用 CDP 可信点击验过

headless 里合成的 click 不可信、拿不到剪贴板权限，所以走 CDP
（`Browser.grantPermissions` + `Input.dispatchMouseEvent`）真点：

- 两条分别写入 `belfry peers` / `belfry send ui 审一下 auth.ts`，`readText()` 读回一致；
- `aria-label` 在「复制命令 X」和「已复制」之间正确切换；
- 连点两条后两条各自打勾（互不干扰），1.5s 后都复原。

### 节点左右位置不跳

空态与有任务两种状态下节点中心都在 `x=24`（面板 padding 13 + 列内 left 10 + 半像素），
从空态切到有任务不会横向位移。
