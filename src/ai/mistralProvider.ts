import { requestUrl } from "obsidian";
import { EmbeddingGenerationStatus, OllamaTextGenerationStatus } from "./ollamaProvider";
import { buildMistralChatCompletionsUrl, buildMistralEmbeddingsUrl, MISTRAL_DEFAULT_BASE_URL } from "./providerDefaults";

interface MistralChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface MistralEmbeddingResponse {
  data?: Array<{
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

export async function generateMistralEmbedding(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: string,
  timeoutMs: number = 60000
): Promise<EmbeddingGenerationStatus> {
  const embeddingsUrl = buildMistralEmbeddingsUrl(baseUrl || MISTRAL_DEFAULT_BASE_URL);

  if (!apiKey.trim()) {
    return {
      success: false,
      message: "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.",
      provider: "mistral",
      endpoint: embeddingsUrl,
    };
  }

  try {
    const timeoutPromise = new Promise<EmbeddingGenerationStatus>((resolve) => {
      window.setTimeout(() => {
        resolve({
          success: false,
          message: "Tempo limite excedido ao gerar embedding com Mistral.",
          provider: "mistral",
          endpoint: embeddingsUrl,
        });
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
          input: [input],
        }),
      });

      if (response.status !== 200) {
        return {
          success: false,
          message: formatMistralStatusMessage(response.status),
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          apiMessage: extractSafeApiMessage(response.json),
        };
      }

      const data = response.json as MistralEmbeddingResponse;
      const embedding = data.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return {
          success: false,
          message: "A Mistral devolveu um embedding vazio ou num formato inesperado.",
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          apiMessage: extractSafeApiMessage(data),
        };
      }

      if (!embedding.every((value: unknown) => typeof value === "number")) {
        return {
          success: false,
          message: "A Mistral devolveu um embedding com valores inválidos.",
          provider: "mistral",
          endpoint: embeddingsUrl,
          status: response.status,
          apiMessage: extractSafeApiMessage(data),
        };
      }

      return {
        success: true,
        message: "Embedding gerado com sucesso.",
        dimension: embedding.length,
        embedding,
        provider: "mistral",
        endpoint: embeddingsUrl,
        status: response.status,
      };
    })();

    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("json")) {
      return {
        success: false,
        message: "Resposta JSON inválida devolvida pela Mistral.",
        provider: "mistral",
        endpoint: embeddingsUrl,
        apiMessage: extractSafeApiMessage(message),
      };
    }

    return {
      success: false,
      message: `Não foi possível gerar embedding com Mistral: ${message}`,
      provider: "mistral",
      endpoint: embeddingsUrl,
      apiMessage: extractSafeApiMessage(message),
    };
  }
}
