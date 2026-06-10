import { requestUrl, Notice } from "obsidian";
import { DEFAULT_SETTINGS } from "src/settings"; // Assuming DEFAULT_SETTINGS is accessible here

export interface OllamaConnectionStatus {
  success: boolean;
  message: string;
  models?: string[];
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
      // Add a timeout to prevent hanging indefinitely
      // Note: requestUrl doesn't directly support timeout, so we'll rely on network timeouts or handle it implicitly.
      // For simplicity, we'll assume a reasonable network timeout.
    });

  
    if (response.status === 200) {
      // The response.json is already parsed if contentType is application/json
      const data = response.json as { models: Array<{ name: string }> };
      const modelNames = data.models.map(model => model.name);
      return {
        success: true,
        message: "Ligação ao Ollama estabelecida.",
        models: modelNames,
      };
    } else {
      // Handle non-200 status codes
      return {
        success: false,
        message: `Ollama responded with status ${response.status}.`,
      };
    }
  } catch (error) {
    // Handle network errors or other exceptions
    console.error("Error testing Ollama connection:", error);
    // Ensure the error message is user-friendly
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
