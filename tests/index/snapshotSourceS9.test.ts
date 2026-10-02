import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import LinaPlugin from "../../main.ts";
import { deriveEmbeddingWritePathDecision, evaluateOperationStartGate } from "../../src/index/embeddingLifecycleWritePath";
import type { DeviceRuntimeState } from "../../src/device/deviceRuntimeState";
import { FakeAdapter } from "../helpers/fakeAdapter";

function runtime(exists: boolean): DeviceRuntimeState {
  return {
    deviceId: "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
    effectiveRole: "producer",
    isActiveProducer: true,
    assignmentState: "assigned",
    isConfigured: true,
    ownershipExists: true,
    isStandbyProducer: false,
    isCompanion: false,
    isUnassigned: false,
    canPublish: true,
    canTransferOwnership: false,
    transferEligibilityReason: "already-active-producer",
    embeddings: {
      configured: true,
      textIndexAvailable: true,
      embeddingsDeclared: exists,
      exists,
      vectorFileState: exists ? "available" : "missing",
      provenance: { stale: false },
      compatibility: { compatible: true },
      contractState: "compatible",
      readiness: { loaded: true, runtimeReady: true },
      runtimeState: "ready",
      semanticAvailable: exists,
      effectiveMode: exists ? "full" : "text-only",
    },
  } as DeviceRuntimeState;
}

async function plugin(provider: string, exists: boolean) {
  const app = new App();
  app.vault.adapter = new FakeAdapter({});
  const p = new LinaPlugin(app);
  await p.loadDataFromDisk();
  vi.spyOn(p, "getDeviceRuntimeState").mockReturnValue(runtime(exists));
  vi.spyOn(p.getOwnershipGate(), "isAuthorizedSync").mockReturnValue(true);
  vi.spyOn(p, "getEffectiveEmbeddingEndpointCapability").mockReturnValue({ isLocal: provider === "ollama" } as never);
  return p;
}

describe("S9 — controller without a work summary is fail-closed (LINA-15D-B)", () => {
  for (const provider of ["ollama", "mistral"]) {
    for (const exists of [false, true]) {
      it(`${provider}, canonical exists=${exists}: INDETERMINATE and gate refuses automatic and manual`, async () => {
        const p = await plugin(provider, exists);
        const snapshot = p.getEmbeddingLifecycleSnapshot();
        expect(snapshot.primary).toBe("INDETERMINATE");
        const decision = deriveEmbeddingWritePathDecision(snapshot);
        expect(decision.canExecute).toBe(false);
        expect(evaluateOperationStartGate(decision, "automatic").allowed).toBe(false);
        expect(evaluateOperationStartGate(decision, "command").allowed).toBe(false);
      });
    }
  }
});
