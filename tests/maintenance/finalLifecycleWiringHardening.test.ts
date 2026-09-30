import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getStrings } from "../../src/i18n/strings";
import {
  adaptCurrentStateToLifecycleSnapshot,
} from "../../src/index/embeddingLifecycleAdapter";
import {
  deriveEmbeddingWritePathDecision,
} from "../../src/index/embeddingLifecycleWritePath";
import {
  buildSidebarStatusViewModel,
} from "../../src/search/sidebarStatusViewModel";
import {
  buildEmbeddingStatusViewModel,
} from "../../src/search/embeddingStatusViewModel";
import {
  evaluateEmbeddingUpdatePolicyFromSnapshot,
} from "../../src/maintenance/embeddingPolicyEngine";
import {
  evaluateOperationDecisionFromSnapshot,
} from "../../src/maintenance/embeddingWorker";

describe("Final Lifecycle Wiring Cleanup & Hardening (LINA-14F.4-B4.4)", () => {
  const strings = getStrings("pt-PT");

  describe("Architectural Invariants and Legacy Elimination", () => {
    it("should have zero references to EmbeddingWorkflowState in src and main.ts", () => {
      const srcDir = path.resolve(__dirname, "../../src");
      const mainFile = path.resolve(__dirname, "../../main.ts");

      function checkDir(dir: string) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            checkDir(fullPath);
          } else if (file.endsWith(".ts") || file.endsWith(".js")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            expect(content).not.toContain("EmbeddingWorkflowState");
            expect(content).not.toContain("resolveEmbeddingWorkflowState");
          }
        }
      }

      checkDir(srcDir);
      const mainContent = fs.readFileSync(mainFile, "utf-8");
      expect(mainContent).not.toContain("EmbeddingWorkflowState");
      expect(mainContent).not.toContain("resolveEmbeddingWorkflowState");
    });

    it("should have zero references to shadow comparators or legacy evaluators in src and main.ts", () => {
      const srcDir = path.resolve(__dirname, "../../src");
      const mainFile = path.resolve(__dirname, "../../main.ts");
      const forbiddenTerms = [
        "compareSchedulerDecision",
        "evaluateLegacySchedulerDecision",
        "getEmbeddingWritePathShadowComparison",
        "createEmbeddingWritePathShadowComparison",
      ];

      function checkDir(dir: string) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            checkDir(fullPath);
          } else if (file.endsWith(".ts") || file.endsWith(".js")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            for (const term of forbiddenTerms) {
              expect(content).not.toContain(term);
            }
          }
        }
      }

      checkDir(srcDir);
      const mainContent = fs.readFileSync(mainFile, "utf-8");
      for (const term of forbiddenTerms) {
        expect(mainContent).not.toContain(term);
      }
    });

    it("should ensure embeddingStatusViewModel derives UI actions directly from deriveEmbeddingWritePathDecision", () => {
      const vmFile = path.resolve(__dirname, "../../src/search/embeddingStatusViewModel.ts");
      const content = fs.readFileSync(vmFile, "utf-8");

      expect(content).toContain("deriveEmbeddingWritePathDecision(lifecycleSnapshot)");
      expect(content).toContain("mapDecisionToUiAction(decision)");
    });

    it("should ensure sidebarStatusViewModel derives hybrid mode and maintenance from canonical lifecycle snapshot", () => {
      const sidebarFile = path.resolve(__dirname, "../../src/search/sidebarStatusViewModel.ts");
      const content = fs.readFileSync(sidebarFile, "utf-8");

      expect(content).toContain("lifecycleSnapshot.read.effectiveMode");
      expect(content).toContain("lifecycleSnapshot.write.applicable");
    });
  });

  describe("End-to-End Canonical Chain Coherence", () => {
    it("should provide consistent decisions across Worker, Policy, and ViewModels for Incremental Update", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 10,
        deviceRuntimeState: {
          deviceId: "device-1",
          deviceName: "Primary",
          effectiveRole: "producer",
          assignmentState: "assigned",
          isConfigured: true,
          ownershipExists: true,
          isActiveProducer: true,
          isStandbyProducer: false,
          isCompanion: false,
          isUnassigned: false,
          canPublish: true,
          canTransferOwnership: false,
          transferEligibilityReason: "already-active-producer",
          embeddings: {
            configured: true,
            textIndexAvailable: true,
            embeddingsDeclared: true,
            exists: true,
            vectorFileState: "available",
            provenance: { stale: false },
            compatibility: { compatible: true },
            contractState: "compatible",
            readiness: { loaded: true, runtimeReady: true },
            runtimeState: "ready",
            semanticAvailable: true,
            effectiveMode: "full",
          },
        },
        publishedIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        vectorContract: {
          schemaVersion: 1,
          contractId: "contract-1",
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
          metric: "cosine",
        },
        workAssessment: {
          kind: "pending",
          mode: "incremental",
          updateRequired: true,
          severity: "action",
          cost: "local",
          reasons: ["missing-chunks"],
          counts: {
            totalChunks: 2,
            reusableCanonical: 1,
            recoverableCheckpoint: 0,
            toGenerate: 1,
            staleToReplace: 0,
            missing: 1,
            obsoleteToDrop: 0,
          },
        },
      });

      // 1. Write Path Decision
      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("update");
      expect(decision.workMode).toBe("incremental");
      expect(decision.canExecute).toBe(true);

      // 2. Policy Engine
      const policy = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
      expect(policy.allowed).toBe(true);
      expect(policy.requiresConfirmation).toBe(false);

      // 3. Worker Gate
      const workerDecision = evaluateOperationDecisionFromSnapshot(snapshot);
      expect(workerDecision.canStart).toBe(true);
      expect(workerDecision.action).toBe("update");

      // 4. Embedding Status ViewModel
      const embeddingVM = buildEmbeddingStatusViewModel({
        workState: {
          status: "ready",
          workAvailable: true,
          lifecycleSnapshot: snapshot,
          decision,
        },
        operationState: {
          status: "idle",
          operationId: null,
          origin: null,
          startedAt: null,
          finishedAt: null,
          message: null,
          error: null,
          phase: null,
          totalChunks: null,
          processedChunks: 0,
          generatedChunks: 0,
          failedChunks: 0,
          reusedChunks: 0,
          percentage: null,
          currentChunk: null,
          cancelRequestedAt: null,
        },
        configuredProvider: "ollama",
        configuredModel: "nomic-embed-text",
        indexReady: true,
        embeddingsReady: true,
        strings,
        lifecycleSnapshot: snapshot,
      });

      const updateAction = embeddingVM.actions.find((a) => a.kind === "update");
      expect(updateAction).toBeDefined();
      expect(updateAction?.disabled).toBe(false);

      // 5. Sidebar Status ViewModel
      const sidebarVM = buildSidebarStatusViewModel({
        deviceId: "dev-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        textIndexReady: true,
        embeddingsEnabled: true,
        embeddingsReady: true,
        semanticAvailable: true,
        lifecycleSnapshot: snapshot,
        strings,
      });

      expect(sidebarVM.freshness.embeddings.status).toBe("stale");
      expect(sidebarVM.maintenance.canExecuteMaintenance).toBe(true);
      expect(sidebarVM.searchAvailability.hybridMode).toBe("full");
    });

    it("should provide consistent decisions across Worker, Policy, and ViewModels for Incompatible/Full-Rebuild", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 10,
        deviceRuntimeState: {
          deviceId: "device-1",
          deviceName: "Primary",
          effectiveRole: "producer",
          assignmentState: "assigned",
          isConfigured: true,
          ownershipExists: true,
          isActiveProducer: true,
          isStandbyProducer: false,
          isCompanion: false,
          isUnassigned: false,
          canPublish: true,
          canTransferOwnership: false,
          transferEligibilityReason: "already-active-producer",
          embeddings: {
            configured: true,
            textIndexAvailable: true,
            embeddingsDeclared: true,
            exists: true,
            vectorFileState: "available",
            provenance: { stale: false },
            compatibility: { compatible: false },
            contractState: "mismatch",
            readiness: { loaded: true, runtimeReady: true },
            runtimeState: "ready",
            semanticAvailable: false,
            effectiveMode: "text-only",
          },
        },
        publishedIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        targetIdentity: {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          inputVersion: 1,
          prefixMode: "none",
        },
        vectorContract: undefined,
        workAssessment: {
          kind: "pending",
          mode: "full-rebuild",
          updateRequired: true,
          severity: "action",
          cost: "external",
          reasons: ["model-mismatch"],
          counts: {
            totalChunks: 10,
            reusableCanonical: 0,
            recoverableCheckpoint: 0,
            toGenerate: 10,
            staleToReplace: 0,
            missing: 10,
            obsoleteToDrop: 0,
          },
        },
      });

      // 1. Write Path Decision
      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("rebuild");
      expect(decision.workMode).toBe("full-rebuild");
      expect(decision.canExecute).toBe(true);

      // 2. Policy Engine
      const policy = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
      expect(policy.requiresConfirmation).toBe(true);

      // 3. Worker Gate
      const workerDecision = evaluateOperationDecisionFromSnapshot(snapshot);
      expect(workerDecision.canStart).toBe(true);
      expect(workerDecision.action).toBe("rebuild");

      // 4. Embedding Status ViewModel
      const embeddingVM = buildEmbeddingStatusViewModel({
        workState: {
          status: "ready",
          workAvailable: true,
          lifecycleSnapshot: snapshot,
          decision,
        },
        operationState: {
          status: "idle",
          operationId: null,
          origin: null,
          startedAt: null,
          finishedAt: null,
          message: null,
          error: null,
          phase: null,
          totalChunks: null,
          processedChunks: 0,
          generatedChunks: 0,
          failedChunks: 0,
          reusedChunks: 0,
          percentage: null,
          currentChunk: null,
          cancelRequestedAt: null,
        },
        configuredProvider: "openai",
        configuredModel: "text-embedding-3-small",
        indexReady: true,
        embeddingsReady: true,
        strings,
        lifecycleSnapshot: snapshot,
      });

      const rebuildAction = embeddingVM.actions.find((a) => a.kind === "rebuild");
      expect(rebuildAction).toBeDefined();
      expect(rebuildAction?.disabled).toBe(false);
      expect(rebuildAction?.requiresFullRebuildConfirmation).toBe(true);
      expect(embeddingVM.headline).toBe(strings.diagnosticEmbeddingFullRebuildRequired);

      // 5. Sidebar Status ViewModel
      const sidebarVM = buildSidebarStatusViewModel({
        deviceId: "dev-1",
        deviceRole: "producer",
        isAuthorizedProducer: true,
        textIndexReady: true,
        embeddingsEnabled: true,
        embeddingsReady: true,
        semanticAvailable: false,
        lifecycleSnapshot: snapshot,
        strings,
      });

      expect(sidebarVM.degradedAlert?.kind).toBe("vector-mismatch");
      expect(sidebarVM.searchAvailability.hybridMode).toBe("text-only");
      expect(sidebarVM.maintenance.canExecuteMaintenance).toBe(true);
    });

    it("should correctly block execution for Companion device across all layers", () => {
      const snapshot = adaptCurrentStateToLifecycleSnapshot({
        upstreamTextIndex: "ready",
        canonicalExists: true,
        validForSearchCount: 10,
        deviceRuntimeState: {
          deviceId: "device-companion-1",
          deviceName: "Companion",
          effectiveRole: "companion",
          assignmentState: "assigned",
          isConfigured: true,
          ownershipExists: true,
          isActiveProducer: false,
          isStandbyProducer: false,
          isCompanion: true,
          isUnassigned: false,
          canPublish: false,
          canTransferOwnership: false,
          transferEligibilityReason: "ready",
          embeddings: {
            configured: true,
            textIndexAvailable: true,
            embeddingsDeclared: true,
            exists: true,
            vectorFileState: "available",
            provenance: { stale: false },
            compatibility: { compatible: true },
            contractState: "compatible",
            readiness: { loaded: true, runtimeReady: true },
            runtimeState: "ready",
            semanticAvailable: true,
            effectiveMode: "full",
          },
        },
        publishedIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        targetIdentity: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          inputVersion: 1,
          prefixMode: "none",
        },
        companionState: {
          deviceId: "device-companion-1",
          evaluatedAt: new Date().toISOString(),
          canConsume: true,
          generationIntegrity: "ok",
          artifactAvailability: {
            textIndex: "available",
            embeddings: "available",
          },
        } as any,
      });

      // 1. Write Path Decision
      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.action).toBe("none");
      expect(decision.canExecute).toBe(false);
      expect(decision.applicable).toBe(false);
      expect(decision.blockedReason).toBe("companion");

      // 2. Policy Engine
      const policy = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
      expect(policy.allowed).toBe(false);
      expect(policy.reason).toBe("companion-device-not-allowed");

      // 3. Worker Gate
      const workerDecision = evaluateOperationDecisionFromSnapshot(snapshot);
      expect(workerDecision.canStart).toBe(false);
      expect(workerDecision.action).toBe("none");

      // 4. Sidebar Status ViewModel
      const sidebarVM = buildSidebarStatusViewModel({
        deviceId: "device-companion-1",
        deviceRole: "companion",
        textIndexReady: true,
        embeddingsEnabled: true,
        embeddingsReady: true,
        semanticAvailable: true,
        lifecycleSnapshot: snapshot,
        strings,
      });

      expect(sidebarVM.role.roleKey).toBe("companion");
      expect(sidebarVM.maintenance.canExecuteMaintenance).toBe(false);
      expect(sidebarVM.maintenance.gatingNotice).toBe(strings.sidebarMaintenanceManagedByActiveProducer);
    });
  });
});
