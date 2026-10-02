import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LINA-15D-B guard: runtime code must not fabricate identities or states
 * (unknown dimensions, provider/model placeholders, implicit producer, fixed "ready" text index).
 */
const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: "fabricated 768 dimensions", pattern: /\b768\b/ },
  { name: "fabricated 1536 dimensions", pattern: /\b1536\b/ },
  { name: "\"default\" provider/model placeholder", pattern: /(provider|model)[^\n]*\?\?\s*"default"/ },
  { name: "implicit local device id", pattern: /"local-device"/ },
  { name: "hard-coded inputVersion: 1 identity", pattern: /inputVersion:\s*1\b(?!\s*[|;)])/ },
  { name: "hard-coded prefixMode: \"none\" identity", pattern: /prefixMode:\s*"none"(?!\s*\|)/ },
  { name: "fixed upstreamTextIndex: \"ready\"", pattern: /upstreamTextIndex:\s*"ready"(?!\s*\|)/ },
];

/**
 * Documented exceptions: "unavailable" placeholders required by the type of an unavailable
 * `EffectiveEmbeddingRuntimeConfig` (no contract), forwarded to a later phase (LINA-15D-B report, R1).
 */
const ALLOWED_FILES = new Set(["src/index/vectorContract.ts"]);

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "i18n") continue;
      listSources(full, out);
    } else if (entry.endsWith(".ts")) {
      out.push(full.split("\\").join("/"));
    }
  }
  return out;
}

describe("no fabricated snapshot values in runtime code (LINA-15D-B)", () => {
  const files = [...listSources("src"), "main.ts"].filter((file) => !ALLOWED_FILES.has(file));

  for (const { name, pattern } of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          if (!line.trim().startsWith("//") && !line.trim().startsWith("*") && pattern.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the production snapshot sources no longer synthesise a default Producer runtime", () => {
    const controller = readFileSync("src/index/embeddingWorkStatusController.ts", "utf8");
    expect(controller).not.toContain("defaultProducerRuntime");
    expect(controller).not.toMatch(/effectiveRole:\s*"producer",\s*\n\s*isActiveProducer:\s*true/);
  });
});
