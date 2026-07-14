export type EmbeddingErrorCategory =
  | "configuration"
  | "connection"
  | "timeout"
  | "authentication"
  | "authorization"
  | "rate-limit"
  | "model-not-found"
  | "invalid-response"
  | "invalid-vector"
  | "dimension-mismatch"
  | "input-rejected"
  | "unsupported-provider"
  | "unknown";

export type EmbeddingErrorScope = "operation" | "input";

export interface EmbeddingGenerationStatus {
  success: boolean;
  message: string;
  dimension?: number;
  embedding?: number[];
  provider?: string;
  endpoint?: string;
  status?: number;
  apiMessage?: string;
  errorCategory?: EmbeddingErrorCategory;
  errorScope?: EmbeddingErrorScope;
  fatal?: boolean;
  requestCount?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export function isValidEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));
}

export function classifyEmbeddingHttpStatus(status: number): {
  category: EmbeddingErrorCategory;
  scope: EmbeddingErrorScope;
  fatal: boolean;
} {
  if (status === 401) {
    return { category: "authentication", scope: "operation", fatal: true };
  }

  if (status === 403) {
    return { category: "authorization", scope: "operation", fatal: true };
  }

  if (status === 404) {
    return { category: "model-not-found", scope: "operation", fatal: true };
  }

  if (status === 408) {
    return { category: "timeout", scope: "operation", fatal: true };
  }

  if (status === 413) {
    return { category: "input-rejected", scope: "input", fatal: false };
  }

  if (status === 429) {
    return { category: "rate-limit", scope: "operation", fatal: true };
  }

  if (status >= 500) {
    return { category: "connection", scope: "operation", fatal: true };
  }

  return { category: "unknown", scope: "operation", fatal: true };
}

export function operationError(
  category: EmbeddingErrorCategory,
  message: string,
  details?: Partial<EmbeddingGenerationStatus>
): EmbeddingGenerationStatus {
  return {
    success: false,
    message,
    errorCategory: category,
    errorScope: "operation",
    fatal: true,
    ...details,
  };
}
