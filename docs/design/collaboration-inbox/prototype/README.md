# 协作收件箱 · 只读原型

全部数据为示例；不调用 Belfry API、不投递任何消息。需在仓库内打开 `index.html`（字体引用 `public/fonts`）。

- 默认页面就是产品界面：会话列表 → 消息详情，没有任何操作按钮。
- 地址加 `#demo` 会在右下角出现“演示控制”，用来模拟后台事件（新消息到达、结束轮次、交差、回复、离线、提交不确定、暂停）。它不属于产品界面。
- 刷新页面等同应用重启：正在投递的消息转为“提交结果待核对”。

工具：

- `node tools/verify.mjs [输出目录]`：启动本机无头 Chrome，真实点击跑 14 项验证并截图（默认写到 `../screenshots/`）。
- `node tools/build-icons.mjs <lucide-react/dist/esm/icons>`：重新生成 `icons.js`。
