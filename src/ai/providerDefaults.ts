export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";
export const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai/v1";

export const PROVIDER_BASE_URL_DEFAULTS: Record<string, string> = {
  ollama: OLLAMA_DEFAULT_BASE_URL,
  mistral: MISTRAL_DEFAULT_BASE_URL,
};

const ANALYSIS_MODEL_DEFAULTS: Record<string, string> = {
  ollama: "gemma4:e2b",
  mistral: "mistral-small-latest",
};

const EMBEDDING_MODEL_DEFAULTS: Record<string, string> = {
  ollama: "nomic-embed-text-v2-moe",
  mistral: "mistral-embed",
};

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeOllamaBaseUrl(baseUrl: string): string {
  const fallbackBaseUrl = OLLAMA_DEFAULT_BASE_URL;
  const trimmedBaseUrl = trimTrailingSlashes(baseUrl || fallbackBaseUrl) || fallbackBaseUrl;
  return trimmedBaseUrl.replace(/\/api(?:\/(?:generate|chat|tags|embed|embeddings))?$/i, "");
}

export function normalizeMistralBaseUrl(baseUrl: string): string {
  const fallbackBaseUrl = MISTRAL_DEFAULT_BASE_URL;
  let normalizedBaseUrl = trimTrailingSlashes(baseUrl || fallbackBaseUrl) || fallbackBaseUrl;

  normalizedBaseUrl = normalizedBaseUrl
    .replace(/\/v1\/(?:chat\/completions|embeddings)$/i, "/v1")
    .replace(/\/(?:chat\/completions|embeddings)$/i, "");

  if (/^https:\/\/api\.mistral\.ai$/i.test(normalizedBaseUrl)) {
    return MISTRAL_DEFAULT_BASE_URL;
  }

  return normalizedBaseUrl.replace(/\/v1\/v1$/i, "/v1");
}

export function buildOllamaEmbedUrl(baseUrl: string): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}/api/embed`;
}

export function buildOllamaEmbeddingFallbackUrl(baseUrl: string): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}/api/embeddings`;
}

export function buildOllamaTextGenerateUrl(baseUrl: string): string {
  return `${normalizeOllamaBaseUrl(baseUrl)}/api/generate`;
}

export function buildMistralChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeMistralBaseUrl(baseUrl)}/chat/completions`;
}

export function buildMistralEmbeddingsUrl(baseUrl: string): string {
  return `${normalizeMistralBaseUrl(baseUrl)}/embeddings`;
}

export function getProviderBaseUrlDefault(provider: string): string {
  return PROVIDER_BASE_URL_DEFAULTS[provider] ?? "";
}

export function getAnalysisProviderDefaults(provider: string): { baseUrl: string; model: string } {
  return {
    baseUrl: getProviderBaseUrlDefault(provider),
    model: ANALYSIS_MODEL_DEFAULTS[provider] ?? "",
  };
}

export function getEmbeddingProviderDefaults(provider: string): { baseUrl: string; model: string } {
  return {
    baseUrl: getProviderBaseUrlDefault(provider),
    model: EMBEDDING_MODEL_DEFAULTS[provider] ?? "",
  };
}

function isKnownDefaultBaseUrl(value: string): boolean {
  const normalizedValue = trimTrailingSlashes(value);
  return Object.values(PROVIDER_BASE_URL_DEFAULTS).some((defaultUrl) => {
    return trimTrailingSlashes(defaultUrl) === normalizedValue;
  });
}

function isKnownDefaultModel(value: string, defaults: Record<string, string>): boolean {
  return Object.values(defaults).some((defaultModel) => defaultModel === value);
}

export function chooseProviderDefaultBaseUrl(currentBaseUrl: string, provider: string): string {
  const providerDefault = getProviderBaseUrlDefault(provider);
  if (!providerDefault) return currentBaseUrl;

  const trimmedCurrent = currentBaseUrl.trim();
  if (!trimmedCurrent || isKnownDefaultBaseUrl(trimmedCurrent)) {
    return providerDefault;
  }

  return currentBaseUrl;
}

export function chooseProviderDefaultModel(currentModel: string, provider: string, type: "analysis" | "embedding"): string {
  const defaults = type === "analysis" ? ANALYSIS_MODEL_DEFAULTS : EMBEDDING_MODEL_DEFAULTS;
  const providerDefault = defaults[provider] ?? "";
  if (!providerDefault) return currentModel;

  const trimmedCurrent = currentModel.trim();
  if (!trimmedCurrent || isKnownDefaultModel(trimmedCurrent, defaults)) {
    return providerDefault;
  }

  return currentModel;
}
