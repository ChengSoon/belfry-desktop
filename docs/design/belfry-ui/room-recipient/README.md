# T32：房间消息人员选择器

[优化前 / 优化后截图](index.html)。按用户附件定位到房间消息输入框下方的「发给」控件。

## 实现

- 触发器：32px 最小高度、轻描边、r6、身份图标；选中姓名独立展示，长名称省略，`title` 保留全名。展开、键盘焦点、禁用状态分别明确。
- 弹层：336px 宽、r12、主题投影；「发送方式」与「房间成员」分组。默认收件人与明确指定统筹保留为两个不同选项；默认项有「默认」标签及正文 @ 点名提示。
- 成员：28px 头像、角色名、职责；统筹有身份标签。选中项有 2px 靛蓝侧标和勾选，键盘候选用强调软底。次要文字用 `--text-muted`，不在强调底上使用 faint。
- 长名在列表中换行；描述截断时可通过条目 `title` 查看全文。弹层根据窗口高度滚动，顶部留出 48px 避让窗口控件，距触发器 6px。
- 复用 Radix Select 的方向键、Home/End、Enter、Escape、焦点归还与选项语义；减少动态效果偏好下关闭该控件动效。

产品源码仅改 `src/rooms/view/RoomView.tsx`、`room.css`、中英文 `rooms.json`。样式限定在 `.room-recipient-*`；其他 Select 不受影响。没有更改路由协议、后端、草稿保存或投递逻辑。

## 验证

- `pnpm build`：通过。最终主入口 `index-Bpg8B2Kr.js`；房间 `RoomView-D0wzMhAC.js` / `RoomView-0xfIw9fP.css`。
- `pnpm test`：196 文件 / 1267 项通过。
- `pnpm check:i18n`：3529 项/语言、零遗留硬编码；曜石对比度脚本通过；`git diff --check` 通过。
- 新增 `room-recipient.case.mjs`：7 项生产浏览器验证通过。覆盖双主题、三个路由值的真实发送参数、选择 Enter 不发送、回复锁定、Escape 焦点归还、18 位成员滚动、720×480 / 20px 实际字号、长名、英语、无统筹、空房间禁用、减少动效。
- 原有 `rooms-reliability` / `rooms-i18n` / `rooms-retained`：11 项通过，覆盖跨房间草稿、附件、回复、失败发送、最小窗口操作。
- 新增生产用例验证终端 DOM 持续连接，无终端新建/关闭/分离；零浏览器错误或未处理 IPC。

截图共 15 张整窗、8 张同坐标局部裁切；局部裁切未缩放或重绘。`before/` 来自修改前生产构建，`after/` 来自最终生产构建。`manifest.json` 记录 PNG 与最终构建资产 SHA-256。桌面截图使用 macOS 平台标记；720px 截图使用 Windows 平台标记。均为合成数据和隔离 Chrome，原生窗口行为仍需真机确认。

```sh
pnpm build
BELFRY_RECIPIENT_ARTIFACTS=docs/design/belfry-ui/room-recipient/after \
  node --test --test-concurrency=1 src/components/lazy/testing/room-recipient.case.mjs
node --test --test-concurrency=1 \
  src/components/lazy/testing/rooms-reliability.case.mjs \
  src/components/lazy/testing/rooms-i18n.case.mjs \
  src/components/lazy/testing/rooms-retained.case.mjs
```
