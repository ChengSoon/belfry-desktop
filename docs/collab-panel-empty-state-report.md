# 空态重做 · 完成报告

对应任务 `156hkjem`（重做空态）、`mcaza6ky`（用已有 vite）、`2bvyrjbq`（第二轮回修）。

## 先说一件事：这三条我 `belfry done` 不掉

我的会话中途重启了，`tabId` 换成了 `17926392-441c-4c81-ad93-043a249cb36e`，
`belfry peers` 里我现在显示成「(未命名)」（原来是 `uinew`）。
三条任务都是派给旧 tab 的，`belfry done` 一律回 `这条任务不是派给你的`，`belfry inbox` 也是空的。

**所以请你手动把这三条结掉**，或者重新派一条给现在这个 tab 我再走一遍流程。
活本身全做完了，下面是交付内容。

## 第二轮回修的三处

### 一｜虚线浓度：线 30% / 节点 36%

你对占空比的分析是对的——虚线 50% 占空，同数值观感淡近一半，
按「比实线淡一档」调 12% 等于淡了两次。

截图扫了 18 / 24 / 30 / 36 四档，定在**线 30%、节点 36%**，比你建议的 22% 起点高。
24% 时那截连接线仍读不出来，两行说明看着还是孤立的两条灰字。

选 30% 的依据是拿说明文字当标尺：暗色下虚线实段解析到 ≈`rgb(89)`，
说明文字 `--text-faint` 是 `rgb(106)`——线明显可见，但仍压在文字之下，符合「不抢正文」；
再往上到 36% 就和文字齐平了，所以 36% 留给节点（轨道上的锚点，该比线重一档）。

### 二｜引导标签降权

「在任一 Agent 会话的终端里敲」降到 `var(--text-muted)` / `var(--fs-xs)`。
`.collab-empty__lead` 未动。

### 三｜两行预演收紧到 6px

## 顺带修掉一个既有 bug（不修则本轮的居中做不到）

做垂直居中时发现 `margin-block: auto` 不生效，根因不在空态。

`.collab-panel` 原本是 `display: grid` + `grid-template-rows: auto auto minmax(0,1fr) auto`，
写死四条轨道对应「头 / 错误条 / 体 / 脚」。但**错误条是条件渲染的**——
没有 error 时只有三个子节点，`minmax(0,1fr)` 落到了 **footer** 身上，body 反而变成 `auto`。

实测（无 error、面板高 973）：

| 任务数 | body 高 | footer 高 | footer 可见 |
|---|---|---|---|
| 0 | 290 | **626** | 是（撑成一大块空白） |
| 3 | 272 | **644** | 是 |
| 20 | 916 | **21** | **否，被顶出可视区** |

所以空态那「下面一大片空白」其实就是被撑高的 footer。
更要紧的是任务多时反过来：20 条任务时 footer 被挤成 21px 顶出面板，
**「全部停下」按钮正好在最需要它的时候被裁掉**。这是既有 bug，不是本轮引入的。

改成 `display: flex; flex-direction: column` + `.collab-panel__body { flex: 1 1 auto; min-height: 0 }`。
flex 只认「哪个孩子会长」，不数位置，条件渲染多少个子节点都对。
改后 footer 在 0 / 3 / 20 条任务 × 有无 error 六种组合下都是自然高度且始终可见。

这动了 `collab-panel-redesign.md` 里划为「不动」的 `grid-template-rows`——
但不动它，垂直居中在物理上做不到（body 根本没有那部分高度）。理由已写进实现记录。

## 自查结果

- `tsc -b` exit 0；`vitest run src/collab/` 47 passed
- 暗亮各一张：`tmp/empty-dark.png`、`tmp/empty-light.png`
- **压到窗高 333px / 288px**：内容只往下溢出，`scrollTop=0`、首元素仍在 body 顶部 +13px padding 处，
  顶部不裁、body 自己出滚动条——正是选 `margin: auto` 而不是 `align-content: center` 的原因
- **复制交互用 CDP 可信点击真验的**（headless 里合成 click 拿不到剪贴板权限，
  走 `Browser.grantPermissions` + `Input.dispatchMouseEvent`）：
  - 两条分别写入 `belfry peers` / `belfry send ui 审一下 auth.ts`，`readText()` 读回一致
  - `aria-label` 在「复制命令 X」↔「已复制」正确切换
  - 连点两条后两条各自打勾、互不干扰，1.5s 后都复原
- 空态与有任务两态节点中心都在 `x=24`，切换不横向跳

## 关于 dev server

全程用 1420 上已有的 vite，没另起 server。
它中途掉过一次（**不是我 kill 的**，本轮没跑过 `pkill`），按你文档要求没抢端口，
问了用户，用户自己重启了 `tauri dev`，之后继续截完。

`tmp/` 里只删了我自己的临时文件；你的 `collab-probe.html` 和
`collab-*.png` / `empty2-*` / `empty3-*` / `verify-*` 都留着。

## 改动文件

- `src/collab/CollabPanel.tsx` — `EmptyHint` 重写 + 新增 `PreviewRow` / `CopyableCommand`
- `src/collab/collab.css` — `.collab-empty*` 全套；`.collab-panel` 换 flex 列
- `docs/collab-panel-empty-state.md` — 末尾追加「实现记录」节

全部仍在工作区未提交。
