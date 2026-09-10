import type { HarnessManifest } from "./protocol";
const ID = /^[a-z][a-z0-9-]{0,59}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
export function validateHarnessManifest(value: unknown): HarnessManifest {
  if (!value || typeof value !== "object") throw new Error("manifest must be object");
  const manifest = value as HarnessManifest;
  if (manifest.schemaVersion !== 1 || !manifest.id.includes(".") || manifest.id.split(".").some((part) => !ID.test(part))) throw new Error("invalid identity");
  if (!VERSION.test(manifest.version) || !VERSION.test(manifest.compatibility?.minAppVersion)) throw new Error("invalid version");
  if (!manifest.entry || typeof manifest.entry.command !== "string" || manifest.entry.command.includes(" ")) throw new Error("entry must be executable plus argv");
  if (!Array.isArray(manifest.modelSlots) || !Array.isArray(manifest.agents) || !Array.isArray(manifest.capabilities)) throw new Error("manifest sections missing");
  if (!manifest.context || manifest.context.maxTokens <= 0 || !manifest.workflow || manifest.workflow.maxSteps <= 0) throw new Error("limits missing");
  return manifest;
}
