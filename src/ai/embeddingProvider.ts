import { EmbeddingEndpointMode, EmbeddingGenerationStatus, operationError } from "./embeddingTypes";
import { generateOllamaEmbeddings } from "./ollamaProvider";
import { generateMistralEmbeddings } from "./mistralProvider";

export interface ProviderEmbeddingRequest {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  input: string;
  timeoutMs: number;
}

export interface ProviderEmbeddingBatchRequest {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  inputs: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  endpointMode?: EmbeddingEndpointMode;
}

export async function generateProviderEmbeddings(
  request: ProviderEmbeddingBatchRequest
): Promise<EmbeddingGenerationStatus> {
  const provider = request.provider.toLowerCase();
  if (request.inputs.length === 0) {
    return operationError("configuration", "Não existem inputs para gerar embeddings.", {
      provider: request.provider,
      requestCount: 0,
    });
  }

  if (provider === "mistral") {
    return await generateMistralEmbeddings(
      request.baseUrl,
      request.apiKey ?? "",
      request.model,
      request.inputs,
      request.timeoutMs
    );
  }

  if (provider === "ollama") {
    return await generateOllamaEmbeddings(
      request.baseUrl,
      request.model,
      request.inputs,
      request.endpointMode ?? "auto",
      request.timeoutMs
    );
  }

  return operationError(
    "unsupported-provider",
    `Provider de embeddings "${request.provider}" ainda não implementado nesta versão.`,
    { provider: request.provider, requestCount: 0 }
  );
}

export async function generateProviderEmbedding(request: ProviderEmbeddingRequest): Promise<EmbeddingGenerationStatus> {
  const status = await generateProviderEmbeddings({
    provider: request.provider,
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    model: request.model,
    inputs: [request.input],
    timeoutMs: request.timeoutMs,
    endpointMode: "auto",
  });

  if (!status.success) {
    return status;
  }

  const embedding = status.embeddings?.[0];
  if (!embedding) {
    return operationError("invalid-response", "O provider não devolveu o embedding pedido.", {
      provider: status.provider ?? request.provider,
      endpoint: status.endpoint,
      status: status.status,
      requestCount: status.requestCount,
      fallbackUsed: status.fallbackUsed,
      fallbackReason: status.fallbackReason,
      endpointMode: status.endpointMode,
    });
  }

  return {
    ...status,
    embedding,
    dimension: embedding.length,
  };
}
