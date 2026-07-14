import { requestUrl } from "obsidian";
import { buildOllamaEmbedUrl, buildOllamaEmbeddingFallbackUrl, buildOllamaTextGenerateUrl, normalizeOllamaBaseUrl } from "./providerDefaults";
import {
  classifyEmbeddingHttpStatus,
  EmbeddingGenerationStatus,
  isValidEmbeddingVector,
  operationError
} from "./embeddingTypes";

export type { EmbeddingGenerationStatus } from "./embeddingTypes";

export interface OllamaConnectionStatus {
  success: boolean;
  message: string;
  models?: string[];
}

export interface OllamaTextGenerationStatus {
  success: boolean;
  message: string;
  text?: string;
}

function getRequestStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;

  const match = error.message.match(/\bstatus\s+(\d{3})\b/i);
  if (!match) return undefined;

  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}

function buildOllamaTextStatusMessage(status: number, endpoint: string, model: string): string {
  const safeModel = model || "(vazio)";
  if (status === 404) {
    return `O Ollama respondeu 404. Verifica se o endpoint e o modelo estão corretos. Modelo usado: ${safeModel}. Endpoint: ${endpoint}.`;
  }

  return `O Ollama respondeu com status ${status}. Modelo usado: ${safeModel}. Endpoint: ${endpoint}.`;
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
  if (typeof value === "string") {
    return sanitizeApiMessage(value);
  }

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
    if (typeof nested === "string") {
      return sanitizeApiMessage(nested);
    }

    const message = extractSafeApiMessage(nested);
    if (message) return message;
  }

  return undefined;
}

function mentionsMissingModel(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("model") && (
    normalized.includes("not found")
    || normalized.includes("does not exist")
    || normalized.includes("not installed")
    || normalized.includes("pull")
  );
}

function isEndpointIncompatibilityStatus(status: number, apiMessage: string | undefined): boolean {
  if (mentionsMissingModel(apiMessage)) {
    return false;
  }

  return status === 400 || status === 404 || status === 405 || status === 422;
}

function classifyOllamaHttpStatus(status: number, apiMessage: string | undefined): ReturnType<typeof classifyEmbeddingHttpStatus> {
  if (mentionsMissingModel(apiMessage)) {
    return { category: "model-not-found", scope: "operation", fatal: true };
  }

  return classifyEmbeddingHttpStatus(status);
}

export async function testOllamaConnection(baseUrl: string): Promise<OllamaConnectionStatus> {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const apiUrl = `${normalizedBaseUrl}/api/tags`;

  try {
    const response = await requestUrl({
      url: apiUrl,
      method: "GET",
      contentType: "application/json",
    });

    if (response.status === 200) {
      const data = response.json as { models: Array<{ name: string }> };
      const modelNames = data.models.map(model => model.name);
      return {
        success: true,
        message: "Ligação ao Ollama estabelecida.",
        models: modelNames,
      };
    }

    return {
      success: false,
      message: `Ollama responded with status ${response.status}.`,
    };
  } catch (error) {
    console.error("Error testing Ollama connection:", error);
    let errorMessage = "Não foi possível ligar ao Ollama.";
    if (error instanceof Error) {
      errorMessage = `Não foi possível ligar ao Ollama: ${error.message}`;
    }
    return {
      success: false,
      message: errorMessage,
    };
  }
}

export async function generateOllamaEmbedding(
  baseUrl: string,
  model: string,
  input: string
): Promise<EmbeddingGenerationStatus> {
  const embedUrl = buildOllamaEmbedUrl(baseUrl);
  let requestCount = 0;
  let firstEndpointMessage: string | undefined;
  let fallbackReason: string | undefined;

  try {
    requestCount++;
    const response = await requestUrl({
      url: embedUrl,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        model,
        input,
      }),
    });

    if (response.status === 200) {
      const data = response.json as { embeddings?: number[][]; dimension?: number };
      if (Array.isArray(data.embeddings) && data.embeddings.length > 0 && isValidEmbeddingVector(data.embeddings[0])) {
        const embedding = data.embeddings[0];
        if (typeof data.dimension === "number" && data.dimension !== embedding.length) {
          return operationError("dimension-mismatch", "A dimensão reportada pelo Ollama não coincide com o tamanho do vetor.", {
            provider: "ollama",
            endpoint: embedUrl,
            status: response.status,
            requestCount,
          });
        }
        return {
          success: true,
          message: "Embedding gerado com sucesso.",
          dimension: embedding.length,
          embedding,
          provider: "ollama",
          endpoint: embedUrl,
          status: response.status,
          requestCount,
          fallbackUsed: false,
        };
      }

      console.warn("Resposta do Ollama sem embeddings ou formato inesperado:", data);
      firstEndpointMessage = "Embedding devolvido num formato inesperado no endpoint /api/embed.";
      fallbackReason = "modern-endpoint-invalid-response";
    } else {
      console.warn(`Endpoint /api/embed devolveu status ${response.status}.`);
      const apiMessage = extractSafeApiMessage(response.json);
      if (!isEndpointIncompatibilityStatus(response.status, apiMessage)) {
        const classified = classifyOllamaHttpStatus(response.status, apiMessage);
        return {
          success: false,
          message: `Ollama respondeu com status ${response.status} no endpoint /api/embed.`,
          provider: "ollama",
          endpoint: embedUrl,
          status: response.status,
          apiMessage,
          errorCategory: classified.category,
          errorScope: classified.scope,
          fatal: classified.fatal,
          requestCount,
          fallbackUsed: false,
        };
      }

      fallbackReason = `modern-endpoint-status-${response.status}`;
      const classified = classifyEmbeddingHttpStatus(response.status);
      firstEndpointMessage = `Ollama respondeu com status ${response.status} no endpoint /api/embed. Categoria: ${classified.category}.`;
    }
  } catch (error) {
    console.warn("Endpoint /api/embed falhou; fallback /api/embeddings não será tentado para erro de ligação.", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return operationError("connection", `Não foi possível gerar embedding: ${errorMessage}`, {
      provider: "ollama",
      endpoint: embedUrl,
      apiMessage: extractSafeApiMessage(errorMessage),
      requestCount,
      fallbackUsed: false,
    });
  }

  const fallbackUrl = buildOllamaEmbeddingFallbackUrl(baseUrl);
  try {
    requestCount++;
    const response = await requestUrl({
      url: fallbackUrl,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        model,
        prompt: input,
      }),
    });

    if (response.status === 200) {
      const fallbackData = response.json as { embedding?: number[]; dimension?: number };
      if (isValidEmbeddingVector(fallbackData.embedding)) {
        const embedding = fallbackData.embedding;
        if (typeof fallbackData.dimension === "number" && fallbackData.dimension !== embedding.length) {
          return operationError("dimension-mismatch", "A dimensão reportada pelo Ollama não coincide com o tamanho do vetor.", {
            provider: "ollama",
            endpoint: fallbackUrl,
            status: response.status,
            requestCount,
          });
        }
        return {
          success: true,
          message: "Embedding gerado com sucesso.",
          dimension: embedding.length,
          embedding,
          provider: "ollama",
          endpoint: fallbackUrl,
          status: response.status,
          requestCount,
          fallbackUsed: true,
          fallbackReason,
        };
      }

      console.warn("Embedding devolvido num formato inesperado no fallback:", fallbackData);
      return operationError("invalid-vector", "Embedding devolvido num formato inesperado.", {
        provider: "ollama",
        endpoint: fallbackUrl,
        status: response.status,
        apiMessage: extractSafeApiMessage(fallbackData) ?? firstEndpointMessage,
        requestCount,
        fallbackUsed: true,
        fallbackReason,
      });
    }

    const fallbackApiMessage = extractSafeApiMessage(response.json);
    const classified = isEndpointIncompatibilityStatus(response.status, fallbackApiMessage)
      ? { category: "invalid-response" as const, scope: "operation" as const, fatal: true }
      : classifyOllamaHttpStatus(response.status, fallbackApiMessage);
    return {
      success: false,
      message: `Ollama respondeu com status ${response.status} no fallback.`,
      provider: "ollama",
      endpoint: fallbackUrl,
      status: response.status,
      apiMessage: fallbackApiMessage ?? firstEndpointMessage,
      errorCategory: classified.category,
      errorScope: classified.scope,
      fatal: classified.fatal,
      requestCount,
      fallbackUsed: true,
      fallbackReason,
    };
  } catch (error) {
    console.error("Error generating Ollama embedding:", error);
    let errorMessage = "Não foi possível gerar embedding.";
    if (error instanceof Error) {
      errorMessage = `Não foi possível gerar embedding: ${error.message}`;
    }
    return operationError("connection", errorMessage, {
      provider: "ollama",
      endpoint: fallbackUrl,
      apiMessage: extractSafeApiMessage(errorMessage) ?? firstEndpointMessage,
      requestCount,
      fallbackUsed: true,
      fallbackReason,
    });
  }
}

export async function generateOllamaText(
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number = 60000
): Promise<OllamaTextGenerationStatus> {
  const generateUrl = buildOllamaTextGenerateUrl(baseUrl);

  try {
    const timeoutPromise = new Promise<OllamaTextGenerationStatus>((resolve) => {
      window.setTimeout(() => {
        resolve({
          success: false,
          message: "Tempo limite excedido ao gerar resposta com IA.",
        });
      }, timeoutMs);
    });

    const requestPromise = (async () => {
      const response = await requestUrl({
        url: generateUrl,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
      });

      if (response.status !== 200) {
        return {
          success: false,
          message: buildOllamaTextStatusMessage(response.status, generateUrl, model),
        };
      }

      const data = response.json as { response?: unknown };
      if (typeof data.response !== "string") {
        return {
          success: false,
          message: "Resposta do Ollama em formato inesperado.",
        };
      }

      return {
        success: true,
        message: "Resposta gerada com sucesso.",
        text: data.response,
      };
    })();

    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    console.error("Error generating Ollama text:", error);
    let errorMessage = "Não foi possível gerar resposta com IA.";
    const status = getRequestStatus(error);
    if (status !== undefined) {
      errorMessage = buildOllamaTextStatusMessage(status, generateUrl, model);
    } else if (error instanceof Error) {
      errorMessage = `Não foi possível gerar resposta com IA: ${error.message}`;
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
}
