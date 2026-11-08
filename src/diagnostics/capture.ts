import { invoke } from "@tauri-apps/api/core";

export interface DiagnosticExport { path: string; sizeBytes: number; createdAt: number; summary: string }
interface ErrorEntry { level: "error"; source: string; message: string; stack?: string; context?: Record<string, string> }
const writes = new Set<Promise<boolean>>();

function bounded(value: string, bytes: number) {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= bytes) return value;
  return new TextDecoder("utf-8", { fatal: false }).decode(encoded.slice(0, bytes - 4)).replace(/\uFFFD$/, "") + "…";
}
function field(value: unknown, name: "message" | "stack") {
  try {
    const result = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;
    return typeof result === "string" ? result : undefined;
  } catch { return undefined; }
}

/** Extract error fields only. Never serialize a rejected object, configuration, or application state. */
export function diagnosticError(cause: unknown, source: string, componentStack?: string): ErrorEntry {
  const message = field(cause, "message") ?? (typeof cause === "string" ? cause : "Unexpected application error");
  const stack = [field(cause, "stack"), componentStack].filter(Boolean).join("\n");
  return { level: "error", source: bounded(source, 256), message: bounded(message, 8 * 1024),
    ...(stack ? { stack: bounded(stack, 32 * 1024) } : {}) };
}

/** Resolves false on logging failure; this path must never emit another log or rejection. */
export function captureException(cause: unknown, source: string, componentStack?: string, context?: Record<string, string>) {
  const entry = diagnosticError(cause, source, componentStack);
  if (context) entry.context = Object.fromEntries(Object.entries(context).slice(0, 8).map(([key, value]) => [key, bounded(value, 1024)]));
  const write = Promise.resolve().then(() => invoke<void>("app_log_write", { entry })).then(() => true, () => false);
  writes.add(write);
  void write.then(() => writes.delete(write));
  return write;
}

export async function exportDiagnostics() {
  await Promise.all([...writes]);
  return invoke<DiagnosticExport>("diagnostics_export");
}

/** Install before the first React render, covering window.onerror and unhandled promise rejections. */
export function installGlobalErrorCapture(target: Window = window) {
  const error = (event: ErrorEvent) => {
    void captureException(event.error ?? event.message, "window.error", undefined, {
      file: (event.filename ?? "").split(/[?#]/)[0], line: String(event.lineno ?? 0), column: String(event.colno ?? 0),
    });
  };
  const rejection = (event: PromiseRejectionEvent) => { void captureException(event.reason, "window.unhandledrejection"); };
  target.addEventListener("error", error);
  target.addEventListener("unhandledrejection", rejection);
  return () => { target.removeEventListener("error", error); target.removeEventListener("unhandledrejection", rejection); };
}
