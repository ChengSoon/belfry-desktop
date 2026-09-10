import { apiError } from "./errors.mjs";
import { inScope } from "./management.mjs";
import { qualified, peerUriPrefix } from "./mcp-names.mjs";
import { object, promptResult, requireResult, resourceContent } from "./mcp-validation.mjs";
import { activeContext } from "./execution.mjs";

export class McpResources {
  constructor(contributions) { this.contributions = contributions; }
  peers(context) {
    activeContext(context);
    return [...this.contributions.peers.values()].filter((peer) => peer.active && !peer.stopping
      && peer.entry.status === "ready" && inScope(peer.entry.scope, context.workspace));
  }
  promptName(peer, name) { return qualified(peer.entry.manifest.id, `prompt:${peer.descriptor.id}:${name}`); }
  list(group, context) {
    return this.peers(context).flatMap((peer) => (peer.catalog[group] ?? []).map((item) => {
      if (group === "prompts") return { ...item, name: this.promptName(peer, item.name) };
      const field = group === "resources" ? "uri" : "uriTemplate";
      return { ...item, [field]: peerUriPrefix(peer) + item[field] };
    }));
  }
  async prompt(params, context) {
    for (const peer of this.peers(context)) {
      const prompt = peer.catalog.prompts.find((item) => this.promptName(peer, item.name) === params.name);
      if (!prompt) continue;
      const result = await peer.call("prompts/get", { ...params, name: prompt.name }, { signal: context.abort?.signal });
      if (!this.peers(context).includes(peer)) throw apiError("SESSION_EXPIRED", "插件贡献已撤销");
      return promptResult(result, peerUriPrefix(peer));
    }
    throw apiError("NOT_FOUND", "插件 MCP 提示不存在或已撤销");
  }
  async read(params, context) {
    const peer = this.peers(context).find((value) => typeof params.uri === "string" && params.uri.startsWith(peerUriPrefix(value)));
    if (!peer || !peer.initialized?.capabilities?.resources) throw apiError("NOT_FOUND", "插件 MCP 资源不存在或已撤销");
    const prefix = peerUriPrefix(peer), uri = params.uri.slice(prefix.length);
    const result = await peer.call("resources/read", { ...params, uri }, { signal: context.abort?.signal });
    if (!this.peers(context).includes(peer)) throw apiError("SESSION_EXPIRED", "插件贡献已撤销");
    requireResult(object(result) && Array.isArray(result.contents) && result.contents.length <= 500);
    return { ...result, contents: result.contents.map((content) => resourceContent(content, prefix)) };
  }
}
