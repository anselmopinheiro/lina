import { requestUrl } from "obsidian";

export interface OllamaConnectionStatus {
  success: boolean;
  message: string;
  models?: string[];
}

export interface EmbeddingGenerationStatus {
  success: boolean;
  message: string;
  dimension?: number;
  embedding?: number[];
}

export interface OllamaTextGenerationStatus {
  success: boolean;
  message: string;
  text?: string;
}

function normalizeOllamaTextBaseUrl(baseUrl: string): string {
  const fallbackBaseUrl = "http://localhost:11434";
  const trimmedBaseUrl = (baseUrl || fallbackBaseUrl).trim() || fallbackBaseUrl;
  const withoutTrailingSlashes = trimmedBaseUrl.replace(/\/+$/, "");
  return withoutTrailingSlashes.replace(/\/api(?:\/(?:generate|chat|tags|embed|embeddings))?$/i, "");
}

function buildOllamaTextGenerateUrl(baseUrl: string): string {
  return `${normalizeOllamaTextBaseUrl(baseUrl)}/api/generate`;
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

export async function testOllamaConnection(baseUrl: string): Promise<OllamaConnectionStatus> {
  // Normalize URL to ensure it ends with a single slash
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
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
    } else {
      return {
        success: false,
        message: `Ollama responded with status ${response.status}.`,
      };
    }
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
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const embedUrl = `${normalizedBaseUrl}/api/embed`;

  try {
    // Primeiro tenta o endpoint /api/embed
    let response = await requestUrl({
      url: embedUrl,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        model: model,
        input: input,
      }),
    });

    if (response.status === 200) {
      const data = response.json as { embeddings?: number[][] };
      if (Array.isArray(data.embeddings) && data.embeddings.length > 0 && Array.isArray(data.embeddings[0])) {
        const dimension = data.embeddings[0].length;
        return {
          success: true,
          message: "Embedding gerado com sucesso.",
          dimension: dimension,
          embedding: data.embeddings[0],
        };
      } else {
        console.warn("Resposta do Ollama sem embeddings ou formato inesperado:", data);
        // Continue to fallback
      }
    } else {
      console.warn(`Endpoint /api/embed devolveu status ${response.status}.`);
      // Continue to fallback
    }

    // Fallback para endpoint /api/embeddings
    const fallbackUrl = `${normalizedBaseUrl}/api/embeddings`;
    response = await requestUrl({
      url: fallbackUrl,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        model: model,
        prompt: input,
      }),
    });

    if (response.status === 200) {
      const fallbackData = response.json as { embedding?: number[] };
      if (Array.isArray(fallbackData.embedding) && fallbackData.embedding.length > 0) {
        const dimension = fallbackData.embedding.length;
        return {
          success: true,
          message: "Embedding gerado com sucesso.",
          dimension: dimension,
          embedding: fallbackData.embedding,
        };
      } else {
        console.warn("Embedding devolvido num formato inesperado no fallback:", fallbackData);
        return {
          success: false,
          message: "Embedding devolvido num formato inesperado.",
        };
      }
    } else {
      return {
        success: false,
        message: `Ollama respondeu com status ${response.status} no fallback.`,
      };
    }
  } catch (error) {
    console.error("Error generating Ollama embedding:", error);
    let errorMessage = "Não foi possível gerar embedding.";
    if (error instanceof Error) {
      errorMessage = `Não foi possível gerar embedding: ${error.message}`;
    }
    return {
      success: false,
      message: errorMessage,
    };
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
    // Criar promise com timeout
    const timeoutPromise = new Promise<OllamaTextGenerationStatus>((resolve) => {
      window.setTimeout(() => {
        resolve({
          success: false,
          message: "Tempo limite excedido ao gerar resposta com IA.",
        });
      }, timeoutMs);
    });

    // Criar promise da chamada ao Ollama
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

    // Race entre a chamada e o timeout
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
