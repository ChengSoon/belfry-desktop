const MESSAGE_BYTES = 160 * 1024, MESSAGE_COUNT = 100;
function textContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter((item) => ["text", "input_text", "output_text"].includes(item?.type)).map((item) => item.text ?? "").join("\n");
}
function truncate(value) {
  const bytes = Buffer.from(value); if (bytes.length <= MESSAGE_BYTES) return value;
  let end = MESSAGE_BYTES;
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}
export class Transcript {
  constructor(stripName) { this.stripName = stripName; this.messages = []; this.calls = new Map(); this.bytes = 0; this.truncated = false; }
  add(role, content, toolName) {
    if (typeof content !== "string" || !content) return;
    const text = truncate(content); if (text !== content) this.truncated = true;
    this.messages.push({ role, content: text, ...(toolName ? { toolName } : {}) });
    this.bytes += Buffer.byteLength(text);
    while (this.bytes > MESSAGE_BYTES || this.messages.length > MESSAGE_COUNT) {
      this.bytes -= Buffer.byteLength(this.messages.shift().content); this.truncated = true;
    }
  }
  call(name, id, input) {
    if (typeof name !== "string" || typeof id !== "string") return;
    const stripped = name === this.stripName || name.endsWith(`__${this.stripName}`);
    this.calls.set(id, { name, stripped });
    if (this.calls.size > MESSAGE_COUNT * 4) this.calls.delete(this.calls.keys().next().value);
    if (!stripped) this.add("assistant", typeof input === "string" ? input : JSON.stringify(input ?? {}), name);
  }
  output(id, content) {
    const call = this.calls.get(id);
    if (!call) { this.truncated = true; return; }
    if (!call.stripped) this.add("tool", textContent(content), call.name);
  }
  codex(record) {
    const value = record.payload ?? {};
    if (record.type === "turn_context") {
      this.modelId = value.model; this.thinkingLevel = value.effort ?? value.reasoning_effort; return;
    }
    if (record.type === "compacted" && typeof value.message === "string") {
      this.messages = []; this.bytes = 0; this.calls.clear(); this.truncated = true;
      this.add("system", value.message); return;
    }
    if (record.type !== "response_item") return;
    this.codexItem(value);
  }
  codexItem(value) {
    switch (value.type) {
      case "message": if (["user", "assistant", "system", "developer"].includes(value.role)) this.add(value.role === "developer" ? "system" : value.role, textContent(value.content)); break;
      case "function_call": case "custom_tool_call": this.call(value.name, value.call_id, value.arguments ?? value.input); break;
      case "function_call_output": case "custom_tool_call_output": this.output(value.call_id, value.output); break;
    }
  }
  claude(record, id) {
    if (record.sessionId !== id || record.isSidechain || !["user", "assistant"].includes(record.type)) return;
    const message = record.message ?? {}, parts = message.content;
    if (message.model) this.modelId = message.model;
    if (typeof parts === "string") { this.add(record.type, parts); return; }
    for (const part of Array.isArray(parts) ? parts : []) this.claudePart(part, record.type);
  }
  claudePart(part, role) {
    if (part.type === "text") this.add(role, part.text);
    if (part.type === "tool_use") this.call(part.name, part.id, part.input);
    if (part.type === "tool_result") this.output(part.tool_use_id, part.content);
  }
}
