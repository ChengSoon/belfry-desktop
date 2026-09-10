import { createHash } from "node:crypto";

export function qualified(pluginId, name) {
  const hash = createHash("sha256").update(`${pluginId}:${name}`).digest("hex").slice(0, 10);
  return `pi_${`${pluginId}_${name}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 49)}_${hash}`;
}
export function peerUriPrefix(peer) {
  return `pi-plugin-mcp://${encodeURIComponent(peer.entry.manifest.id)}/${encodeURIComponent(peer.descriptor.id)}/`;
}
