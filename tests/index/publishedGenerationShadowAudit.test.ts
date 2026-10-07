import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RuntimeEmbeddingIndex } from "../../src/search/runtimeEmbeddingIndex";
import { PublishedGenerationShadowAuditor, type PublishedShadowReader } from "../../src/index/publishedGenerationShadowAudit";
import type { PublishedGenerationReadResult } from "../../src/index/publishedGenerationReader";
import { DEFAULT_SETTINGS, getLocalPublishedGenerationShadowEnabled, setDeviceSettingsContext, setLocalPublishedGenerationShadowEnabled } from "../../src/settings";

function legacy(value = 1, publicationId = "legacy-1"): RuntimeEmbeddingIndex {
  return {
    dimensions: 2, count: 1, vectors: new Float32Array([value, 2]), provider: "ollama", model: "model",
    records: [{ chunkId: "chunk", path: "note.md", index: 0, textHash: "text" }],
    sourceIdentity: { provider: "ollama", model: "model", dimensions: 2, inputVersion: 1, prefixMode: "none", updatedAt: "t", canonicalMtime: 1, canonicalSize: 1, publicationId },
  };
}
function ok(value = 1, generationId = "generation-000001"): PublishedGenerationReadResult {
  return { status: "OK", generationId, providerCalls: 0, index: { generationId, vectorContractId: "contract", dimensions: 2, count: 1, vectors: new Float32Array([value, 2]), provider: "ollama", model: "model", records: [{ chunkId: "chunk", path: "note.md", index: 0, textHash: "text" }] } };
}
class Pointer { current = "generation-000001"; async exists(): Promise<boolean> { return true; } async read(): Promise<string> { return this.current; } }
class Reader implements PublishedShadowReader { calls = 0; constructor(private result: PublishedGenerationReadResult) {} async read(): Promise<PublishedGenerationReadResult> { this.calls++; return this.result; } set(result: PublishedGenerationReadResult): void { this.result = result; } }
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

describe("M5C published generation shadow audit", () => {
  it("keeps the device-scoped shadow flag disabled by default", () => {
    const settings = { ...DEFAULT_SETTINGS, deviceSettingsById: {} };
    setDeviceSettingsContext(settings, () => {}, "m5c-test-device");
    expect(getLocalPublishedGenerationShadowEnabled()).toBe(false);
    setLocalPublishedGenerationShadowEnabled(true); expect(getLocalPublishedGenerationShadowEnabled()).toBe(true);
  });

  it("reports PASS without changing the legacy object or calling a provider", async () => {
    const pointer = new Pointer(); const source = legacy(); const reader = new Reader(ok()); const auditor = new PublishedGenerationShadowAuditor({ reader, pointer, level: () => "L2" });
    await auditor.schedule(source); await flush();
    expect(auditor.getDiagnostic()).toMatchObject({ status: "PASS", level: "L2", providerCalls: 0 });
    expect(source.vectors).toEqual(new Float32Array([1, 2])); expect(reader.calls).toBe(1);
    expect("write" in pointer || "remove" in pointer || "rename" in pointer).toBe(false);
  });

  it("reports divergence and reader failures without altering legacy", async () => {
    const pointer = new Pointer(); const reader = new Reader(ok(9)); const source = legacy(); const auditor = new PublishedGenerationShadowAuditor({ reader, pointer, level: () => "L2", maxDivergences: 1 });
    await expect(auditor.runNow(source)).resolves.toMatchObject({ status: "DIVERGED", divergences: [{ class: "VECTOR_MISMATCH" }] });
    reader.set({ status: "TARGET_PARTIAL", generationId: "generation-000002", providerCalls: 0 }); pointer.current = "generation-000002";
    await expect(auditor.runNow(source)).resolves.toMatchObject({ status: "READER_ERROR", readerStatus: "TARGET_PARTIAL", providerCalls: 0 });
    expect(source.vectors).toEqual(new Float32Array([1, 2]));
  });

  it("deduplicates the same legacy identity/current generation and reruns on either change", async () => {
    const pointer = new Pointer(); const reader = new Reader(ok()); const auditor = new PublishedGenerationShadowAuditor({ reader, pointer, level: () => "L2" }); const source = legacy();
    await auditor.schedule(source); await flush(); await auditor.schedule(source); await flush(); expect(reader.calls).toBe(1);
    pointer.current = "generation-000002"; reader.set(ok(1, "generation-000002")); await auditor.schedule(source); await flush(); expect(reader.calls).toBe(2);
    await auditor.schedule(legacy(1, "legacy-2")); await flush(); expect(reader.calls).toBe(3);
  });

  it("uses single-flight and chooses L1 for mobile callers", async () => {
    const pointer = new Pointer(); let release: ((result: PublishedGenerationReadResult) => void) | undefined;
    const reader: PublishedShadowReader & { calls: number } = { calls: 0, read: () => new Promise((resolve) => { reader.calls++; release = resolve; }) };
    const auditor = new PublishedGenerationShadowAuditor({ reader, pointer, level: () => "L1" }); const source = legacy();
    await Promise.all([auditor.schedule(source), auditor.schedule(source)]); expect(reader.calls).toBe(1);
    release?.(ok()); await flush(); expect(auditor.getDiagnostic()).toMatchObject({ status: "PASS", level: "L1" });
  });

  it("maps downgrade and CURRENT changes to observable reader errors", async () => {
    const pointer = new Pointer(); const reader = new Reader({ status: "DOWNGRADE_REJECTED", generationId: "generation-000001", providerCalls: 0 }); const auditor = new PublishedGenerationShadowAuditor({ reader, pointer, level: () => "L2" });
    await expect(auditor.runNow(legacy())).resolves.toMatchObject({ status: "READER_ERROR", readerStatus: "DOWNGRADE_REJECTED" });
    reader.set({ status: "CURRENT_CHANGED", generationId: "generation-000002", providerCalls: 0 }); pointer.current = "generation-000002";
    await expect(auditor.runNow(legacy())).resolves.toMatchObject({ status: "READER_ERROR", readerStatus: "CURRENT_CHANGED" });
  });

  it("keeps the shadow orchestrator free of node, SQLite, providers and pointer recovery", () => {
    const source = readFileSync("src/index/publishedGenerationShadowAudit.ts", "utf8");
    expect(source).not.toMatch(/node:|sqlite|provider\/|ai\/|publishedGenerationWriter|recoverPublishedGenerationPointer/);
  });
});
