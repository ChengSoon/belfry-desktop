// 仅供 D1 私有测试使用的已校验目录投影，不是 manifest 或 IPC 协议。
export function directoryFixture() {
  return {
    pluginId: "example.review-kit",
    pluginName: "代码审查助手",
    version: "1.0.0",
    available: true,
    templates: [{
      id: "review", name: "审查改动", description: "检查证据",
      steps: [{ id: "inspect", text: "审查 {{scope}}\r\n保留原文" }],
    }],
    actions: [{
      id: "open-review", title: "审查改动", templateId: "review", keywords: ["review"],
    }],
  };
}
