/**
 * Logs structurés JSON (stdout) + heartbeats workers + contexte requête (AsyncLocalStorage).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type RequestContext = {
  requestId?: string;
  userId?: number;
  threadId?: number;
  jobId?: number;
};

export type WorkerHeartbeat = {
  lastTickAt: string | null;
  lastError: string | null;
  processedCount: number;
};

const requestContext = new AsyncLocalStorage<RequestContext>();
const workerHeartbeats = new Map<string, WorkerHeartbeat>();

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function recordWorkerTick(
  name: string,
  opts?: { error?: string | null; processed?: number },
): void {
  const prev = workerHeartbeats.get(name) ?? {
    lastTickAt: null,
    lastError: null,
    processedCount: 0,
  };
  workerHeartbeats.set(name, {
    lastTickAt: new Date().toISOString(),
    lastError: opts?.error ?? null,
    processedCount: prev.processedCount + (opts?.processed ?? 0),
  });
}

export function getWorkerHeartbeats(): Record<string, WorkerHeartbeat> {
  const out: Record<string, WorkerHeartbeat> = {};
  for (const [k, v] of workerHeartbeats) out[k] = { ...v };
  return out;
}

export function logEvent(opts: {
  level?: LogLevel;
  component: string;
  event: string;
  requestId?: string;
  userId?: number;
  threadId?: number;
  jobId?: number;
  durationMs?: number;
  path?: string;
  slot?: string;
  error?: string | null;
  meta?: Record<string, unknown>;
}): void {
  const ctx = requestContext.getStore();
  const payload = {
    ts: new Date().toISOString(),
    level: opts.level ?? "info",
    service: "klanvio-api",
    component: opts.component,
    event: opts.event,
    requestId: opts.requestId ?? ctx?.requestId,
    userId: opts.userId ?? ctx?.userId,
    threadId: opts.threadId ?? ctx?.threadId,
    jobId: opts.jobId ?? ctx?.jobId,
    ...(opts.durationMs != null ? { durationMs: opts.durationMs } : {}),
    ...(opts.path ? { path: opts.path } : {}),
    ...(opts.slot ? { slot: opts.slot } : {}),
    ...(opts.error ? { error: opts.error } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  };
  const line = JSON.stringify(payload);
  if (payload.level === "error") console.error(line);
  else if (payload.level === "warn") console.warn(line);
  else console.log(line);
}
