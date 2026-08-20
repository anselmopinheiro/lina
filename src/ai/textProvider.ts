import { generateMistralText } from "./mistralProvider";
import { generateOllamaText, type OllamaTextGenerationStatus } from "./ollamaProvider";
import { generateOpenRouterText } from "./openRouterProvider";
import {
  MISTRAL_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_BASE_URL,
} from "./providerDefaults";
import { isPureLocalProviderSupportedForDomain } from "../settings/pureLocalSettingsModel";

export interface ProviderTextGenerationRequest {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}

/** Dispatches analysis/chat only after validating the provider's chat capability. */
export async function generateProviderText(
  request: ProviderTextGenerationRequest,
): Promise<OllamaTextGenerationStatus> {
  const provider = request.provider.trim().toLowerCase();
  if (!isPureLocalProviderSupportedForDomain(provider, "analysis")) {
    return {
      success: false,
      message: `Provider de análise "${request.provider}" ainda não é suportado nesta versão.`,
    };
  }

  switch (provider) {
    case "ollama":
      return generateOllamaText(
        request.baseUrl || OLLAMA_DEFAULT_BASE_URL,
        request.model || "gemma4:e2b",
        request.prompt,
        request.timeoutMs,
      );
    case "mistral":
      return generateMistralText(
        request.baseUrl || MISTRAL_DEFAULT_BASE_URL,
        request.apiKey ?? "",
        request.model || "mistral-small-latest",
        request.prompt,
        request.timeoutMs,
      );
    case "openrouter":
      return generateOpenRouterText(
        request.baseUrl || OPENROUTER_DEFAULT_BASE_URL,
        request.apiKey ?? "",
        request.model,
        request.prompt,
        request.timeoutMs,
      );
  }

  return {
    success: false,
    message: `Provider de análise "${request.provider}" ainda não é suportado nesta versão.`,
  };
}
