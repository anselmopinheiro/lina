export type ModelProviderId = "ollama" | "mistral";

export type ModelCatalogType = "chat" | "embedding";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  notes?: string;
  recommendedFor?: string[];
  local?: boolean;
  requiresApiKey?: boolean;
}

export interface ProviderModelCatalog {
  label: string;
  chatModels: ModelCatalogEntry[];
  embeddingModels: ModelCatalogEntry[];
}

export interface ModelCatalog {
  providers: Record<ModelProviderId, ProviderModelCatalog>;
}

const MODEL_CATALOG: ModelCatalog = {
  providers: {
    ollama: {
      label: "Ollama",
      chatModels: [
        {
          id: "gemma4:e2b",
          label: "Gemma 4 e2b",
          recommendedFor: ["analysis", "contextual-commands"],
          local: true,
          requiresApiKey: false,
        },
      ],
      embeddingModels: [
        {
          id: "nomic-embed-text-v2-moe",
          label: "nomic-embed-text-v2-moe",
          recommendedFor: ["semantic-search"],
          local: true,
          requiresApiKey: false,
          notes: "Recommended local embedding model for Lina.",
        },
        {
          id: "nomic-embed-text",
          label: "nomic-embed-text",
          recommendedFor: ["semantic-search"],
          local: true,
          requiresApiKey: false,
        },
      ],
    },
    mistral: {
      label: "Mistral",
      chatModels: [
        {
          id: "mistral-small-latest",
          label: "Mistral Small",
          recommendedFor: ["analysis", "contextual-commands"],
          local: false,
          requiresApiKey: true,
        },
        {
          id: "mistral-large-latest",
          label: "Mistral Large",
          recommendedFor: ["analysis", "contextual-commands"],
          local: false,
          requiresApiKey: true,
        },
      ],
      embeddingModels: [
        {
          id: "mistral-embed",
          label: "Mistral Embed",
          recommendedFor: ["semantic-search"],
          local: false,
          requiresApiKey: true,
        },
      ],
    },
  },
};

function isModelProviderId(provider: string): provider is ModelProviderId {
  return provider === "ollama" || provider === "mistral";
}

export function getModelCatalog(): ModelCatalog {
  return MODEL_CATALOG;
}

export function getProviderModels(provider: string, type: ModelCatalogType): ModelCatalogEntry[] {
  if (!isModelProviderId(provider)) {
    return [];
  }

  const providerCatalog = MODEL_CATALOG.providers[provider];
  return type === "chat"
    ? providerCatalog.chatModels
    : providerCatalog.embeddingModels;
}

export function isKnownModel(provider: string, type: ModelCatalogType, modelId: string): boolean {
  return getProviderModels(provider, type).some((model) => model.id === modelId);
}
