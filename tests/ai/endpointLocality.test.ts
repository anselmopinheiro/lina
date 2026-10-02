import { describe, expect, it } from "vitest";
import { classifyEndpointLocality, isLoopbackEndpoint } from "../../src/ai/endpointLocality";
import {
  getEmbeddingProviderCapability,
  isProviderEndpointLocal,
  resolveEndpointProviderCapability,
} from "../../src/ai/providerCapabilities";

describe("LINA-15F — endpoint locality classification", () => {
  it.each([
    "http://localhost:11434",
    "http://LOCALHOST:11434/",
    "https://localhost",
    "http://ollama.localhost:11434",
    "http://127.0.0.1:11434",
    "http://127.1.2.3:11434",
    "http://127.1:11434",
    "http://2130706433:11434",
    "http://0.0.0.0:11434",
    "http://[::1]:11434",
    "http://[::ffff:127.0.0.1]:11434",
    "  http://localhost:11434/api  ",
  ])("treats %s as loopback", (url) => {
    expect(classifyEndpointLocality(url)).toBe("loopback");
    expect(isLoopbackEndpoint(url)).toBe(true);
  });

  it.each([
    "http://192.168.1.20:11434",
    "http://10.0.0.5:11434",
    "http://meupc.local:11434",
    "http://ollama-server:11434",
    "https://ollama.example.com",
    "https://api.mistral.ai/v1",
    "https://openrouter.ai/api/v1",
    "http://128.0.0.1:11434",
    "http://[2001:db8::1]:11434",
    "http://localhost.example.com:11434",
    "http://notlocalhost:11434",
  ])("treats %s as remote", (url) => {
    expect(classifyEndpointLocality(url)).toBe("remote");
    expect(isLoopbackEndpoint(url)).toBe(false);
  });

  it.each([undefined, null, "", "   ", "not a url", "localhost:11434", "ftp://localhost", "file:///tmp/x", "http://"])(
    "treats %j as invalid (never local)",
    (url) => {
      expect(classifyEndpointLocality(url as string | null | undefined)).toBe("invalid");
      expect(isLoopbackEndpoint(url as string | null | undefined)).toBe(false);
    }
  );
});

describe("LINA-15F — effective provider/endpoint capability", () => {
  it("keeps the static capability table describing what a provider can do", () => {
    expect(getEmbeddingProviderCapability("ollama").isLocal).toBe(true);
    expect(getEmbeddingProviderCapability("mistral").isLocal).toBe(false);
  });

  it("Ollama on loopback is local", () => {
    expect(isProviderEndpointLocal("ollama", "http://localhost:11434")).toBe(true);
    expect(isProviderEndpointLocal("Ollama", "http://127.0.0.1:11434")).toBe(true);
    expect(resolveEndpointProviderCapability("ollama", "http://localhost:11434").isLocal).toBe(true);
  });

  it.each(["http://192.168.1.20:11434", "https://ollama.example.com", "http://meupc.local:11434", "not a url", ""])(
    "Ollama on %j is NOT local, without becoming a paid provider",
    (url) => {
      expect(isProviderEndpointLocal("ollama", url)).toBe(false);
      const capability = resolveEndpointProviderCapability("ollama", url);
      expect(capability.isLocal).toBe(false);
      expect(capability.hasExternalCost).toBe(false);
      expect(capability.providerId).toBe("ollama");
    }
  );

  it("non-Ollama and unknown providers stay external even on a loopback endpoint", () => {
    expect(isProviderEndpointLocal("mistral", "http://localhost:8080")).toBe(false);
    expect(isProviderEndpointLocal("openrouter", "http://127.0.0.1:8080")).toBe(false);
    expect(isProviderEndpointLocal("custom-cloud", "http://localhost:8080")).toBe(false);
    expect(resolveEndpointProviderCapability("mistral", "https://api.mistral.ai/v1").hasExternalCost).toBe(true);
  });
});
