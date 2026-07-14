import { EmbeddingGenerationStatus, operationError } from "./embeddingTypes";
import { generateOllamaEmbedding } from "./ollamaProvider";
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
      resolve(operationError("timeout", "Tempo limite excedido ao gerar embedding.", {
        provider: request.provider,
        requestCount: 1,
      }));
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

    return operationError(
      "unsupported-provider",
      `Provider de embeddings "${request.provider}" ainda não implementado nesta versão.`,
      { provider: request.provider }
    );
  })();

  return await Promise.race([requestPromise, timeoutPromise]);
}
