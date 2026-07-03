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
  if (!apiKey.trim()) {
    return {
      success: false,
      message: "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.",
    };
  }

  const embeddingsUrl = buildMistralEmbeddingsUrl(baseUrl || MISTRAL_DEFAULT_BASE_URL);

  try {
    const timeoutPromise = new Promise<EmbeddingGenerationStatus>((resolve) => {
      window.setTimeout(() => {
        resolve({
          success: false,
          message: "Tempo limite excedido ao gerar embedding com Mistral.",
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
        };
      }

      const data = response.json as MistralEmbeddingResponse;
      const embedding = data.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return {
          success: false,
          message: "A Mistral devolveu um embedding vazio ou num formato inesperado.",
        };
      }

      if (!embedding.every((value: unknown) => typeof value === "number")) {
        return {
          success: false,
          message: "A Mistral devolveu um embedding com valores inválidos.",
        };
      }

      return {
        success: true,
        message: "Embedding gerado com sucesso.",
        dimension: embedding.length,
        embedding,
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
      message: `Não foi possível gerar embedding com Mistral: ${message}`,
    };
  }
}
