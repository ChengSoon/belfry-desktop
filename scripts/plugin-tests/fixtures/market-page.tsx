import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { PluginPanel } from "../../../src/plugins/PluginPanel";
import "../../../src/styles.css";

// 仅替换 Tauri 传输边界；市场读写和目录校验由测试中的真实 Node 模块处理。
mockIPC(async (command, args) => {
  const response = await fetch("/__market-rpc", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.value;
}, { shouldMockEvents: true });

createRoot(document.getElementById("root")!).render(<PluginPanel />);
