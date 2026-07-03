import { EmbeddingGenerationStatus, generateOllamaEmbedding } from "./ollamaProvider";
import { generateMistralEmbedding } from "./mistralProvider";

export interface ProviderEmbeddingRequest {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  input: string;
  timeoutMs: number;
}

export async function generateProviderEmbedding(request: ProviderEmbeddingRequest): Promise<EmbeddingGenerationStatus> {
  const provider = request.provider.toLowerCase();
  const timeoutPromise = new Promise<EmbeddingGenerationStatus>((resolve) => {
    window.setTimeout(() => {
      resolve({
        success: false,
        message: "Tempo limite excedido ao gerar embedding.",
      });
    }, request.timeoutMs);
  });

  const requestPromise = (async () => {
    if (provider === "mistral") {
      return await generateMistralEmbedding(
        request.baseUrl,
        request.apiKey ?? "",
        request.model,
        request.input,
        request.timeoutMs
      );
    }

    if (provider === "ollama") {
      return await generateOllamaEmbedding(
        request.baseUrl,
        request.model,
        request.input
      );
    }

    return {
      success: false,
      message: `Provider de embeddings "${request.provider}" ainda não implementado nesta versão.`,
    };
  })();

  return await Promise.race([requestPromise, timeoutPromise]);
}
