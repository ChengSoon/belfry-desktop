# 协作收件箱 · 只读原型

全部数据为示例；尚未接入真实收件箱。默认页面用于会话筛选与消息阅读，合并与发送由未来的 Agent/后台协议承担。

- 默认界面是会话列表 → 消息详情，可切换主题、筛选和返回；不提供合并、投递等调度操作。
- “打开会话”在本原型中仅显示定位提示，尚未连接实际终端。
- 地址加 `#demo` 会在右下角出现“演示控制”，用来模拟后台事件（新消息到达、结束轮次、交差、回复、离线、提交不确定、暂停）。它不属于产品界面。
- 刷新页面等同应用重启：正在投递的消息转为“提交结果待核对”。

## 查看

可在仓库内直接打开 `index.html`。若使用 HTTP 预览，从仓库根目录启动服务，以便加载已有的 `public/fonts` 字体：

```sh
python3 -m http.server 18782 --bind 127.0.0.1
```

访问 <http://127.0.0.1:18782/docs/design/collaboration-inbox/prototype/>。不要只把本目录作为 HTTP 根目录，否则字体的相对路径无法解析到项目资源。

## 验证工具

在仓库根目录运行 `node docs/design/collaboration-inbox/prototype/tools/verify.mjs [输出目录]`，使用本机无头 Chrome 做 17 项界面与示例状态检查并截图。Node 20 需要启用 `--experimental-websocket`：

```sh
node --experimental-websocket docs/design/collaboration-inbox/prototype/tools/verify.mjs /tmp/belfry-inbox-ui-check
```

默认截图输出到同级的 `../screenshots/`。Chrome 路径可用 `CHROME_PATH` 指定。演示模拟只用于观察界面状态，不是持久化、批次协议或真实投递的生产验收。

`node tools/build-icons.mjs <lucide-react/dist/esm/icons>` 用于重新生成 `icons.js`。完整设计见 [设计说明](../README.md)和[界面说明](../prototype.md)。
