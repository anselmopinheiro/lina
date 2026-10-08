export interface RuntimeTraceEvent { readonly timestamp: string; readonly category: string; readonly event: string; readonly status: "info" | "ok" | "blocked" | "error"; }
export interface RuntimeTraceService { list(): readonly RuntimeTraceEvent[]; clear(): void; exportText(header: Readonly<Record<string, string>>): string; }
const service: RuntimeTraceService = { list: () => [], clear: () => {}, exportText: () => "" };
export function getRuntimeTraceService(): RuntimeTraceService { return service; }
export function traceRuntime(_category: string, _event: string, _status?: "info" | "ok" | "blocked" | "error", _metadata?: Record<string, unknown>, _error?: unknown): void {}
