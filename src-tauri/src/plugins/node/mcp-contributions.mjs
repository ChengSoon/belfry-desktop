import { McpPeer } from "./mcp-peer.mjs";
import { apiError, permission } from "./errors.mjs";
import { getSettings } from "./settings.mjs";
import { McpResources } from "./mcp-resources.mjs";
import { peerUriPrefix } from "./mcp-names.mjs";
import { mcpToolResult } from "./mcp-validation.mjs";
import { activeContext } from "./execution.mjs";

export class McpContributions {
  constructor(broker) { this.broker = broker; this.peers = new Map(); this.resources = new McpResources(this); }
  async load(entry) {
    const descriptors = entry.manifest.contributes?.mcpServers ?? [];
    if (descriptors.length > 10) throw apiError("LIMIT_EXCEEDED", "单插件最多声明 10 个 MCP 服务");
    const settings = await getSettings(this.broker.base, entry.manifest);
    for (const descriptor of descriptors) {
      permission(entry, descriptor.transport === "stdio" ? "mcp.server.local" : "mcp.server.remote");
      const key = `${entry.manifest.id}:${descriptor.id}`;
      const peer = new McpPeer({ entry, descriptor, settings,
        log: (message) => this.broker.event("log", { pluginId: entry.manifest.id, message }),
        exited: () => this.withdraw(entry.manifest.id, key, peer),
        changed: () => this.refresh(entry, key, peer),
      });
      this.peers.set(key, peer);
      await peer.start();
      if (this.peers.get(key) === peer && peer.active) this.registerTools(entry, key, peer);
      if (peer.refreshPending) await this.refresh(entry, key, peer);
    }
  }
  registerTools(entry, key, peer) {
    for (const [toolKey, tool] of this.broker.tools) if (tool.peerKey === key) this.broker.tools.delete(toolKey);
    for (const tool of peer.catalog.tools) {
      const name = `mcp.${peer.descriptor.id}.${tool.name}`;
      this.broker.tools.set(`${entry.manifest.id}:${name}`, { name, description: tool.description ?? tool.name, schema: tool.inputSchema ?? { type: "object" },
        pluginId: entry.manifest.id, pluginName: entry.manifest.name, peerKey: key, peerTool: tool.name });
    }
  }
  async refresh(entry, key, peer) {
    if (!this.refreshable(entry, key, peer)) return;
    peer.refreshPending = true;
    if (peer.refreshing || !peer.active) return;
    peer.refreshing = true;
    try {
      do {
        peer.refreshPending = false; await peer.refreshCatalog();
        if (!this.refreshable(entry, key, peer)) return;
        this.registerTools(entry, key, peer); this.broker.event("catalogChanged", { pluginId: entry.manifest.id });
      } while (peer.refreshPending);
    } catch (error) { this.broker.event("log", { pluginId: entry.manifest.id, message: error.message }); }
    finally { peer.refreshing = false; }
  }
  refreshable(entry, key, peer) { return this.peers.get(key) === peer && !peer.stopping && !entry.stopping; }
  withdraw(id, peerKey, peer) {
    if (this.peers.get(peerKey) !== peer) return;
    peer.active = false;
    for (const [key, tool] of this.broker.tools) if (tool.peerKey === peerKey) this.broker.tools.delete(key);
    this.broker.event("catalogChanged", { pluginId: id });
  }
  async invoke(tool, args, context) {
    activeContext(context);
    const peer = this.peers.get(tool.peerKey);
    if (!peer || !this.resources.peers(context).includes(peer)) throw apiError("NOT_FOUND", "插件 MCP 服务已撤销");
    const result = await peer.call("tools/call", { name: tool.peerTool, arguments: args }, { signal: context.abort?.signal });
    activeContext(context);
    if (this.peers.get(tool.peerKey) !== peer || !this.resources.peers(context).includes(peer)) throw apiError("NOT_FOUND", "插件 MCP 服务已撤销");
    return mcpToolResult(result, peerUriPrefix(peer));
  }
  async close(id) {
    for (const [key, peer] of this.peers) {
      if (peer.entry.manifest.id !== id) continue;
      this.withdraw(id, key, peer); this.peers.delete(key); await peer.stop();
    }
  }
}
