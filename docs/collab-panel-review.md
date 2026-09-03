# 协作面板重做 · 截图验收回修

对应任务 `j1h4gnmm`（那条指令走 CLI 时被截断了，完整要求以本文件为准）。

验收结论：**整体达标**。`tsc -b` exit 0、44 个测试全绿；五个 tone 的节点形态、轨道收口、
长会话名省略、指令两行截断、result 引用块、shortId 降权、分组计数都对；
空态干净；`background.css` / `workspace.css` 两处既有缺陷修得准确。

下面两处回修。

## 一｜暗色下轨道线几乎看不见（必修）

亮色主题正常，暗色主题下那条线基本融进底色——`--border` 的 `#232428` 压在面板底
`#16171a` 上亮度差太小。轨道是这套设计的骨架，线看不见，整个面板就退化成
「一列带图标的条目」，时间轴的意象没立住。

**你提的 `color-mix(in srgb, var(--text) N%, transparent)` 比我原来说的 `--border-strong` 好，就按你的来。**
理由是 `--text` 在暗色是浅色、亮色是深色，做成半透明两个主题自动反向，
不用为暗色单写一条覆盖——所以我原指令里「只在暗色下改、亮色别动」那半句作废，
一条声明搞定两个主题。

`N` 自己截图调。起点建议 12% 左右，验收标准是**暗色下的线要和亮色下现在的可见度相当**：
扫一眼能看出节点是被一条线串起来的，但不能抢过节点本身和正文。

顺带一提：`.collab-event--waiting` 的节点有 `box-shadow: 0 0 0 3px` 光晕，
范围是 1~17px，而下段线从 16px 起，二者重叠 1px。目前看不出问题，**不用改**，
只是你调线色变亮之后再扫一眼那条 waiting 的节点周围有没有变脏。

## 二｜时间分档缺小时档（我规范没定好，锅在我）

现在的分档是「< 60 秒 → 刚刚 / < 60 分钟 → N 分钟前 / 同天 → HH:MM / 昨天 → 昨天 HH:MM / 更早 → M-D」。

问题出在凌晨：我截图时是 01:24，一条 3 小时前派出的活直接显示成
**「昨天 22:24」**——语义上没错，读起来却像隔了很久，而它其实才 3 小时。
跨天发生在凌晨，恰恰是这个工具被用得最多的时段之一。

**在分钟档和时刻档之间加一档：`< 6 小时 → N 小时前`。** 补上对应单测，
边界（5:59:59 → `5 小时前`，6:00:00 → 落到时刻档）都要覆盖。

`docs/collab-panel-redesign.md` 里那张分档表也一并更新，别让文档和实现对不上。

## 截图自查可以直接用我建好的探针

`tmp/collab-probe.html` 还在，vite dev server 也在跑（127.0.0.1:1420），
数据已经覆盖了五个 tone、各档时间和长文本压力，不用自己再造：

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --force-device-scale-factor=2 \
  --window-size=500,1060 --screenshot=tmp/check-dark.png --virtual-time-budget=5000 \
  "http://127.0.0.1:1420/tmp/collab-probe.html?theme=dark"
```

`?theme=light` 换亮色，`?empty=1` 看空态，`?bg=on` 看背景图模式。

两个坑：**headless Chrome 会忽略 `--window-size` 的宽度，视口固定 500px**
（所以探针里面板是靠左放的，别改成靠右，会被裁掉右半边）；
`--force-device-scale-factor=2` 不能省，1x 看不清 10px 节点的描边。

## 完成前

- [ ] `npx tsc -b`（**必须 `-b`**，`--noEmit` 在这个仓库会静默空转、零输出且 exit 0）
- [ ] `npx vitest run src/collab/`
- [ ] 暗色、亮色各截一张，确认轨道线在两个主题下都读得出来
