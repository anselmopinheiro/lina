import { requestUrl } from "obsidian";
import { OllamaTextGenerationStatus } from "./ollamaProvider";
import { buildMistralChatCompletionsUrl, buildMistralEmbeddingsUrl, MISTRAL_DEFAULT_BASE_URL } from "./providerDefaults";
import {
  classifyEmbeddingHttpStatus,
  EmbeddingGenerationStatus,
  isValidEmbeddingVector,
  operationError
} from "./embeddingTypes";

interface MistralChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface MistralEmbeddingResponse {
  data?: Array<{
    index?: unknown;
    embedding?: unknown;
  }>;
}

function formatMistralStatusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Chave API da Mistral inválida ou sem permissões.";
  }
  if (status === 404) {
    return "Modelo Mistral não encontrado. Verifica o modelo configurado.";
  }
  if (status === 429) {
    return "Limite de pedidos da Mistral atingido. Tenta novamente mais tarde.";
  }
  if (status >= 500) {
    return "A Mistral devolveu um erro temporário. Tenta novamente mais tarde.";
  }
  if (status === 413) {
    return "A Mistral rejeitou este input por exceder um limite do pedido.";
  }
  return `A Mistral respondeu com status ${status}.`;
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

export async function generateMistralText(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs: number = 60000
): Promise<OllamaTextGenerationStatus> {
  if (!apiKey.trim()) {
    return {
      success: false,
      message: "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.",
    };
  }

  const chatUrl = buildMistralChatCompletionsUrl(baseUrl || MISTRAL_DEFAULT_BASE_URL);

  try {
    const timeoutPromise = new Promise<OllamaTextGenerationStatus>((resolve) => {
      window.setTimeout(() => {
        resolve({
          success: false,
          message: "Tempo limite excedido ao gerar resposta com Mistral.",
        });
      }, timeoutMs);
    });

    const requestPromise = (async () => {
      const response = await requestUrl({
        url: chatUrl,
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
        }),
      });

      if (response.status !== 200) {
        return {
          success: false,
          message: formatMistralStatusMessage(response.status),
        };
      }

      const data = response.json as MistralChatResponse;
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim().length === 0) {
        return {
          success: false,
          message: "A Mistral devolveu uma resposta vazia ou num formato inesperado.",
        };
      }

      return {
        success: true,
        message: "Resposta gerada com sucesso.",
        text,
      };
    })();

    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("json")) {
      return {
        success: false,
        message: "Resposta JSON inválida devolvida pela Mistral.",
      };
    }

    return {
      success: false,
      message: `Não foi possível gerar resposta com Mistral: ${message}`,
    };
  }
}

export async function generateMistralEmbeddings(
  baseUrl: string,
  apiKey: string,
  model: string,
  inputs: string[],
  timeoutMs: number = 60000
): Promise<EmbeddingGenerationStatus> {
  const embeddingsUrl = buildMistralEmbeddingsUrl(baseUrl || MISTRAL_DEFAULT_BASE_URL);

  if (!apiKey.trim()) {
    return operationError("configuration", "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.", {
      provider: "mistral",
      endpoint: embeddingsUrl,
      requestCount: 0,
    });
  }

  if (inputs.length === 0) {
    return operationError("configuration", "Não existem inputs para gerar embeddings com Mistral.", {
      provider: "mistral",
      endpoint: embeddingsUrl,
      requestCount: 0,
    });
  }

  let timeoutId: number | undefined;
  try {
    const timeoutPromise = new Promise<EmbeddingGenerationStatus>((resolve) => {
      timeoutId = window.setTimeout(() => {
        resolve(operationError("timeout", "Tempo limite excedido ao gerar embedding com Mistral.", {
          provider: "mistral",
          endpoint: embeddingsUrl,
          requestCount: 1,
        }));
      }, timeoutMs);
    });

    const requestPromise = (async () => {
      const response = await requestUrl({
        url: embeddingsUrl,
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: inputs,
        }),
      });

      if (response.status !== 200) {
        const classified = classifyEmbeddingHttpStatus(response.status);
        return {
          success: false,
          message: formatMistralStatusMessage(response.status),
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          apiMessage: extractSafeApiMessage(response.json),
          errorCategory: classified.category,
          errorScope: classified.scope,
          fatal: classified.fatal,
          requestCount: 1,
        };
      }

      const data = response.json as MistralEmbeddingResponse;
      if (!Array.isArray(data.data) || data.data.length !== inputs.length) {
        return operationError("invalid-response", "A Mistral devolveu um número de embeddings diferente do número de inputs.", {
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          apiMessage: extractSafeApiMessage(data),
          requestCount: 1,
        });
      }

      const embeddings = new Array<number[]>(inputs.length);
      const seenIndices = new Set<number>();
      for (let responseIndex = 0; responseIndex < data.data.length; responseIndex++) {
        const item: { index?: unknown; embedding?: unknown } = data.data[responseIndex];
        const itemIndex = Number.isInteger(item.index)
          ? item.index as number
          : inputs.length === 1
            ? 0
            : null;
        if (itemIndex === null || itemIndex < 0 || itemIndex >= inputs.length || seenIndices.has(itemIndex)) {
          return operationError("invalid-response", "A Mistral devolveu índices de embeddings ambíguos ou inválidos.", {
            provider: "mistral",
            endpoint: embeddingsUrl,
            status: response.status,
            requestCount: 1,
          });
        }

        if (!isValidEmbeddingVector(item.embedding)) {
          return operationError("invalid-vector", "A Mistral devolveu um embedding com valores inválidos.", {
            provider: "mistral",
            endpoint: embeddingsUrl,
            status: response.status,
            apiMessage: extractSafeApiMessage(data),
            requestCount: 1,
          });
        }

        seenIndices.add(itemIndex);
        embeddings[itemIndex] = item.embedding;
      }

      if (seenIndices.size !== inputs.length || embeddings.some((embedding) => !embedding)) {
        return operationError("invalid-response", "A resposta da Mistral não permite associar todos os embeddings aos inputs.", {
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          requestCount: 1,
        });
      }

      const dimension = embeddings[0].length;
      if (embeddings.some((embedding) => embedding.length !== dimension)) {
        return operationError("dimension-mismatch", "Os embeddings devolvidos pela Mistral não têm uma dimensão consistente.", {
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          requestCount: 1,
        });
      }

      return {
        success: true,
        message: "Embeddings gerados com sucesso.",
        dimension,
        embeddings,
        provider: "mistral",
        endpoint: embeddingsUrl,
        status: response.status,
        requestCount: 1,
      };
    })();

    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("json")) {
      return operationError("invalid-response", "Resposta JSON inválida devolvida pela Mistral.", {
        provider: "mistral",
        endpoint: embeddingsUrl,
        apiMessage: extractSafeApiMessage(message),
        requestCount: 1,
      });
    }

    return operationError("connection", `Não foi possível gerar embedding com Mistral: ${message}`, {
      provider: "mistral",
      endpoint: embeddingsUrl,
      apiMessage: extractSafeApiMessage(message),
      requestCount: 1,
    });
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function generateMistralEmbedding(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: string,
  timeoutMs: number = 60000
): Promise<EmbeddingGenerationStatus> {
  const status = await generateMistralEmbeddings(baseUrl, apiKey, model, [input], timeoutMs);
  if (!status.success) {
    return status;
  }

  const embedding = status.embeddings?.[0];
  if (!embedding) {
    return operationError("invalid-response", "A Mistral não devolveu o embedding pedido.", {
      provider: status.provider ?? "mistral",
      endpoint: status.endpoint,
      status: status.status,
      requestCount: status.requestCount,
    });
  }

  return {
    ...status,
    embedding,
    dimension: embedding.length,
  };
}
