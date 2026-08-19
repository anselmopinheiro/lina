import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { generateProviderEmbeddings } from "../../src/ai/embeddingProvider";
import { generateOpenRouterEmbeddings } from "../../src/ai/openRouterProvider";

function response(status: number, json: unknown): unknown {
  return { status, json };
}

function requestOptions(call: unknown[]): { url: string; headers: Record<string, string>; body: string } {
  return call[0] as { url: string; headers: Record<string, string>; body: string };
}

describe("OpenRouter embedding provider", () => {
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

  it("sends a single embedding request with the selected model and bearer credential", async () => {
    requestUrlMock.mockResolvedValue(response(200, { data: [{ index: 0, embedding: [1, 2, 3] }] }));

    const result = await generateOpenRouterEmbeddings(
      "https://openrouter.ai/api/v1", "or-secret", "openai/text-embedding-3-small", ["one"],
    );

    expect(result).toMatchObject({ success: true, embeddings: [[1, 2, 3]], provider: "openrouter" });
    const request = requestOptions(requestUrlMock.mock.calls[0]);
    expect(request.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(request.headers.Authorization).toBe("Bearer or-secret");
    expect(JSON.parse(request.body)).toEqual({ model: "openai/text-embedding-3-small", input: ["one"] });
  });

  it("restores batch input ordering from response indices", async () => {
    requestUrlMock.mockResolvedValue(response(200, {
      data: [{ index: 1, embedding: [4, 5, 6] }, { index: 0, embedding: [1, 2, 3] }],
    }));

    const result = await generateOpenRouterEmbeddings("https://openrouter.ai/api/v1", "or-secret", "openai/text-embedding-3-small", ["first", "second"]);

    expect(result).toMatchObject({ success: true, embeddings: [[1, 2, 3], [4, 5, 6]], dimension: 3, requestCount: 1 });
  });

  it.each([
    [{ data: [{ index: 0, embedding: [1, 2, 3] }] }, "invalid-response"],
    [{ data: [{ index: 0, embedding: [1, 2, 3] }, { index: 0, embedding: [4, 5, 6] }] }, "invalid-response"],
    [{ data: [{ index: 0, embedding: [1, Number.NaN, 3] }, { index: 1, embedding: [4, 5, 6] }] }, "invalid-vector"],
    [{ data: [{ index: 0, embedding: [1, 2, 3] }, { index: 1, embedding: [4, 5] }] }, "dimension-mismatch"],
  ])("rejects malformed OpenRouter responses", async (json, category) => {
    requestUrlMock.mockResolvedValue(response(200, json));

    const result = await generateOpenRouterEmbeddings("https://openrouter.ai/api/v1", "or-secret", "openai/text-embedding-3-small", ["one", "two"]);

    expect(result).toMatchObject({ success: false, errorCategory: category, errorScope: "operation" });
  });

  it.each([
    [401, "authentication"], [402, "billing"], [404, "model-not-found"], [429, "rate-limit"], [529, "connection"],
  ])("normalizes OpenRouter HTTP %s safely", async (status, category) => {
    requestUrlMock.mockResolvedValue(response(status, { error: { message: "Bearer or-secret rejected" } }));

    const result = await generateOpenRouterEmbeddings("https://openrouter.ai/api/v1", "or-secret", "openai/text-embedding-3-small", ["one"]);

    expect(result).toMatchObject({ success: false, status, errorCategory: category, provider: "openrouter" });
    expect(result.apiMessage).not.toContain("or-secret");
  });

  it("normalizes network failures without exposing the credential", async () => {
    requestUrlMock.mockRejectedValue(new Error("network failed Authorization: Bearer or-secret"));

    const result = await generateOpenRouterEmbeddings("https://openrouter.ai/api/v1", "or-secret", "openai/text-embedding-3-small", ["one"]);

    expect(result).toMatchObject({ success: false, errorCategory: "connection", provider: "openrouter" });
    expect(result.apiMessage).toContain("Bearer [redacted]");
    expect(result.apiMessage).not.toContain("or-secret");
  });

  it("dispatches OpenRouter through the shared provider entrypoint", async () => {
    requestUrlMock.mockResolvedValue(response(200, { data: [{ index: 0, embedding: [1, 2, 3] }] }));

    const result = await generateProviderEmbeddings({
      provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-secret",
      model: "openai/text-embedding-3-small", inputs: ["one"], timeoutMs: 60_000,
    });

    expect(result).toMatchObject({ success: true, provider: "openrouter", embeddings: [[1, 2, 3]] });
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(requestOptions(requestUrlMock.mock.calls[0]!).body)).toMatchObject({
      model: "openai/text-embedding-3-small",
    });
  });
});
