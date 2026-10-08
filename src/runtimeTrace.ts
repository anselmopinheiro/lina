export type RuntimeTraceStatus = "info" | "ok" | "blocked" | "error";
export interface RuntimeTraceEvent {
  readonly timestamp: string;
  readonly category: string;
  readonly event: string;
  readonly status: RuntimeTraceStatus;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly error?: Readonly<{ name: string; message: string; phase?: string }>;
}

const MAX_EVENTS = 300;
const forbiddenMetadataKey = /(api.?key|authorization|token|secret|password|query|content|embedding)/i;

function sanitizeMessage(value: unknown): string {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : "unknown-error";
  return message.replace(/(?:bearer|token|api[_-]?key|authorization)\s*[:=]?\s*[^\s,;]+/gi, "$1 <redacted>").slice(0, 240);
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (forbiddenMetadataKey.test(key) || !(typeof value === "string" || typeof value === "number" || typeof value === "boolean")) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 160) : value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export class RuntimeTraceService {
  private readonly events: RuntimeTraceEvent[] = [];

  append(category: string, event: string, status: RuntimeTraceStatus = "info", metadata?: Record<string, unknown>, error?: unknown): void {
    const safeError = error instanceof Error
      ? { name: error.name || "Error", message: sanitizeMessage(error.message), phase: event }
      : error === undefined ? undefined : { name: "Error", message: sanitizeMessage(error), phase: event };
    this.events.push({ timestamp: new Date().toISOString(), category, event, status, ...(sanitizeMetadata(metadata) ? { metadata: sanitizeMetadata(metadata) } : {}), ...(safeError ? { error: safeError } : {}) });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  list(): readonly RuntimeTraceEvent[] { return this.events.map((entry) => ({ ...entry, ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}) })); }
  clear(): void { this.events.splice(0); }

  exportText(header: Readonly<Record<string, string>>): string {
    const lines = ["Lina Runtime Trace", ...Object.entries(header).map(([key, value]) => `${key}=${value}`), `exportedAt=${new Date().toISOString()}`, ""];
    for (const entry of this.events) {
      const metadata = entry.metadata ? ` ${Object.entries(entry.metadata).map(([key, value]) => `${key}=${value}`).join(" ")}` : "";
      const error = entry.error ? ` error=${entry.error.name}:${entry.error.message}` : "";
      lines.push(`${entry.timestamp} | ${entry.category} | ${entry.event} | ${entry.status}${metadata}${error}`);
    }
    return lines.join("\n");
  }
}

const service = new RuntimeTraceService();
export function getRuntimeTraceService(): RuntimeTraceService { return service; }
export function traceRuntime(category: string, event: string, status: RuntimeTraceStatus = "info", metadata?: Record<string, unknown>, error?: unknown): void {
  service.append(category, event, status, metadata, error);
}
