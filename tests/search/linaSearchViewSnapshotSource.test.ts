import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveEmbeddingLifecycle, type EmbeddingLifecycleSnapshot } from "../../src/index/embeddingLifecycleModel";
import { buildSidebarStatusViewModel } from "../../src/search/sidebarStatusViewModel";
import { getStrings } from "../../src/i18n/strings";

function createMockSnapshot(
  overrides: Partial<Parameters<typeof resolveEmbeddingLifecycle>[0]> = {}
): EmbeddingLifecycleSnapshot {
  const defaultIdentity = {
    provider: "ollama",
    model: "nomic-embed-text",
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "none" as const,
    contractId: "ollama:nomic-embed-text:768:1:none",
  };

  return resolveEmbeddingLifecycle({
    revision: 1,
    computedAt: new Date().toISOString(),
    deviceRole: "producer",
    isActiveProducer: true,
    embeddingsEnabled: true,
    upstreamTextIndex: "ready",
    canonicalExists: true,
    validForSearchCount: 100,
    activeSource: "canonical",
    publishedIdentity: defaultIdentity,
    deviceIdentity: defaultIdentity,
    workAssessment: {
      kind: "none",
      updateRequired: false,
      severity: "none",
      cost: "none",
      reasons: ["up-to-date"],
    },
    ...overrides,
  });
}

describe("LinaSearchView Snapshot Source Consolidation (LINA-14F.4-B4.2)", () => {
  const viewSource = () => readFileSync(resolve(process.cwd(), "src/search/linaSearchView.ts"), "utf8");

  it("enforces structural invariant: LinaSearchView obtains canonical snapshot from plugin and has no local adapter construction", () => {
    const text = viewSource();
    expect(text).toContain("const lifecycleSnapshot = this.plugin.getEmbeddingLifecycleSnapshot();");
    expect(text).not.toContain("adaptCurrentStateToLifecycleSnapshot");
    expect(text).not.toContain("import { adaptCurrentStateToLifecycleSnapshot }");
  });

  describe("Canonical Snapshot ViewModel Rendering Scenarios", () => {
    const strings = getStrings("pt");

    it("Scenario 1 (READY): produces up-to-date status and valid search headline", () => {
      const snapshot = createMockSnapshot({
        workAssessment: {
          kind: "none",
          updateRequired: false,
          severity: "none",
          cost: "none",
          reasons: ["up-to-date"],
        },
      });

      expect(snapshot.primary).toBe("READY");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: true,
      });

      expect(vm.role.roleKey).toBe("active-producer");
      expect(vm.searchAvailability.semanticAvailable).toBe(true);
      expect(vm.freshness.embeddings.status).toBe("fresh");
    });

    it("Scenario 2 (UPDATE_AVAILABLE): reflects pending updates while preserving search availability", () => {
      const snapshot = createMockSnapshot({
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "low",
          cost: "local",
          reasons: ["notes-modified"],
          counts: { totalChunks: 120, toGenerate: 20, missing: 20, reusableCanonical: 100 },
        },
      });

      expect(snapshot.primary).toBe("UPDATE_AVAILABLE");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: true,
      });

      expect(vm.freshness.embeddings.humanText).toContain("Atualização necessária");
      expect(vm.searchAvailability.semanticAvailable).toBe(true);
    });

    it("Scenario 3 (INDEX_ONLY): indicates missing embeddings index while text index is ready", () => {
      const snapshot = createMockSnapshot({
        canonicalExists: false,
        validForSearchCount: 0,
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "blocking",
          cost: "local",
          reasons: ["no-published-index"],
          counts: { totalChunks: 50, toGenerate: 50, missing: 50 },
        },
      });

      expect(snapshot.primary).toBe("INDEX_ONLY");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: false,
      });

      expect(vm.searchAvailability.semanticAvailable).toBe(false);
      expect(vm.searchAvailability.hybridMode).toBe("text-only");
    });

    it("Scenario 4 (INCOMPATIBLE): produces degraded alert for vector / model mismatch", () => {
      const snapshot = createMockSnapshot({
        publishedIdentity: { provider: "ollama", model: "nomic-embed-text", dimensions: 768, inputVersion: 1, prefixMode: "none" },
        deviceIdentity: { provider: "ollama", model: "bge-m3", dimensions: 1024, inputVersion: 1, prefixMode: "none" },
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "blocking",
          cost: "local",
          reasons: ["model-mismatch"],
        },
      });

      expect(snapshot.primary).toBe("INCOMPATIBLE");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: false,
      });

      expect(vm.searchAvailability.semanticAvailable).toBe(false);
      expect(vm.degradedAlert).toBeDefined();
    });

    it("Scenario 5 (ERROR): signals error in freshness and search availability", () => {
      const snapshot = createMockSnapshot({
        validForSearchCount: 0,
        operationState: {
          status: "failed",
          error: "connection-refused",
          processedChunks: 5,
          totalChunks: 50,
        },
        workAssessment: {
          kind: "pending",
          updateRequired: true,
          severity: "medium",
          cost: "local",
          reasons: ["retry-pending"],
        },
      });

      expect(snapshot.primary).toBe("ERROR");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: false,
      });

      expect(vm.searchAvailability.hybridMode).toBe("text-only");
      expect(vm.searchAvailability.semanticAvailable).toBe(false);
    });

    it("Scenario 6 (Companion): presents companion badge and blocks write maintenance", () => {
      const snapshot = createMockSnapshot({
        deviceRole: "companion",
        isActiveProducer: false,
      });

      expect(snapshot.capability.blockedReason).toBe("companion");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "companion",
        isAuthorizedProducer: false,
        isStandbyProducer: false,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: true,
      });

      expect(vm.role.roleKey).toBe("companion");
      expect(vm.maintenance.canExecuteMaintenance).toBe(false);
      expect(vm.maintenance.isCompanion).toBe(true);
    });

    it("Scenario 7 (Standby): presents standby badge and blocks write maintenance", () => {
      const snapshot = createMockSnapshot({
        deviceRole: "producer",
        isActiveProducer: false,
      });

      expect(snapshot.capability.blockedReason).toBe("standby");
      const vm = buildSidebarStatusViewModel({
        deviceId: "device-1",
        deviceRole: "producer",
        isAuthorizedProducer: false,
        isStandbyProducer: true,
        lifecycleSnapshot: snapshot,
        strings,
        textIndexReady: true,
        semanticAvailable: true,
      });

      expect(vm.role.roleKey).toBe("standby-producer");
      expect(vm.maintenance.canExecuteMaintenance).toBe(false);
      expect(vm.maintenance.isStandby).toBe(true);
    });
  });
});
