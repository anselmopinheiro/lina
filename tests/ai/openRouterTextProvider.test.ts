import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { generateOpenRouterText } from "../../src/ai/openRouterProvider";
import { generateProviderText } from "../../src/ai/textProvider";

function response(status: number, json: unknown): unknown {
  return { status, json };
}

function requestOptions(call: unknown[]): { url: string; headers: Record<string, string>; body: string } {
  return call[0] as { url: string; headers: Record<string, string>; body: string };
}

describe("OpenRouter analysis provider", () => {
  let requestUrlMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    });
    requestUrlMock = vi.spyOn(obsidian, "requestUrl");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("dispatches Ollama, Mistral, and OpenRouter analysis to their respective adapters", async () => {
    requestUrlMock
      .mockResolvedValueOnce(response(200, { response: "ollama ok" }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: "mistral ok" } }] }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: "openrouter ok" } }] }));

    await expect(generateProviderText({ provider: "ollama", baseUrl: "http://localhost:11434", model: "gemma4:e2b", prompt: "ping", timeoutMs: 60_000 }))
      .resolves.toMatchObject({ success: true, text: "ollama ok" });
    await expect(generateProviderText({ provider: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: "mistral-secret", model: "mistral-small-latest", prompt: "ping", timeoutMs: 60_000 }))
      .resolves.toMatchObject({ success: true, text: "mistral ok" });
    await expect(generateProviderText({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "openrouter-secret", model: "openai/gpt-4.1-mini", prompt: "ping", timeoutMs: 60_000 }))
      .resolves.toMatchObject({ success: true, text: "openrouter ok" });

    expect(requestOptions(requestUrlMock.mock.calls[0]!).url).toBe("http://localhost:11434/api/generate");
    expect(requestOptions(requestUrlMock.mock.calls[1]!).url).toBe("https://api.mistral.ai/v1/chat/completions");
    const openRouterRequest = requestOptions(requestUrlMock.mock.calls[2]!);
    expect(openRouterRequest.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(openRouterRequest.headers.Authorization).toBe("Bearer openrouter-secret");
    expect(JSON.parse(openRouterRequest.body)).toEqual({
      model: "openai/gpt-4.1-mini",
      messages: [{ role: "user", content: "ping" }],
      temperature: 0.2,
    });
  });

  it.each([
    [401, "authentication", "inválida"],
    [402, "billing", "faturação"],
    [429, "rate-limit", "limite"],
    [500, "connection", "temporariamente indisponível"],
  ] as const)("normalizes HTTP %s without exposing the API key", async (status, errorCategory, expectedMessage) => {
    requestUrlMock.mockResolvedValue(response(status, { error: { message: "Bearer openrouter-secret rejected" } }));

    const result = await generateOpenRouterText("https://openrouter.ai/api/v1", "openrouter-secret", "openai/gpt-4.1-mini", "ping");

    expect(result).toMatchObject({ success: false, errorCategory });
    expect(result.message.toLowerCase()).toContain(expectedMessage);
    expect(result.message).not.toContain("openrouter-secret");
  });

  it("handles invalid responses and network failures without leaking credentials", async () => {
    requestUrlMock.mockResolvedValueOnce(response(200, { choices: [{ message: { content: "" } }] }));
    const invalid = await generateOpenRouterText("https://openrouter.ai/api/v1", "openrouter-secret", "openai/gpt-4.1-mini", "ping");
    expect(invalid).toMatchObject({ success: false, errorCategory: "invalid-response" });
    expect(invalid.message).toContain("formato inesperado");

    requestUrlMock.mockRejectedValueOnce(new Error("connection failed Authorization: Bearer openrouter-secret"));
    const network = await generateOpenRouterText("https://openrouter.ai/api/v1", "openrouter-secret", "openai/gpt-4.1-mini", "ping");
    expect(network).toMatchObject({ success: false, errorCategory: "connection" });
    expect(network.message).toContain("Não foi possível ligar");
    expect(network.message).not.toContain("openrouter-secret");
  });

  it("returns a normalized timeout without dispatching a second request", async () => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        callback();
        return 1;
      }),
      clearTimeout: vi.fn(),
    });
    requestUrlMock.mockImplementation(() => new Promise(() => undefined));

    const result = await generateOpenRouterText("https://openrouter.ai/api/v1", "openrouter-secret", "openai/gpt-4.1-mini", "ping", 10);

    expect(result).toMatchObject({ success: false, errorCategory: "timeout", message: expect.stringContaining("Tempo limite") });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("openrouter-secret");
  });
});
