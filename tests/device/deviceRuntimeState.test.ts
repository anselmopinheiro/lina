import { describe, expect, it } from "vitest";
import {
  resolveDeviceRuntimeState,
  type DeviceRuntimeState,
  type ResolveDeviceRuntimeStateInput,
} from "../../src/device/deviceRuntimeState";
import { DeviceState } from "../../src/device/deviceState";
import { OwnershipManifest } from "../../src/device/deviceOwnership";

describe("DeviceRuntimeState (LINA-06-IMPLEMENT-DEVICE-RUNTIME-STATE-001)", () => {
  const deviceIdA = "11111111-1111-4111-8111-111111111111";
  const deviceIdB = "22222222-2222-4222-8222-222222222222";

  function createDeviceState(role?: "producer" | "companion", name = "My Device"): DeviceState {
    return {
      schemaVersion: 2,
      deviceId: deviceIdA,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deviceName: name,
      role,
    };
  }

  function createOwnership(activeProducerId: string | null, epoch = 1): OwnershipManifest {
    return {
      schemaVersion: 1,
      activeProducerId,
      epoch,
      acquiredAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      reason: "initial",
    };
  }

  // 1. Cenário: Producer Ativo
  it("resolves active producer correctly when local device owns the activeProducerId", () => {
    const state: DeviceRuntimeState = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState: createDeviceState("producer", "Studio Mac"),
      ownership: createOwnership(deviceIdA, 1),
      embeddingsEnabled: true,
    });

    expect(state.deviceId).toBe(deviceIdA);
    expect(state.deviceName).toBe("Studio Mac");
    expect(state.effectiveRole).toBe("producer");
    expect(state.isActiveProducer).toBe(true);
    expect(state.isStandbyProducer).toBe(false);
    expect(state.isCompanion).toBe(false);
    expect(state.canPublish).toBe(true);
    expect(state.ownershipExists).toBe(true);
    expect(state.epoch).toBe(1);
    expect(state.activeProducerId).toBe(deviceIdA);
    expect(state.canTransferOwnership).toBe(false);
    expect(state.transferEligibilityReason).toBe("already-active-producer");
  });

  // 2. Cenário: Standby Producer
  it("resolves standby producer when local role is producer but another device holds ownership", () => {
    const state: DeviceRuntimeState = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState: createDeviceState("producer", "Laptop"),
      ownership: createOwnership(deviceIdB, 2),
      embeddingsEnabled: true,
    });

    expect(state.effectiveRole).toBe("producer");
    expect(state.isActiveProducer).toBe(false);
    expect(state.isStandbyProducer).toBe(true);
    expect(state.isCompanion).toBe(false);
    expect(state.canPublish).toBe(false);
    expect(state.activeProducerId).toBe(deviceIdB);
    expect(state.epoch).toBe(2);
    expect(state.canTransferOwnership).toBe(true);
    expect(state.transferEligibilityReason).toBe("ready");
  });

  // 3. Cenário: Companion
  it("resolves companion device as consumer-only regardless of ownership manifest", () => {
    const state: DeviceRuntimeState = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState: createDeviceState("companion", "Pixel Phone"),
      ownership: createOwnership(deviceIdB, 1),
      embeddingsEnabled: false,
    });

    expect(state.effectiveRole).toBe("companion");
    expect(state.isActiveProducer).toBe(false);
    expect(state.isStandbyProducer).toBe(false);
    expect(state.isCompanion).toBe(true);
    expect(state.canPublish).toBe(false);
    expect(state.canTransferOwnership).toBe(false);
    expect(state.transferEligibilityReason).toBe("companion-role");
  });

  // 4. Cenário: Transferência de Ownership
  it("updates active and standby states consistently upon ownership transfer", () => {
    const deviceState = createDeviceState("producer");

    // Before transfer: device A is standby
    const beforeTransfer = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState,
      ownership: createOwnership(deviceIdB, 1),
    });
    expect(beforeTransfer.isActiveProducer).toBe(false);
    expect(beforeTransfer.isStandbyProducer).toBe(true);
    expect(beforeTransfer.canPublish).toBe(false);
    expect(beforeTransfer.canTransferOwnership).toBe(true);

    // After transfer: device A becomes active producer under epoch 2
    const afterTransfer = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState,
      ownership: createOwnership(deviceIdA, 2),
    });
    expect(afterTransfer.isActiveProducer).toBe(true);
    expect(afterTransfer.isStandbyProducer).toBe(false);
    expect(afterTransfer.canPublish).toBe(true);
    expect(afterTransfer.epoch).toBe(2);
    expect(afterTransfer.canTransferOwnership).toBe(false);
    expect(afterTransfer.transferEligibilityReason).toBe("already-active-producer");
  });

  // 5. Cenário: Primeiro arranque sem cache (Unclaimed / No ownership manifest)
  it("handles first run safely when ownership manifest does not yet exist", () => {
    const state: DeviceRuntimeState = resolveDeviceRuntimeState({
      deviceId: deviceIdA,
      deviceState: createDeviceState("producer"),
      ownership: null,
    });

    expect(state.ownershipExists).toBe(false);
    expect(state.activeProducerId).toBeUndefined();
    expect(state.epoch).toBeUndefined();
    expect(state.isActiveProducer).toBe(false);
    expect(state.isStandbyProducer).toBe(true);
    expect(state.canPublish).toBe(false);
    expect(state.canTransferOwnership).toBe(false);
    expect(state.transferEligibilityReason).toBe("missing-ownership");
  });

  // 6. Separação de Existência, Compatibilidade, Prontidão e Disponibilidade Semântica
  describe("embeddings capability separation", () => {
    it("distinguishes physical existence from vector contract compatibility", () => {
      // Manifest exists and declares embeddings, but local config is incompatible
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 10,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
        },
        semanticAvailability: {
          available: false,
          reasonCode: "incompatible",
          reason: "Modelo incompatível com índice publicado",
        },
      });

      // 1. Physical existence: declared in manifest
      expect(state.embeddings.embeddingsDeclared).toBe(true);
      expect(state.embeddings.textIndexAvailable).toBe(true);

      // 2. Compatibility: mismatch
      expect(state.embeddings.contractState).toBe("mismatch");

      // 3. Operational availability: unavailable due to contract mismatch
      expect(state.embeddings.semanticAvailable).toBe(false);
      expect(state.embeddings.effectiveMode).toBe("text-only");
      expect(state.embeddings.reasonCode).toBe("model-incompatible");
    });

    it("reports runtime checking readiness without falsely marking embeddings as missing", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 10,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
        },
        isChecking: true,
      });

      expect(state.embeddings.embeddingsDeclared).toBe(true);
      expect(state.embeddings.runtimeState).toBe("checking");
      expect(state.embeddings.semanticAvailable).toBe(false);
      expect(state.embeddings.reasonCode).toBe("runtime-checking");
    });

    it("reports fully operational semantic search when all 4 layers are satisfied", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 10,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
        },
        semanticAvailability: {
          available: true,
        },
      });

      expect(state.embeddings.textIndexAvailable).toBe(true);
      expect(state.embeddings.embeddingsDeclared).toBe(true);
      expect(state.embeddings.contractState).toBe("compatible");
      expect(state.embeddings.runtimeState).toBe("ready");
      expect(state.embeddings.semanticAvailable).toBe(true);
      expect(state.embeddings.effectiveMode).toBe("full");
    });
  });

  // 7. Paridade Absoluta com DeviceDiagnostics
  describe("single source of truth consistency with DeviceDiagnostics", () => {
    it("guarantees buildDeviceDiagnostics shares identical role and ownership state with DeviceRuntimeState", async () => {
      const { buildDeviceDiagnostics } = await import("../../src/device/deviceDiagnostics");

      const input = {
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer", "Main Studio"),
        ownership: createOwnership(deviceIdA, 3),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 50,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
        },
        semanticAvailability: { available: true },
      };

      const runtimeState = resolveDeviceRuntimeState(input);
      const diagnostics = buildDeviceDiagnostics(input);

      // Core device and role parity
      expect(diagnostics.device.id).toBe(runtimeState.deviceId);
      expect(diagnostics.device.name).toBe(runtimeState.deviceName);
      expect(diagnostics.device.role).toBe(runtimeState.effectiveRole);
      expect(diagnostics.device.isConfigured).toBe(runtimeState.isConfigured);

      // Ownership and cluster parity
      expect(diagnostics.ownership.isActiveProducer).toBe(runtimeState.isActiveProducer);
      expect(diagnostics.ownership.isStandbyProducer).toBe(runtimeState.isStandbyProducer);
      expect(diagnostics.ownership.isCompanion).toBe(runtimeState.isCompanion);
      expect(diagnostics.ownership.activeProducerId).toBe(runtimeState.activeProducerId);
      expect(diagnostics.ownership.epoch).toBe(runtimeState.epoch);

      // Transfer parity
      expect(diagnostics.transfer.canTransferOwnership).toBe(runtimeState.canTransferOwnership);
      expect(diagnostics.transfer.eligibilityReason).toBe(runtimeState.transferEligibilityReason);

      // Search & embeddings capability parity
      expect(diagnostics.companionSearch.textIndexAvailable).toBe(runtimeState.embeddings.textIndexAvailable);
      expect(diagnostics.companionSearch.embeddingsAvailable).toBe(runtimeState.embeddings.embeddingsDeclared);
      expect(diagnostics.companionSearch.operationalSemanticAvailable).toBe(runtimeState.embeddings.semanticAvailable);

      // Runtime embedded reference
      expect(diagnostics.runtime).toBeDefined();
      expect(diagnostics.runtime?.isActiveProducer).toBe(true);
    });
  });

  // 8. Capacidade Semântica e Consistência (LINA-07-IMPLEMENT-SEMANTIC-CAPABILITY-STATE-001)
  describe("semantic capability consistency (LINA-07)", () => {
    // Caso 1: Embeddings existentes, mesma epoch -> semanticAvailable = true
    it("Caso 1: resolves semanticAvailable = true when embeddings exist and epoch matches", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 1),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
          provenance: {
            producerDeviceId: deviceIdA,
            producerEpoch: 1,
            generatedAt: "2026-09-01T00:00:00.000Z",
          },
        },
        semanticAvailability: {
          available: true,
          indexProvider: "ollama",
          indexModel: "nomic-embed-text",
          indexDimensions: 768,
        },
      });

      expect(state.embeddings.exists).toBe(true);
      expect(state.embeddings.provenance.epoch).toBe(1);
      expect(state.embeddings.provenance.stale).toBe(false);
      expect(state.embeddings.compatibility.compatible).toBe(true);
      expect(state.embeddings.readiness.runtimeReady).toBe(true);
      expect(state.embeddings.semanticAvailable).toBe(true);
      expect(state.embeddings.effectiveMode).toBe("full");
    });

    // Caso 2: Embeddings de epoch anterior -> semanticAvailable = true, provenance.stale = true
    it("Caso 2: keeps semanticAvailable = true even when embeddings belong to an earlier epoch (provenance.stale = true)", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 3), // active epoch 3
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
          provenance: {
            producerDeviceId: deviceIdB,
            producerEpoch: 1, // older epoch 1
            generatedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        semanticAvailability: {
          available: true,
          indexProvider: "ollama",
          indexModel: "nomic-embed-text",
          indexDimensions: 768,
        },
      });

      // Crucial: provenance is stale, but semantic capability remains operational!
      expect(state.embeddings.exists).toBe(true);
      expect(state.embeddings.provenance.stale).toBe(true);
      expect(state.embeddings.provenance.epoch).toBe(3);
      expect(state.embeddings.compatibility.compatible).toBe(true);
      expect(state.embeddings.semanticAvailable).toBe(true);
      expect(state.embeddings.effectiveMode).toBe("full");
    });

    // Caso 3: Provider/modelo incompatível -> semanticAvailable = false, reason = incompatible
    it("Caso 3: reports semanticAvailable = false with incompatible reason when contract mismatches", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 1),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
          },
        },
        semanticAvailability: {
          available: false,
          reasonCode: "incompatible",
          reason: "Contrato vetorial incompatível com o dispositivo.",
          indexProvider: "ollama",
          indexModel: "nomic-embed-text",
        },
      });

      expect(state.embeddings.exists).toBe(true);
      expect(state.embeddings.compatibility.compatible).toBe(false);
      expect(state.embeddings.semanticAvailable).toBe(false);
      expect(state.embeddings.effectiveMode).toBe("text-only");
      expect(state.embeddings.reasonCode).toBe("model-incompatible");
      expect(state.embeddings.reason).toMatch(/incompatível/i);
    });

    // Caso 4: Embeddings inexistentes -> semanticAvailable = false, reason = missing
    it("Caso 4: reports semanticAvailable = false with missing reason when embeddings do not exist", () => {
      const state = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 1),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: false,
        },
        semanticAvailability: {
          available: false,
          reasonCode: "missing",
          reason: "Embeddings não encontrados.",
        },
      });

      expect(state.embeddings.exists).toBe(false);
      expect(state.embeddings.embeddingsDeclared).toBe(false);
      expect(state.embeddings.semanticAvailable).toBe(false);
      expect(state.embeddings.reasonCode).toBe("vector-file-missing");
      expect(state.embeddings.effectiveMode).toBe("text-only");
    });

    // Caso 5: Primeiro arranque -> Sem estado 'unknown' permanente na sidebar
    it("Caso 5: avoids permanent unknown state during first startup and checking", async () => {
      const { buildSidebarStatusViewModel } = await import("../../src/search/sidebarStatusViewModel");
      const { getStrings } = await import("../../src/i18n/strings");
      const stringsPt = getStrings("pt-PT");

      // While checking
      const checkingState = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 1),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: true,
          embeddings: { provider: "ollama", model: "nomic-embed-text" },
        },
        isChecking: true,
      });

      const checkingVm = buildSidebarStatusViewModel({
        deviceId: deviceIdA,
        textIndexReady: true,
        currentSearchMode: "hibrida",
        strings: stringsPt,
        runtimeEmbeddings: checkingState.embeddings,
        semanticAvailable: checkingState.embeddings.semanticAvailable,
      });

      // Checking state displays explicit checking text, not "Estado desconhecido"
      expect(checkingVm.freshness.embeddings.humanText).toBe(stringsPt.sidebarFreshnessChecking);

      // Once ready and available
      const readyState = resolveDeviceRuntimeState({
        deviceId: deviceIdA,
        deviceState: createDeviceState("producer"),
        ownership: createOwnership(deviceIdA, 1),
        textManifestRaw: {
          indexType: "text",
          version: 1,
          totalNotes: 20,
          embeddingsEnabled: true,
          embeddings: { provider: "ollama", model: "nomic-embed-text" },
        },
        semanticAvailability: { available: true },
      });

      const readyVm = buildSidebarStatusViewModel({
        deviceId: deviceIdA,
        textIndexReady: true,
        currentSearchMode: "hibrida",
        strings: stringsPt,
        runtimeEmbeddings: readyState.embeddings,
        semanticAvailable: readyState.embeddings.semanticAvailable,
      });

      expect(readyVm.freshness.embeddings.status).toBe("fresh");
      expect(readyVm.searchAvailability.semanticAvailable).toBe(true);
      expect(readyVm.searchAvailability.hybridMode).toBe("full");
    });
  });
});
