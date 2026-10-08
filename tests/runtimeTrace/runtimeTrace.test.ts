import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeTraceService } from "../../src/runtimeTrace";

describe("RuntimeTraceService", () => {
  it("appends events in order and clears them", () => {
    const trace = new RuntimeTraceService();
    trace.append("semantic", "semantic-search:start");
    trace.append("runtime", "runtime-index:ready", "ok");
    expect(trace.list().map((event) => event.event)).toEqual(["semantic-search:start", "runtime-index:ready"]);
    trace.clear();
    expect(trace.list()).toEqual([]);
  });

  it("keeps a 300-event ring buffer", () => {
    const trace = new RuntimeTraceService();
    for (let index = 0; index < 305; index += 1) trace.append("test", `event-${index}`);
    expect(trace.list()).toHaveLength(300);
    expect(trace.list()[0]?.event).toBe("event-5");
  });

  it("sanitizes secrets and excludes query/content/embedding metadata", () => {
    const trace = new RuntimeTraceService();
    trace.append("semantic", "semantic-search:error", "error", { provider: "ollama", apiKey: "secret", query: "private", embeddingCount: 3 }, new Error("Bearer abc123 failed"));
    const exported = trace.exportText({ build: "TEST", role: "companion" });
    expect(exported).toContain("provider=ollama");
    expect(exported).not.toContain("secret");
    expect(exported).not.toContain("private");
    expect(exported).not.toContain("abc123");
  });

  it("does not persist automatically and keeps the TEST UI build-gated", () => {
    const source = readFileSync(resolve(process.cwd(), "src/runtimeTrace.ts"), "utf8");
    const build = readFileSync(resolve(process.cwd(), "esbuild.config.mjs"), "utf8");
    const panel = readFileSync(resolve(process.cwd(), "src/views/m6TestsPanelView.ts"), "utf8");
    expect(source).not.toMatch(/writeFile|localStorage|saveData|adapter\./);
    expect(build).toContain("runtimeTrace.dev.ts");
    expect(panel).toContain("Copiar log");
    expect(panel).toContain("Limpar trace");
  });
});
