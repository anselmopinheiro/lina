export type AIProvider =
  | "ollama"
  | "mistral"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "custom";

export const DEFAULT_AI_PROVIDER: AIProvider = "ollama";

export interface AIProviderSettings {
  provider: AIProvider;
  ollamaUrl?: string;
  openrouterUrl?: string;
  openaiUrl?: string;
  anthropicUrl?: string;
  geminiUrl?: string;
  chatModel?: string;
  embeddingModel?: string;
}

export const DEFAULT_AI_PROVIDER_SETTINGS: AIProviderSettings = {
  provider: DEFAULT_AI_PROVIDER,
  ollamaUrl: "http://localhost:11434",
  chatModel: "llama3",
  embeddingModel: "nomic-embed-text",
};
