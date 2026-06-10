import { requestUrl, Notice } from "obsidian";
import { DEFAULT_SETTINGS } from "src/settings"; // Assuming DEFAULT_SETTINGS is accessible here
import { AIProviderSettings } from "./types"; // Import AIProviderSettings to access model and URL

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
