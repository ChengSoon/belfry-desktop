import { invoke } from "@tauri-apps/api/core";
import type { PatchPreview, PatchToolRequest, RpcResponse } from "./protocol";
import type { WorkerTransport } from "./supervisor";

interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
const defaultBridge: Bridge = { invoke: (command, args) => invoke(command, args) };
const SAFE_ERRORS = new Set(["APPROVAL_DENIED", "PREVIEW_EXPIRED", "WRITE_CONFLICT", "SESSION_CANCELLED", "CAPABILITY_DENIED", "PATH_OUTSIDE_ROOT", "NOT_FOUND", "TOO_LARGE", "INVALID_PARAMS"]);

export class PatchClient {
  private readonly completed = new Set<string>();
  constructor(private readonly bridge: Bridge = defaultBridge, private readonly confirm: (preview: PatchPreview, request: PatchToolRequest) => Promise<boolean>) {}

  async route(workerId: string, value: unknown, transport: WorkerTransport) {
    if (!isPatchRequest(value)) return false;
    const key = `${value.sessionId}\0${value.id}\0${value.params.toolId}`;
    if (this.completed.has(key)) return true;
    let response: RpcResponse;
    try {
      const result = value.params.tool === "project.patch.propose" ? await this.propose(workerId, value) : await this.apply(workerId, value);
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, result };
    } catch (failure) {
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, error: normalizeError(failure) };
    }
    this.completed.add(key);
    transport.send(response);
    return true;
  }

  private async propose(workerId: string, request: PatchToolRequest) {
    if (request.params.tool !== "project.patch.propose") throw new Error("invalid patch request");
    const preview = parsePreview(await this.bridge.invoke("harness_patch_propose", { request: { sessionId: request.sessionId, workerId, requestId: request.id, toolId: request.params.toolId, relativePath: request.params.relativePath, expectedDigest: request.params.expectedDigest, replacement: request.params.replacement } }));
    if (!await this.confirm(preview, request)) {
      await this.bridge.invoke("harness_patch_reject", { previewId: preview.previewId });
      throw { code: "APPROVAL_DENIED", message: "patch approval denied" };
    }
    const token = await this.bridge.invoke("harness_patch_approve", { previewId: preview.previewId });
    if (typeof token !== "string" || !token) throw new Error("invalid approval token");
    return { ...preview, approvalToken: token };
  }

  private apply(workerId: string, request: PatchToolRequest) {
    if (request.params.tool !== "project.patch.apply") throw new Error("invalid patch request");
    return this.bridge.invoke("harness_patch_apply", { request: { sessionId: request.sessionId, workerId, requestId: request.id, toolId: request.params.toolId, previewId: request.params.previewId, approvalToken: request.params.approvalToken } });
  }
}

function parsePreview(value: unknown): PatchPreview {
  if (!isRecord(value) || !["previewId", "relativePath", "originalDigest", "replacementDigest"].every((key) => typeof value[key] === "string")) throw new Error("invalid patch preview");
  if (!["generation", "oldLines", "newLines", "finalBytes", "expiresAt"].every((key) => Number.isSafeInteger(value[key]))) throw new Error("invalid patch preview");
  if (!isDiff(value.diff)) throw new Error("invalid patch preview");
  return value as unknown as PatchPreview;
}
function isDiff(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.hunks) || typeof value.truncated !== "boolean" ||
      !["omittedHunks", "omittedLines", "previewBytes"].every((key) => Number.isSafeInteger(value[key]))) return false;
  return value.hunks.every((hunk) => isRecord(hunk) && Number.isSafeInteger(hunk.oldStart) && Number.isSafeInteger(hunk.newStart) &&
    Array.isArray(hunk.lines) && hunk.lines.every((line) => isRecord(line) && ["context", "add", "delete"].includes(String(line.kind)) &&
      typeof line.content === "string" && (line.oldLine === null || line.oldLine === undefined || Number.isSafeInteger(line.oldLine)) &&
      (line.newLine === null || line.newLine === undefined || Number.isSafeInteger(line.newLine))));
}
function normalizeError(value: unknown) {
  const code = isRecord(value) && typeof value.code === "string" && SAFE_ERRORS.has(value.code) ? value.code : "PATCH_FAILED";
  const messages: Record<string, string> = { APPROVAL_DENIED: "patch approval denied", PREVIEW_EXPIRED: "patch preview expired", WRITE_CONFLICT: "patch target changed", SESSION_CANCELLED: "session cancelled", CAPABILITY_DENIED: "patch capability denied", PATH_OUTSIDE_ROOT: "patch path is outside project", NOT_FOUND: "patch target not found", TOO_LARGE: "patch exceeds limit", INVALID_PARAMS: "invalid patch request", PATCH_FAILED: "patch request failed" };
  return { code, message: messages[code] };
}
function isPatchRequest(value: unknown): value is PatchToolRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.method !== "tool/request" || typeof value.id !== "string" || typeof value.sessionId !== "string" || !isRecord(value.params) || typeof value.params.toolId !== "string") return false;
  const params = value.params;
  if (params.tool === "project.patch.propose") return ["relativePath", "expectedDigest", "replacement"].every((key) => typeof params[key] === "string");
  return params.tool === "project.patch.apply" && typeof params.previewId === "string" && typeof params.approvalToken === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
