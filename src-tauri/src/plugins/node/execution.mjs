import { apiError } from "./errors.mjs";

export function activeContext(context) {
  if (context.expired) throw apiError("SESSION_EXPIRED", "Agent 会话已失效");
  const signal = context.abort?.signal;
  if (signal?.aborted) throw signal.reason?.code ? signal.reason : apiError("CANCELLED", "插件调用已取消");
}
export function invocationContext(source, entry) {
  activeContext(source);
  const signals = [entry.abort.signal];
  if (source.abort?.signal) signals.push(source.abort.signal);
  return Object.assign(Object.create(source), { abort: { signal: AbortSignal.any(signals) } });
}
