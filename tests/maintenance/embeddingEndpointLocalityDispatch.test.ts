import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEndpointProviderCapability } from "../../src/ai/providerCapabilities";
import { getStrings } from "../../src/i18n/strings";
import {
  type EmbeddingWorkSummary,
  buildEmbeddingWorkLifecycleSnapshot,
} from "../../src/index/embeddingWorkStatusController";
import {
  deriveEmbeddingWritePathDecision,
  evaluateOperationStartGate,
} from "../../src/index/embeddingLifecycleWritePath";
import { evaluateSchedulerDecisionFromSnapshot } from "../../src/maintenance/embeddingScheduler";
import { evaluateEmbeddingUpdatePolicyFromSnapshot } from "../../src/maintenance/embeddingPolicyEngine";
import { prepareEmbeddingUpdateConfirmation } from "../../src/maintenance/embeddingUpdateConfirmation";
import {
  EMBEDDING_GENERATION_INCREMENTAL,
  isLegacyFullRegenerationPreferenceSet,
} from "../../src/maintenance/embeddingUpdateSettings";
import type { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";

/**
 * LINA-15F (CR-01 / F-11): `automatic-local-only` means "does not leave this device", never
 * "a provider called Ollama". The effective endpoint feeds the canonical snapshot (`cost`), and
 * every operational barrier keeps deciding from that snapshot.
 */

const MODEL = "nomic-embed-text-v2-moe";

function pendingSummary(overrides: Partial<EmbeddingWorkSummary> = {}): EmbeddingWorkSummary {
  const targetIdentity = {
    provider: "ollama",
    model: MODEL,
    dimensions: 768,
    inputVersion: 1,
    prefixMode: "nomic-search-query-document" as const,
  };
  return {
    exists: true,
    provider: "ollama",
    model: MODEL,
    dimensions: 768,
    manifestPrefixMode: "nomic-search-query-document",
    canonicalReadability: "readable",
    totalChunks: 10,
    updatePlan: {
      mode: "incremental",
      targetIdentity,
      totalChunks: 10,
      reusableCanonicalCount: 8,
      recoverableCheckpointCount: 0,
      toGenerateCount: 2,
      staleToReplaceCount: 2,
      missingCount: 0,
      obsoleteToDropCount: 0,
      requiresPublication: false,
      reasons: ["stale-chunks"],
    },
    ...overrides,
  };
}

function runtime(role: "producer" | "companion", active: boolean): DeviceRuntimeState {
  return {
    deviceId: "dev",
    effectiveRole: role,
    isActiveProducer: active,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: role === "producer" && !active,
    isCompanion: role === "companion",
    isUnassigned: false,
    canPublish: active,
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
  } as DeviceRuntimeState;
}

function snapshotFor(baseUrl: string, role: "producer" | "companion" = "producer", active = true) {
  const capability = resolveEndpointProviderCapability("ollama", baseUrl);
  const summary = pendingSummary({ targetEndpointIsExternal: !capability.isLocal });
  return buildEmbeddingWorkLifecycleSnapshot(summary, 1, runtime(role, active));
}

describe("LINA-15F — automatic-local-only follows the effective endpoint", () => {
  it("Ollama on loopback: local cost, auto-dispatch approved, automatic start allowed", () => {
    const snapshot = snapshotFor("http://localhost:11434");
    const decision = deriveEmbeddingWritePathDecision(snapshot);
    expect(decision.cost).toBe("local");
    expect(decision.action).toBe("update");

    const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
    expect(scheduler.canDispatch).toBe(true);
    expect(evaluateOperationStartGate(decision, "automatic")).toEqual({ allowed: true });
  });

  it.each(["http://192.168.1.20:11434", "https://ollama.example.com", "http://meupc.local:11434", "http://not-a-url"])(
    "Ollama on %s: external cost, no auto-dispatch, automatic start refused, manual still needs confirmation",
    (baseUrl) => {
      const snapshot = snapshotFor(baseUrl);
      const decision = deriveEmbeddingWritePathDecision(snapshot);
      expect(decision.cost).toBe("external");
      expect(decision.requiresConfirmation).toBe(true);

      const scheduler = evaluateSchedulerDecisionFromSnapshot(snapshot, "automatic-local-only");
      expect(scheduler.canDispatch).toBe(false);
      expect(scheduler.reason).toBe("external-provider-blocked");

      // The Operation Manager / Worker barrier is the same canonical gate.
      expect(evaluateOperationStartGate(decision, "automatic")).toEqual({
        allowed: false,
        reason: "confirmation-required",
      });
      expect(evaluateOperationStartGate(decision, "sidebar")).toEqual({ allowed: true });

      const policy = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "automatic-local-only");
      expect(policy.allowed).toBe(false);
      expect(policy.requiresConfirmation).toBe(true);
    }
  );

  it("manual policy is unaffected by locality (always confirmation)", () => {
    for (const baseUrl of ["http://localhost:11434", "https://ollama.example.com"]) {
      const policy = evaluateEmbeddingUpdatePolicyFromSnapshot(snapshotFor(baseUrl), "manual");
      expect(policy.allowed).toBe(false);
      expect(policy.requiresConfirmation).toBe(true);
    }
  });

  it("locality never overrides ownership/role barriers (Companion and Standby stay blocked)", () => {
    for (const baseUrl of ["http://localhost:11434", "https://ollama.example.com"]) {
      const standby = snapshotFor(baseUrl, "producer", false);
      expect(evaluateSchedulerDecisionFromSnapshot(standby, "automatic-local-only").canDispatch).toBe(false);
      expect(evaluateOperationStartGate(deriveEmbeddingWritePathDecision(standby), "command").allowed).toBe(false);

      const companion = snapshotFor(baseUrl, "companion", false);
      expect(evaluateSchedulerDecisionFromSnapshot(companion, "automatic-local-only").canDispatch).toBe(false);
      expect(evaluateOperationStartGate(deriveEmbeddingWritePathDecision(companion), "command").allowed).toBe(false);
    }
  });

  it("a snapshot built without endpoint information keeps the static provider capability (compatibility)", () => {
    const snapshot = buildEmbeddingWorkLifecycleSnapshot(pendingSummary(), 1, runtime("producer", true));
    expect(deriveEmbeddingWritePathDecision(snapshot).cost).toBe("local");
  });

  it("an explicit endpoint classification wins over the static provider capability", () => {
    const external = buildEmbeddingWorkLifecycleSnapshot(
      pendingSummary({ targetEndpointIsExternal: true }),
      1,
      runtime("producer", true)
    );
    const local = buildEmbeddingWorkLifecycleSnapshot(
      pendingSummary({ targetEndpointIsExternal: false }),
      1,
      runtime("producer", true)
    );
    expect(deriveEmbeddingWritePathDecision(external).cost).toBe("external");
    expect(deriveEmbeddingWritePathDecision(local).cost).toBe("local");
  });
});

describe("LINA-15F — manual confirmation reflects the effective endpoint", () => {
  const strings = getStrings("pt-PT");
  const stringsEn = getStrings("en");

  function confirmationFor(baseUrl: string, locale = strings) {
    const snapshot = snapshotFor(baseUrl);
    return prepareEmbeddingUpdateConfirmation({
      state: { totalChunks: 10, validCount: 8, missingCount: 0, staleCount: 2, obsoleteCount: 0, toGenerateCount: 2 },
      providerCapability: resolveEndpointProviderCapability("ollama", baseUrl),
      policyDecision: evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, "manual"),
      deviceRole: "producer",
      modelName: MODEL,
      strings: locale,
    });
  }

  it("keeps the local no-cost message only for loopback endpoints", () => {
    const local = confirmationFor("http://localhost:11434");
    expect(local?.costWarningMessage).toBe(strings.confirmEmbeddingUpdateLocalNoCost);
    expect(local?.isLocal).toBe(true);
  });

  it("warns that note content leaves the machine for a remote Ollama endpoint", () => {
    const remote = confirmationFor("https://ollama.example.com");
    expect(remote?.isLocal).toBe(false);
    expect(remote?.hasExternalCost).toBe(false);
    expect(remote?.requiresConfirmation).toBe(true);
    expect(remote?.costWarningMessage).toBe(strings.confirmEmbeddingUpdateRemoteEndpointWarningText);
    expect(remote?.costWarningMessage).not.toBe(strings.confirmEmbeddingUpdateLocalNoCost);
    expect(confirmationFor("https://ollama.example.com", stringsEn)?.costWarningMessage).toBe(
      stringsEn.confirmEmbeddingUpdateRemoteEndpointWarningText
    );
  });
});

describe("LINA-15F — incremental generation policy", () => {
  it("embedding generation and assessment are always incremental", () => {
    expect(EMBEDDING_GENERATION_INCREMENTAL).toBe(true);
  });

  it("detects (without honouring) a persisted legacy full-regeneration preference", () => {
    expect(isLegacyFullRegenerationPreferenceSet({})).toBe(false);
    expect(isLegacyFullRegenerationPreferenceSet({ generateOnlyMissingEmbeddings: true })).toBe(false);
    expect(isLegacyFullRegenerationPreferenceSet({ generateOnlyMissingEmbeddings: false })).toBe(true);
    expect(isLegacyFullRegenerationPreferenceSet({ autoGenerateEmbeddingsOnlyWhenNeeded: false })).toBe(true);
    expect(
      isLegacyFullRegenerationPreferenceSet({ generateOnlyMissingEmbeddings: true, autoGenerateEmbeddingsOnlyWhenNeeded: false })
    ).toBe(false);
  });
});

describe("LINA-15F — main.ts wiring guard (no second decision path)", () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, "../../main.ts"), "utf-8");
  const searchViewSource = fs.readFileSync(path.resolve(__dirname, "../../src/search/linaSearchView.ts"), "utf-8");

  it("never classifies locality by provider id alone", () => {
    expect(mainSource).not.toContain("getEmbeddingProviderCapability(");
    expect(mainSource).toContain("resolveEndpointProviderCapability(");
    expect(searchViewSource).not.toMatch(/isLocal\s*=\s*provider\s*===\s*"ollama"/);
    expect(searchViewSource).toContain("isProviderEndpointLocal(");
  });

  it("every consumer of the live snapshot passes the effective endpoint locality", () => {
    expect(mainSource.match(/targetEndpointIsExternal:/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("does not read the legacy generateOnlyMissingEmbeddings preference to decide incremental mode", () => {
    expect(mainSource).not.toMatch(/incremental:[^\n]*generateOnlyMissingEmbeddings/);
    expect(mainSource).not.toMatch(/incremental:[^\n]*autoGenerateEmbeddingsOnlyWhenNeeded/);
    expect(mainSource.match(/incremental:[^\n]*EMBEDDING_GENERATION_INCREMENTAL/g)?.length ?? 0).toBe(4);
  });
});
