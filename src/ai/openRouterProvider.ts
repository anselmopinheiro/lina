import { requestUrl } from "obsidian";
import { buildOpenRouterChatCompletionsUrl, buildOpenRouterEmbeddingsUrl, OPENROUTER_DEFAULT_BASE_URL } from "./providerDefaults";
import { OllamaTextGenerationStatus } from "./ollamaProvider";
import {
  EmbeddingGenerationStatus,
  isValidEmbeddingVector,
  operationError,
} from "./embeddingTypes";

interface OpenRouterEmbeddingResponse {
  data?: Array<{
    index?: unknown;
    embedding?: unknown;
  }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeApiMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  const redacted = singleLine
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_ -]?key\s*[:=]\s*[A-Za-z0-9._~+/=-]+/gi, "api key [redacted]");
  return redacted.length > 220 ? `${redacted.slice(0, 217)}...` : redacted;
}

function extractSafeApiMessage(value: unknown): string | undefined {
  if (typeof value === "string") return sanitizeApiMessage(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractSafeApiMessage(item);
      if (message) return message;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const key of ["message", "detail", "error", "code"]) {
    const nested = value[key];
    if (typeof nested === "string") return sanitizeApiMessage(nested);
    const message = extractSafeApiMessage(nested);
    if (message) return message;
  }
  return undefined;
}

function describeHttpFailure(status: number): string {
  switch (status) {
    case 400: return "O pedido de embeddings para OpenRouter é inválido. Verifica o modelo e os inputs.";
    case 401: return "Chave API OpenRouter inválida ou em falta.";
    case 402: return "A conta OpenRouter não tem créditos suficientes para embeddings.";
    case 404: return "O modelo OpenRouter não existe ou não suporta embeddings.";
    case 429: return "O limite de pedidos OpenRouter foi atingido. Tenta novamente mais tarde.";
    case 529: return "O provider de embeddings OpenRouter está temporariamente sobrecarregado.";
    default: return `OpenRouter respondeu com status ${status}.`;
  }
}

function classifyHttpFailure(status: number): Pick<EmbeddingGenerationStatus, "errorCategory" | "errorScope" | "fatal"> {
  switch (status) {
    case 400: return { errorCategory: "configuration", errorScope: "operation", fatal: true };
    case 401: return { errorCategory: "authentication", errorScope: "operation", fatal: true };
    case 402: return { errorCategory: "billing", errorScope: "operation", fatal: true };
    case 404: return { errorCategory: "model-not-found", errorScope: "operation", fatal: true };
    case 429: return { errorCategory: "rate-limit", errorScope: "operation", fatal: true };
    case 529: return { errorCategory: "connection", errorScope: "operation", fatal: true };
    default: return { errorCategory: status >= 500 ? "connection" : "unknown", errorScope: "operation", fatal: true };
  }
}

function describeTextHttpFailure(status: number): string {
  switch (status) {
    case 401: return "Chave API OpenRouter inválida ou em falta.";
    case 402: return "A faturação do provider OpenRouter não está disponível.";
    case 429: return "O limite de pedidos OpenRouter foi atingido. Tenta novamente mais tarde.";
    default: return status >= 500
      ? "O provider OpenRouter está temporariamente indisponível. Tenta novamente mais tarde."
      : `OpenRouter respondeu com status ${status}.`;
  }
}

function classifyTextHttpFailure(status: number): NonNullable<OllamaTextGenerationStatus["errorCategory"]> {
  switch (status) {
    case 401: return "authentication";
    case 402: return "billing";
    case 429: return "rate-limit";
    default: return status >= 500 ? "connection" : "configuration";
  }
}

/** OpenRouter's OpenAI-compatible chat completions endpoint. */
export async function generateOpenRouterText(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number = 60000,
): Promise<OllamaTextGenerationStatus> {
  const endpoint = buildOpenRouterChatCompletionsUrl(baseUrl || OPENROUTER_DEFAULT_BASE_URL);
  if (!apiKey.trim()) {
    return { success: false, errorCategory: "configuration", message: "Chave API OpenRouter em falta. Define uma chave local nas definições do Lina." };
  }
  if (!model.trim()) {
    return { success: false, errorCategory: "configuration", message: "Modelo de análise OpenRouter em falta. Define um modelo nas definições do Lina." };
  }

  let timeoutId: number | undefined;
  try {
    const timeout = new Promise<OllamaTextGenerationStatus>((resolve) => {
      timeoutId = window.setTimeout(() => resolve({
        success: false,
        errorCategory: "timeout",
        message: "Tempo limite excedido ao gerar resposta com OpenRouter.",
      }), timeoutMs);
    });
    const request = (async (): Promise<OllamaTextGenerationStatus> => {
      const response = await requestUrl({
        url: endpoint,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
      if (response.status !== 200) {
        return {
          success: false,
          errorCategory: classifyTextHttpFailure(response.status),
          message: describeTextHttpFailure(response.status),
        };
      }

      const data = response.json as OpenRouterChatResponse;
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim().length === 0) {
        return { success: false, errorCategory: "invalid-response", message: "OpenRouter devolveu uma resposta vazia ou num formato inesperado." };
      }
      return { success: true, message: "Resposta gerada com sucesso.", text };
    })();
    return await Promise.race([request, timeout]);
  } catch {
    return { success: false, errorCategory: "connection", message: "Não foi possível ligar ao OpenRouter para gerar resposta." };
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

/** OpenRouter's OpenAI-compatible batch embeddings endpoint. */
export async function generateOpenRouterEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
  timeoutMs: number = 60000,
): Promise<EmbeddingGenerationStatus> {
  const endpoint = buildOpenRouterEmbeddingsUrl(baseUrl || OPENROUTER_DEFAULT_BASE_URL);
  if (!apiKey.trim()) {
    return operationError("configuration", "Chave API OpenRouter em falta. Define uma chave local nas definições do Lina.", {
      provider: "openrouter", endpoint, requestCount: 0,
    });
  }
  if (!model.trim()) {
    return operationError("configuration", "Modelo de embeddings OpenRouter em falta.", {
      provider: "openrouter", endpoint, requestCount: 0,
    });
  }
  if (inputs.length === 0) {
    return operationError("configuration", "Não existem inputs para gerar embeddings com OpenRouter.", {
      provider: "openrouter", endpoint, requestCount: 0,
    });
  }

  let timeoutId: number | undefined;
  try {
    const timeout = new Promise<EmbeddingGenerationStatus>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(operationError("timeout", "Tempo limite excedido ao gerar embeddings com OpenRouter.", {
        provider: "openrouter", endpoint, requestCount: 1,
      })), timeoutMs);
    });
    const request = (async (): Promise<EmbeddingGenerationStatus> => {
      const response = await requestUrl({
        url: endpoint,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: inputs }),
      });
      if (response.status !== 200) {
        return {
          success: false,
          message: describeHttpFailure(response.status),
          provider: "openrouter",
          endpoint,
          status: response.status,
          apiMessage: extractSafeApiMessage(response.json),
          requestCount: 1,
          ...classifyHttpFailure(response.status),
        };
      }

      const data = response.json as OpenRouterEmbeddingResponse;
      if (!Array.isArray(data.data) || data.data.length !== inputs.length) {
        return operationError("invalid-response", "OpenRouter devolveu um número de embeddings diferente do número de inputs.", {
          provider: "openrouter", endpoint, status: response.status, apiMessage: extractSafeApiMessage(data), requestCount: 1,
        });
      }

      const embeddings = new Array<number[]>(inputs.length);
      const seen = new Set<number>();
      for (const item of data.data) {
        const itemIndex = typeof item.index === "number" && Number.isInteger(item.index) ? item.index : null;
        if (itemIndex === null || itemIndex < 0 || itemIndex >= inputs.length || seen.has(itemIndex)) {
          return operationError("invalid-response", "OpenRouter devolveu índices de embeddings ambíguos ou inválidos.", {
            provider: "openrouter", endpoint, status: response.status, requestCount: 1,
          });
        }
        if (!isValidEmbeddingVector(item.embedding)) {
          return operationError("invalid-vector", "OpenRouter devolveu um embedding com valores inválidos.", {
            provider: "openrouter", endpoint, status: response.status, apiMessage: extractSafeApiMessage(data), requestCount: 1,
          });
        }
        seen.add(itemIndex);
        embeddings[itemIndex] = item.embedding;
      }
      if (seen.size !== inputs.length || embeddings.some((embedding) => !embedding)) {
        return operationError("invalid-response", "A resposta OpenRouter não permite associar todos os embeddings aos inputs.", {
          provider: "openrouter", endpoint, status: response.status, requestCount: 1,
        });
      }
      const dimension = embeddings[0].length;
      if (embeddings.some((embedding) => embedding.length !== dimension)) {
        return operationError("dimension-mismatch", "Os embeddings OpenRouter não têm uma dimensão consistente.", {
          provider: "openrouter", endpoint, status: response.status, requestCount: 1,
        });
      }
      return {
        success: true,
        message: "Embeddings gerados com sucesso.",
        dimension,
        embeddings,
        provider: "openrouter",
        endpoint,
        status: response.status,
        requestCount: 1,
      };
    })();
    return await Promise.race([request, timeout]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return operationError(message.toLowerCase().includes("json") ? "invalid-response" : "connection",
      message.toLowerCase().includes("json")
        ? "Resposta JSON inválida devolvida pelo OpenRouter."
        : "Não foi possível ligar ao OpenRouter para gerar embeddings.", {
        provider: "openrouter", endpoint, apiMessage: extractSafeApiMessage(message), requestCount: 1,
      });
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}
