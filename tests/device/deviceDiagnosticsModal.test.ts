import { describe, expect, it, vi } from "vitest";
import { DeviceDiagnosticsModal } from "../../src/device/deviceDiagnosticsModal";
import { DeviceDiagnostics } from "../../src/device/deviceDiagnostics";
import { getStrings } from "../../src/i18n/strings";

interface ElementStub {
  tag: string;
  textContent: string;
  options?: any;
  children: ElementStub[];
  listeners: Map<string, Array<() => void>>;
  createEl: (tag: string, options?: any) => ElementStub;
  createDiv: (options?: any) => ElementStub;
  createSpan: (options?: any) => ElementStub;
  addClass: (cls: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
  empty: () => void;
  querySelectorAll: (selector: string) => ElementStub[];
}

function makeElementStub(tag = "div", options?: any): ElementStub {
  const stub: ElementStub = {
    tag,
    textContent: options?.text ?? "",
    options,
    children: [],
    listeners: new Map(),
    createEl: (childTag, childOptions) => {
      const child = makeElementStub(childTag, childOptions);
      stub.children.push(child);
      return child;
    },
    createDiv: (childOptions) => stub.createEl("div", childOptions),
    createSpan: (childOptions) => stub.createEl("span", childOptions),
    addClass: vi.fn(),
    addEventListener: (type, listener) => {
      const list = stub.listeners.get(type) ?? [];
      list.push(listener);
      stub.listeners.set(type, list);
    },
    empty: () => {
      stub.children = [];
    },
    querySelectorAll: (selector: string) => {
      const results: ElementStub[] = [];
      const traverse = (node: ElementStub) => {
        for (const child of node.children) {
          if (child.tag === selector) results.push(child);
          traverse(child);
        }
      };
      traverse(stub);
      return results;
    },
  };

  Object.defineProperty(stub, "textContent", {
    get() {
      let text = options?.text ?? "";
      for (const child of stub.children) {
        text += " " + child.textContent;
      }
      return text;
    },
    configurable: true,
  });

  return stub;
}

function createModalWithStub(
  diagnostics: DeviceDiagnostics,
  strings?: any
): { modal: DeviceDiagnosticsModal; root: ElementStub } {
  const mockApp = {
    vault: {
      adapter: {
        exists: vi.fn(),
        read: vi.fn(),
      },
    },
  } as any;

  const modal = new DeviceDiagnosticsModal(mockApp, diagnostics, strings);
  const root = makeElementStub("div");
  modal.contentEl = root as any;
  modal.close = vi.fn();
  return { modal, root };
}

describe("DeviceDiagnosticsModal", () => {
  const deviceId = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const timestamp = "2026-09-01T12:00:00.000Z";

  it("renders Portuguese strings accurately by default", () => {
    const diagnostics: DeviceDiagnostics = {
      timestamp,
      device: {
        id: deviceId,
        name: "Studio Workstation",
        role: "producer",
        isConfigured: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ownership: {
        activeProducerId: deviceId,
        epoch: 5,
        reason: "manual-transfer",
        acquiredAt: timestamp,
        updatedAt: timestamp,
        isActiveProducer: true,
        isStandbyProducer: false,
        isCompanion: false,
        isUnassigned: false,
        isUnclaimed: false,
      },
      artifacts: {
        index: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 5,
          },
          diagnosticMessage: "Válido (Epoch 5, dispositivo local)",
          exists: true,
          totalNotes: 150,
          totalChunks: 450,
          updatedAt: timestamp,
        },
        embeddings: {
          status: "stale",
          validation: {
            status: "stale",
            reason: "epoch-behind-ownership",
            artifactProvenance: {
              producerDeviceId: deviceId,
              producerEpoch: 4,
              generatedAt: timestamp,
            },
            ownershipEpoch: 5,
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: true,
          },
          diagnosticMessage: "Desatualizado (Epoch 4 vs Epoch atual 5)",
          enabled: true,
          exists: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
        binary: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 5,
          },
          diagnosticMessage: "Válido (Epoch 5, dispositivo local)",
          exists: true,
          recordCount: 450,
          dimensions: 768,
        },
        checkpoint: {
          status: "future",
          validation: {
            status: "future",
            reason: "epoch-ahead-of-ownership",
            artifactProvenance: {
              producerDeviceId: "other-device-id",
              producerEpoch: 6,
              generatedAt: timestamp,
            },
            ownershipEpoch: 5,
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Futuro (Epoch 6 à frente do Epoch local 5)",
          exists: true,
          operationId: "op-sync-42",
          completedRecords: 200,
        },
      },
    };

    const { modal, root } = createModalWithStub(diagnostics);
    modal.onOpen();

    const textContent = root.textContent;

    // 1. Device Section (PT)
    expect(textContent).toContain("Dispositivo");
    expect(textContent).toContain("Studio Workstation");
    expect(textContent).toContain(deviceId);
    expect(textContent).toContain("Produtor");
    expect(textContent).toContain("Configurado");

    // 2. Ownership Section (PT)
    expect(textContent).toContain("Propriedade e Época");
    expect(textContent).toContain("Produtor ativo (autorizado a publicar)");
    expect(textContent).toContain("5");
    expect(textContent).toContain("manual-transfer");

    // 3. Artifact Section (PT)
    expect(textContent).toContain("Índice textual");
    expect(textContent).toContain("✓ Válido");
    expect(textContent).toContain("150 notas, 450 blocos (chunks)");
    expect(textContent).toContain("Válido (Época 5, dispositivo local)");

    expect(textContent).toContain("Embeddings canónicos (JSONL)");
    expect(textContent).toContain("⚠ Desatualizado");
    expect(textContent).toContain("ollama / nomic-embed-text (768d)");
    expect(textContent).toContain("Desatualizado (época 4 vs época ativa 5)");

    expect(textContent).toContain("Cópia binária de embeddings");
    expect(textContent).toContain("✓ Válido");
    expect(textContent).toContain("450 registos (768d)");

    expect(textContent).toContain("Checkpoint de embeddings");
    expect(textContent).toContain("⚡ Futuro");
    expect(textContent).toContain("200 registos concluídos");
    expect(textContent).toContain("Futuro (época 6 à frente da época local 5)");

    // 4. Footer (PT)
    expect(textContent).toContain("Painel de leitura para diagnóstico e auditoria de estado do dispositivo e artefactos.");
  });

  it("renders English strings accurately when English UiStrings are injected", () => {
    const diagnostics: DeviceDiagnostics = {
      timestamp,
      device: {
        id: deviceId,
        name: "Studio Workstation",
        role: "producer",
        isConfigured: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ownership: {
        activeProducerId: deviceId,
        epoch: 5,
        reason: "manual-transfer",
        acquiredAt: timestamp,
        updatedAt: timestamp,
        isActiveProducer: true,
        isStandbyProducer: false,
        isCompanion: false,
        isUnassigned: false,
        isUnclaimed: false,
      },
      artifacts: {
        index: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 5,
          },
          diagnosticMessage: "Valid (Epoch 5, local device)",
          exists: true,
          totalNotes: 150,
          totalChunks: 450,
          updatedAt: timestamp,
        },
        embeddings: {
          status: "stale",
          validation: {
            status: "stale",
            reason: "epoch-behind-ownership",
            artifactProvenance: {
              producerDeviceId: deviceId,
              producerEpoch: 4,
              generatedAt: timestamp,
            },
            ownershipEpoch: 5,
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: true,
          },
          diagnosticMessage: "Stale",
          enabled: true,
          exists: true,
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
        },
        binary: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
            ownershipEpoch: 5,
          },
          diagnosticMessage: "Valid",
          exists: true,
          recordCount: 450,
          dimensions: 768,
        },
        checkpoint: {
          status: "future",
          validation: {
            status: "future",
            reason: "epoch-ahead-of-ownership",
            artifactProvenance: {
              producerDeviceId: "other-device-id",
              producerEpoch: 6,
              generatedAt: timestamp,
            },
            ownershipEpoch: 5,
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Future",
          exists: true,
          operationId: "op-sync-42",
          completedRecords: 200,
        },
      },
    };

    const { modal, root } = createModalWithStub(diagnostics, getStrings("en"));
    modal.onOpen();

    const textContent = root.textContent;

    // 1. Device Section (EN)
    expect(textContent).toContain("Device");
    expect(textContent).toContain("Studio Workstation");
    expect(textContent).toContain(deviceId);
    expect(textContent).toContain("Producer");
    expect(textContent).toContain("Configured");

    // 2. Ownership Section (EN)
    expect(textContent).toContain("Ownership & Epoch");
    expect(textContent).toContain("Active producer (authorized to publish)");
    expect(textContent).toContain("5");
    expect(textContent).toContain("manual-transfer");

    // 3. Artifact Section (EN)
    expect(textContent).toContain("Text index");
    expect(textContent).toContain("✓ Valid");
    expect(textContent).toContain("150 notes, 450 chunks");
    expect(textContent).toContain("Valid (Epoch 5, local device)");

    expect(textContent).toContain("Canonical embeddings (JSONL)");
    expect(textContent).toContain("⚠ Stale");
    expect(textContent).toContain("ollama / nomic-embed-text (768d)");
    expect(textContent).toContain("Stale (epoch 4 vs active epoch 5)");

    expect(textContent).toContain("Binary embeddings copy");
    expect(textContent).toContain("✓ Valid");
    expect(textContent).toContain("450 records (768d)");

    expect(textContent).toContain("Embeddings checkpoint");
    expect(textContent).toContain("⚡ Future");
    expect(textContent).toContain("200 completed records");
    expect(textContent).toContain("Future (epoch 6 ahead of local epoch 5)");

    // 4. Footer (EN)
    expect(textContent).toContain("Read-only panel for device and artifact state diagnostics and auditing.");

    const buttons = root.querySelectorAll("button");
    expect(buttons[0].textContent).toContain("Close");
  });

  it("renders standby producer and unclaimed ownership states correctly in Portuguese and English", () => {
    const diagnostics: DeviceDiagnostics = {
      timestamp,
      device: {
        id: deviceId,
        role: "producer",
        isConfigured: false,
      },
      ownership: {
        activeProducerId: "other-device-id",
        epoch: 2,
        isActiveProducer: false,
        isStandbyProducer: true,
        isCompanion: false,
        isUnassigned: false,
        isUnclaimed: false,
      },
      artifacts: {
        index: {
          status: "unknown",
          validation: {
            status: "unknown",
            reason: "provenance-missing",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Legacy",
          exists: false,
        },
        embeddings: {
          status: "unknown",
          validation: {
            status: "unknown",
            reason: "ownership-unavailable",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "No ownership",
          enabled: false,
          exists: false,
        },
        binary: {
          status: "unknown",
          validation: {
            status: "unknown",
            reason: "provenance-invalid",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Malformed",
          exists: false,
        },
      },
    };

    // Test PT
    const { modal: modalPt, root: rootPt } = createModalWithStub(diagnostics);
    modalPt.onOpen();
    expect(rootPt.textContent).toContain("Produtor em espera (somente leitura)");
    expect(rootPt.textContent).toContain("Inicial / Neutro");
    expect(rootPt.textContent).toContain("Sem metadados de proveniência (índice legado)");
    expect(rootPt.textContent).toContain("Sem manifesto de ownership para comparação");
    expect(rootPt.textContent).toContain("Proveniência malformada");
    expect(rootPt.textContent).toContain("❓ Desconhecido");

    // Test EN
    const { modal: modalEn, root: rootEn } = createModalWithStub(diagnostics, getStrings("en"));
    modalEn.onOpen();
    expect(rootEn.textContent).toContain("Standby producer (read-only)");
    expect(rootEn.textContent).toContain("Initial / Neutral");
    expect(rootEn.textContent).toContain("No provenance metadata (legacy index)");
    expect(rootEn.textContent).toContain("No ownership manifest available for comparison");
    expect(rootEn.textContent).toContain("Malformed provenance metadata");
    expect(rootEn.textContent).toContain("❓ Unknown");
  });

  it("maintains strict read-only guarantee with exactly 1 close button and zero mutation controls", () => {
    const diagnostics: DeviceDiagnostics = {
      timestamp,
      device: {
        id: deviceId,
        role: "companion",
        isConfigured: true,
      },
      ownership: {
        isActiveProducer: false,
        isStandbyProducer: false,
        isCompanion: true,
        isUnassigned: false,
        isUnclaimed: true,
      },
      artifacts: {
        index: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
            ownershipEpoch: 1,
          },
          diagnosticMessage: "Valid",
          exists: true,
        },
        embeddings: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
            ownershipEpoch: 1,
          },
          diagnosticMessage: "Valid",
          enabled: true,
          exists: true,
        },
        binary: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "epoch-and-producer-match",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
            ownershipEpoch: 1,
          },
          diagnosticMessage: "Valid",
          exists: true,
        },
      },
    };

    const { modal, root } = createModalWithStub(diagnostics);
    modal.onOpen();

    const buttons = root.querySelectorAll("button");

    // Exactly 1 button: the "Fechar" (Close) button
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("Fechar");

    // Click handler triggers modal.close()
    const clickListeners = buttons[0].listeners.get("click") ?? [];
    expect(clickListeners.length).toBe(1);
    clickListeners[0]();
    expect(modal.close).toHaveBeenCalledTimes(1);

    // Verify absence of any interactive rebuild/transfer/sync controls
    const buttonTexts = buttons.map((b) => b.textContent?.toLowerCase() ?? "");
    expect(buttonTexts.some((t) => t.includes("rebuild"))).toBe(false);
    expect(buttonTexts.some((t) => t.includes("transfer"))).toBe(false);
    expect(buttonTexts.some((t) => t.includes("claim"))).toBe(false);
    expect(buttonTexts.some((t) => t.includes("sync"))).toBe(false);
    expect(buttonTexts.some((t) => t.includes("repair"))).toBe(false);
  });

  it("preserves strict domain layer independence from i18n", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const provenanceValidationContent = fs.readFileSync(
      path.resolve(__dirname, "../../src/device/artifactProvenanceValidation.ts"),
      "utf-8"
    );
    expect(provenanceValidationContent).not.toContain("UiStrings");
    expect(provenanceValidationContent).not.toContain("i18n");

    const diagnosticsContent = fs.readFileSync(
      path.resolve(__dirname, "../../src/device/deviceDiagnostics.ts"),
      "utf-8"
    );
    expect(diagnosticsContent).not.toContain("UiStrings");
    expect(diagnosticsContent).not.toContain("i18n");
  });
});
