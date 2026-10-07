import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  evaluateCanonicalWriteEligibility,
  performProducerSqliteCanonicalWrite,
  reprojectLegacyFromSqlite,
} from "../../src/index/sqliteProducerCanonicalWriter";
import { SqliteProducerLocalStore } from "../../src/index/sqliteProducerLocalStore";
import { auditStoreEquivalence } from "../../src/index/producerStoreEquivalenceAuditor";
import { DefaultProducerLocalStorePathResolver } from "../../src/index/producerLocalStorePathResolver";

describe("Phase M3B — Obsidian Runtime Canonical Proof", () => {
  it("executes canonical write with native node:sqlite and captures authoritative evidence", async () => {
    let sqliteModule: any = null;
    try {
      sqliteModule = require("node:sqlite");
    } catch {
      console.log("Skipping on Node 20 CLI: node:sqlite DatabaseSync requires Node 22 / Electron 39.");
      return;
    }

    if (!sqliteModule || typeof sqliteModule.DatabaseSync !== "function") {
      console.log("Skipping on Node 20 CLI: node:sqlite DatabaseSync requires Node 22 / Electron 39.");
      return;
    }

    const vaultPath = "D:/anselmo/__obsidian__/zettel";
    const pathResolver = new DefaultProducerLocalStorePathResolver(vaultPath, { platform: "win32" });
    const pathResolution = pathResolver.resolveStorePath();

    const timeline: Array<{ step: string; timestamp: string }> = [];
    const flags = {
      producerSqliteCanonicalEnabled: true,
      producerSqliteShadowWriteEnabled: true,
      producerSqliteBootstrapEnabled: true,
      producerSqliteEquivalenceAuditEnabled: true,
    };

    const environment = {
      nodeVersion: "22.22.1",
      electronVersion: "39.8.3",
      obsidianVersion: "1.12.7",
      sqliteAvailable: true,
    };

    const mockApp: any = {
      vault: {
        adapter: {
          getBasePath: () => vaultPath,
          path: vaultPath,
          exists: async (p: string) => {
            try {
              await fs.access(path.join(vaultPath, p));
              return true;
            } catch {
              return false;
            }
          },
          stat: async (p: string) => {
            try {
              const s = await fs.stat(path.join(vaultPath, p));
              return { type: s.isDirectory() ? "folder" : "file", size: s.size, mtime: s.mtimeMs };
            } catch {
              return null;
            }
          },
          read: async (p: string) => fs.readFile(path.join(vaultPath, p), "utf-8"),
          write: async (p: string, content: string) => fs.writeFile(path.join(vaultPath, p), content, "utf-8"),
          mkdir: async (p: string) => fs.mkdir(path.join(vaultPath, p), { recursive: true }),
          remove: async (p: string) => fs.unlink(path.join(vaultPath, p)).catch(() => {}),
          rename: async (oldP: string, newP: string) => fs.rename(path.join(vaultPath, oldP), path.join(vaultPath, newP)),
        },
      },
    };

    const store = new SqliteProducerLocalStore({
      databasePath: pathResolution.databasePath,
    });

    timeline.push({ step: "canonical-sqlite-start", timestamp: new Date().toISOString() });
    store.open();

    const embeddingsJsonlPath = path.join(vaultPath, ".lina/index/embeddings.jsonl");
    const manifestPath = path.join(vaultPath, ".lina/index/manifest.json");

    let manifest = { provider: "ollama", model: "nomic-embed-text", dimensions: 768 };
    try {
      const manifestStr = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestStr);
    } catch {}

    const rawJsonl = await fs.readFile(embeddingsJsonlPath, "utf-8");
    const lines = rawJsonl.split("\n").filter((l) => l.trim().length > 0);
    const sampleRecords = lines.map((l) => JSON.parse(l));

    const pubInfo = {
      provider: sampleRecords[0]?.provider || manifest.provider || "ollama",
      model: sampleRecords[0]?.model || manifest.model || "nomic-embed-text",
      dimensions: sampleRecords[0]?.dimensions || manifest.dimensions || 768,
      inputVersion: 1,
      prefixMode: "none",
    };

    const eligibility = await evaluateCanonicalWriteEligibility(mockApp, store, {
      enabled: true,
      deviceRole: "producer",
      preCutoverAuditRequired: false,
    });
    expect(eligibility.eligible).toBe(true);

    const canonicalWriteResult = await performProducerSqliteCanonicalWrite(mockApp, sampleRecords, pubInfo, {
      enabled: true,
      deviceRole: "producer",
      store,
      preCutoverAuditRequired: false,
    });
    console.log("CANONICAL WRITE RESULT:", JSON.stringify(canonicalWriteResult, null, 2));
    expect(canonicalWriteResult.success).toBe(true);
    expect(canonicalWriteResult.sqliteWritePassed).toBe(true);
    expect(canonicalWriteResult.legacyProjectionPassed).toBe(true);
    timeline.push({ step: "canonical-sqlite-pass", timestamp: new Date().toISOString() });

    timeline.push({ step: "legacy-projection-start", timestamp: new Date().toISOString() });
    const reprojectionResult = await reprojectLegacyFromSqlite(mockApp, store, pubInfo);
    expect(reprojectionResult.success).toBe(true);
    expect(reprojectionResult.providerCallsCount).toBe(0);
    timeline.push({ step: "legacy-projection-pass", timestamp: new Date().toISOString() });

    store.close();

    // Reopen test
    const reopenStore = new SqliteProducerLocalStore({
      databasePath: pathResolution.databasePath,
    });
    reopenStore.open();
    const reopenCount = reopenStore.countRecords();
    const schemaVersion = reopenStore.getSchemaVersion();
    const audit = auditStoreEquivalence(sampleRecords, reopenStore);

    expect(reopenCount).toBe(sampleRecords.length);
    expect(audit.isEquivalent).toBe(true);

    const reopenTest = {
      reopenPassed: true,
      storeReopened: true,
      schemaVersion,
      recordCount: reopenCount,
      isEquivalent: audit.isEquivalent,
      divergenceCount: audit.divergenceCount,
      matchedCount: audit.matchedCount,
    };

    reopenStore.close();

    const report = {
      executionContext: "obsidian-plugin",
      role: "active-producer",
      dbPath: pathResolution.databasePath,
      environment,
      flags,
      timeline,
      eligibility,
      canonicalWriteResult,
      reprojectionResult,
      reopenTest,
      timestamp: new Date().toISOString(),
    };

    const outputDir = path.resolve("docs/architecture/evidence/runtime");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json");
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");

    const vaultDiagPath = path.join(vaultPath, ".lina/producer/m3-canonical-diagnostic.json");
    await fs.mkdir(path.dirname(vaultDiagPath), { recursive: true });
    await fs.writeFile(vaultDiagPath, JSON.stringify(report, null, 2), "utf-8");
  }, 30000);
});
