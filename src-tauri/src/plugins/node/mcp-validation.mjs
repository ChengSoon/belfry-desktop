import { apiError } from "./errors.mjs";

export function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function string(value, limit = 16_384) { return typeof value === "string" && value.length <= limit; }
export function uri(value) { return string(value, 8192) && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value); }
export function binary(value) { return string(value, 1024 * 1024) && value.length % 4 === 0 && /^[a-zA-Z0-9+/]*={0,2}$/.test(value); }
export function requireResult(valid) { if (!valid) throw apiError("MCP_ERROR", "插件 MCP 返回内容格式无效"); }
function descriptor(item, group) {
  requireResult(object(item));
  requireResult(string(item.name, 256) && !!item.name);
  requireResult(optionalString(item.description));
  if (group === "tools") requireResult(item.name.length <= 128 && object(item.inputSchema) && item.inputSchema.type === "object");
  if (group === "resources" || group === "resourceTemplates") {
    requireResult(uri(item[group === "resources" ? "uri" : "uriTemplate"]));
    requireResult(optionalString(item.mimeType, 256));
  }
  if (group === "prompts" && item.arguments !== undefined) promptArguments(item.arguments);
}
function optionalString(value, limit) { return value === undefined || string(value, limit); }
function promptArguments(args) {
  requireResult(Array.isArray(args) && args.length <= 128);
  const names = new Set();
  for (const arg of args) {
    requireResult(object(arg));
    requireResult(string(arg.name, 128) && !!arg.name && !names.has(arg.name));
    requireResult(optionalString(arg.description));
    requireResult(arg.required === undefined || typeof arg.required === "boolean");
    names.add(arg.name);
  }
}
export function validateCatalog(catalog) {
  requireResult(Buffer.byteLength(JSON.stringify(catalog)) <= 512 * 1024);
  for (const [group, items] of Object.entries(catalog)) {
    const names = new Set();
    for (const item of items) {
      descriptor(item, group);
      const key = group === "resources" ? item.uri : group === "resourceTemplates" ? item.uriTemplate : item.name;
      requireResult(!names.has(key)); names.add(key);
    }
  }
  return catalog;
}
export function resourceContent(value, prefix = "") {
  requireResult(object(value) && uri(value.uri) && (value.mimeType === undefined || string(value.mimeType, 256))
    && ((typeof value.text === "string" && value.blob === undefined) || (binary(value.blob) && value.text === undefined)));
  return { ...value, uri: prefix + value.uri };
}
export function contentBlock(value, prefix = "") {
  requireResult(object(value));
  switch (value.type) {
    case "text": requireResult(typeof value.text === "string"); break;
    case "image": case "audio": requireResult(string(value.mimeType, 256) && binary(value.data)); break;
    case "resource": return { ...value, resource: resourceContent(value.resource, prefix) };
    case "resource_link": requireResult(uri(value.uri) && string(value.name, 256)); return { ...value, uri: prefix + value.uri };
    default: requireResult(false);
  }
  return value;
}
export function mcpToolResult(value, prefix = "") {
  requireResult(object(value) && Array.isArray(value.content) && value.content.length <= 500
    && (value.isError === undefined || typeof value.isError === "boolean") && (value.structuredContent === undefined || object(value.structuredContent)));
  return { ...value, content: value.content.map((block) => contentBlock(block, prefix)) };
}
export function promptResult(value, prefix) {
  requireResult(object(value) && Array.isArray(value.messages) && value.messages.length <= 500);
  return { ...value, messages: value.messages.map((message) => {
    requireResult(object(message) && ["user", "assistant"].includes(message.role));
    return { ...message, content: contentBlock(message.content, prefix) };
  }) };
}
