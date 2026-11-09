// Isolated CDP pipe consumer. It never starts/attaches to a user's browser.
import { createReadStream, createWriteStream } from "node:fs";

const mode = process.argv[2], input = createReadStream(null, { fd: 3 }), output = createWriteStream(null, { fd: 4 });
const secret = "T41_CONTENT_MUST_NOT_APPEAR";
let buffer = Buffer.alloc(0);
setInterval(() => {}, 1000); // Remain alive after EOF until BrowserProcess reclaims us.
if (mode === "hold") process.on("SIGTERM", () => {});
process.on("message", () => {});
function reply(message) {
  const bytes = JSON.stringify(message) + "\0";
  if (mode === "fragmented") { output.write(bytes.slice(0, 7)); setImmediate(() => output.write(bytes.slice(7))); }
  else output.write(bytes);
}
input.on("data", (bytes) => {
  buffer = Buffer.concat([buffer, bytes]); let end;
  while ((end = buffer.indexOf(0)) !== -1) {
    const message = JSON.parse(buffer.subarray(0, end)); buffer = buffer.subarray(end + 1);
    process.send?.({ method: message.method });
    if (mode === "hold" && ["Runtime.enable", "Page.enable"].includes(message.method)) continue;
    if (message.method === "Runtime.enable") {
      process.stderr.write(`[10:20:1110/020000.123456:ERROR:content/browser/renderer_host.cc:42] ${secret}\n`);
      if (mode === "disconnect") { output.end(); continue; }
      if (mode === "exit") process.exit(23);
      if (mode === "silent") {
        reply({ method: "Inspector.detached", sessionId: "session-private", params: { reason: secret } });
        continue;
      }
      if (mode === "privacy") {
        process.stderr.write((`[10:20:1110/020000.123456:ERROR:gpu/other.cc:8] https://${secret}/?token=${secret}\n`).repeat(800));
        for (let index = 0; index < 250; index++) reply({ method: "Runtime.executionContextCreated", sessionId: "session-private",
          params: { context: { name: secret, origin: secret } } });
      }
      if (["protocol-error", "privacy"].includes(mode)) {
        reply({ id: message.id, error: { code: -32000, message: "controlled Runtime.enable failure" } }); continue;
      }
    }
    if (output.writableEnded) continue;
    const result = message.method === "Browser.getVersion" ? { product: "Controlled/1" }
      : message.method === "Target.createBrowserContext" ? { browserContextId: "context-private" }
      : message.method === "Target.createTarget" ? { targetId: "target-private" }
      : message.method === "Target.attachToTarget" ? { sessionId: "session-private" }
      : { ignoredContent: secret };
    reply({ id: message.id, result });
  }
});
