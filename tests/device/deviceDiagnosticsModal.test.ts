import { describe, expect, it, vi } from "vitest";
import { DeviceDiagnosticsModal } from "../../src/device/deviceDiagnosticsModal";
import { DeviceDiagnostics } from "../../src/device/deviceDiagnostics";

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

function createModalWithStub(diagnostics: DeviceDiagnostics): { modal: DeviceDiagnosticsModal; root: ElementStub } {
  const mockApp = {
    vault: {
      adapter: {
        exists: vi.fn(),
        read: vi.fn(),
      },
    },
  } as any;

  const modal = new DeviceDiagnosticsModal(mockApp, diagnostics);
  const root = makeElementStub("div");
  modal.contentEl = root as any;
  modal.close = vi.fn();
  return { modal, root };
}

describe("DeviceDiagnosticsModal", () => {
  const deviceId = "d35767c1-4c36-4cb7-a31b-c90cb307d565";
  const timestamp = "2026-09-01T12:00:00.000Z";

  it("renders device, ownership, and artifact sections accurately from diagnostic snapshot", () => {
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
            reason: "provenance-matches-active-producer",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
          },
          diagnosticMessage: "Produced by active producer (epoch 5)",
          exists: true,
          totalNotes: 150,
          totalChunks: 450,
          updatedAt: timestamp,
        },
        embeddings: {
          status: "stale",
          validation: {
            status: "stale",
            reason: "older-epoch",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: true,
          },
          diagnosticMessage: "Older epoch 4 (active is 5)",
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
            reason: "provenance-matches-active-producer",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: true,
          },
          diagnosticMessage: "Produced by active producer (epoch 5)",
          exists: true,
          recordCount: 450,
          dimensions: 768,
        },
        checkpoint: {
          status: "future",
          validation: {
            status: "future",
            reason: "future-epoch",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Future epoch 6 (active is 5)",
          exists: true,
          operationId: "op-sync-42",
          completedRecords: 200,
        },
      },
    };

    const { modal, root } = createModalWithStub(diagnostics);
    modal.onOpen();

    const textContent = root.textContent;

    // 1. Device Section
    expect(textContent).toContain("Dispositivo (Device)");
    expect(textContent).toContain("Studio Workstation");
    expect(textContent).toContain(deviceId);
    expect(textContent).toContain("Produtor (Producer)");
    expect(textContent).toContain("Configurado");

    // 2. Ownership Section
    expect(textContent).toContain("Propriedade e Época (Ownership & Epoch)");
    expect(textContent).toContain("Produtor Ativo (Autorizado a publicar)");
    expect(textContent).toContain("5");
    expect(textContent).toContain("manual-transfer");

    // 3. Artifact Section
    expect(textContent).toContain("Índice Textual");
    expect(textContent).toContain("✓ Válido");
    expect(textContent).toContain("150 notas, 450 blocos (chunks)");

    expect(textContent).toContain("Embeddings Canónicos (JSONL)");
    expect(textContent).toContain("⚠ Desatualizado");
    expect(textContent).toContain("ollama / nomic-embed-text (768d)");

    expect(textContent).toContain("Cópia Binária de Embeddings");
    expect(textContent).toContain("✓ Válido");
    expect(textContent).toContain("450 registos (768d)");

    expect(textContent).toContain("Checkpoint de Embeddings");
    expect(textContent).toContain("⚡ Futuro");
    expect(textContent).toContain("200 registos concluídos");
  });

  it("renders standby producer and unclaimed ownership states correctly", () => {
    const diagnostics: DeviceDiagnostics = {
      timestamp,
      device: {
        id: deviceId,
        role: "producer",
        isConfigured: true,
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
          diagnosticMessage: "Legacy artifact without provenance metadata",
          exists: false,
        },
        embeddings: {
          status: "unknown",
          validation: {
            status: "unknown",
            reason: "provenance-missing",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Legacy artifact without provenance metadata",
          enabled: false,
          exists: false,
        },
        binary: {
          status: "unknown",
          validation: {
            status: "unknown",
            reason: "provenance-missing",
            isProducedByCurrentOwner: false,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Legacy artifact without provenance metadata",
          exists: false,
        },
      },
    };

    const { modal, root } = createModalWithStub(diagnostics);
    modal.onOpen();

    const textContent = root.textContent;

    expect(textContent).toContain("Produtor em Espera (Standby / Somente leitura)");
    expect(textContent).toContain("other-device-id");
    expect(textContent).toContain("❓ Desconhecido");
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
            reason: "provenance-matches-active-producer",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Valid",
          exists: true,
        },
        embeddings: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "provenance-matches-active-producer",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
          },
          diagnosticMessage: "Valid",
          enabled: true,
          exists: true,
        },
        binary: {
          status: "valid",
          validation: {
            status: "valid",
            reason: "provenance-matches-active-producer",
            isProducedByCurrentOwner: true,
            isProducedByLocalDevice: false,
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
});
