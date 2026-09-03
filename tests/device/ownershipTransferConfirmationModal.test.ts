import { describe, expect, it, vi, beforeEach } from "vitest";
import { OwnershipTransferConfirmationModal } from "../../src/device/ownershipTransferConfirmationModal";
import { OwnershipTransferPreview } from "../../src/device/ownershipTransferSafety";
import { getStrings } from "../../src/i18n/strings";
import * as safetyLayer from "../../src/device/ownershipTransferSafety";

// Mock Notice
vi.mock("obsidian", async () => {
  const actual = await vi.importActual<any>("obsidian");
  class MockNotice {
    message: string;
    constructor(message: string) {
      this.message = message;
      MockNotice.instances.push(this);
    }
    static instances: MockNotice[] = [];
    static clear() {
      MockNotice.instances = [];
    }
  }
  return {
    ...actual,
    Notice: MockNotice,
    Modal: class {
      app: any;
      contentEl: any;
      title: string = "";
      constructor(app: any) {
        this.app = app;
      }
      setTitle(title: string) {
        this.title = title;
      }
      open() {}
      close() {}
    },
  };
});

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
  disabled?: boolean;
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

describe("OwnershipTransferConfirmationModal", () => {
  const currentProducerId = "00000000-0000-4000-8000-000000000001";
  const targetProducerId = "00000000-0000-4000-8000-000000000002";
  const preview: OwnershipTransferPreview = {
    currentProducerId,
    targetProducerId,
    currentEpoch: 4,
    nextEpoch: 5,
    reason: "manual-transfer",
    requiresConfirmation: true,
    preparedAt: "2026-09-01T14:00:00.000Z",
  };

  let mockAdapter: any;
  let mockApp: any;

  beforeEach(async () => {
    const { Notice } = await import("obsidian");
    (Notice as any).clear();
    mockAdapter = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
    };
    mockApp = {
      vault: { adapter: mockAdapter },
    };
  });

  it("renders Portuguese confirmation dialog accurately", () => {
    const ptStrings = getStrings("pt-PT");
    const modal = new OwnershipTransferConfirmationModal(mockApp, preview, mockAdapter, undefined, ptStrings);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.onOpen();

    const text = root.textContent;

    // Title / Headers
    expect(text).toContain(ptStrings.ownershipTransferCurrentSection);
    expect(text).toContain(ptStrings.ownershipTransferNewSection);
    expect(text).toContain(ptStrings.ownershipTransferWarningTitle);
    expect(text).toContain(ptStrings.ownershipTransferWarningText);

    // Current state values
    expect(text).toContain(currentProducerId);
    expect(text).toContain("4");

    // New state values
    expect(text).toContain(targetProducerId);
    expect(text).toContain("5");

    // Buttons
    const buttons = root.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain(ptStrings.ownershipTransferCancelButton);
    expect(buttons[1].textContent).toContain(ptStrings.ownershipTransferConfirmButton);
  });

  it("renders English confirmation dialog accurately", () => {
    const enStrings = getStrings("en");
    const modal = new OwnershipTransferConfirmationModal(mockApp, preview, mockAdapter, undefined, enStrings);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.onOpen();

    const text = root.textContent;

    // Title / Headers
    expect(text).toContain(enStrings.ownershipTransferCurrentSection);
    expect(text).toContain(enStrings.ownershipTransferNewSection);
    expect(text).toContain(enStrings.ownershipTransferWarningTitle);
    expect(text).toContain(enStrings.ownershipTransferWarningText);

    // Current state values
    expect(text).toContain(currentProducerId);
    expect(text).toContain("4");

    // New state values
    expect(text).toContain(targetProducerId);
    expect(text).toContain("5");

    // Buttons
    const buttons = root.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain(enStrings.ownershipTransferCancelButton);
    expect(buttons[1].textContent).toContain(enStrings.ownershipTransferConfirmButton);
  });

  it("renders localized None / Nenhum when currentProducerId is undefined in relinquished vault (PT-PT)", () => {
    const ptStrings = getStrings("pt-PT");
    const relinquishedPreview: OwnershipTransferPreview = {
      ...preview,
      currentProducerId: undefined,
    };
    const modal = new OwnershipTransferConfirmationModal(mockApp, relinquishedPreview, mockAdapter, undefined, ptStrings);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.onOpen();

    const text = root.textContent;
    expect(text).toContain(ptStrings.deviceDiagnosticsOwnershipNone);
    expect(text).toContain("Nenhum");
    expect(text).not.toContain("undefined");
  });

  it("renders localized None / Nenhum when currentProducerId is undefined in relinquished vault (EN)", () => {
    const enStrings = getStrings("en");
    const relinquishedPreview: OwnershipTransferPreview = {
      ...preview,
      currentProducerId: undefined,
    };
    const modal = new OwnershipTransferConfirmationModal(mockApp, relinquishedPreview, mockAdapter, undefined, enStrings);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.onOpen();

    const text = root.textContent;
    expect(text).toContain(enStrings.deviceDiagnosticsOwnershipNone);
    expect(text).toContain("None");
    expect(text).not.toContain("undefined");
  });

  it("cancel button closes modal without executing transfer or modifying files", () => {
    const modal = new OwnershipTransferConfirmationModal(mockApp, preview, mockAdapter);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.close = vi.fn();
    modal.onOpen();

    const buttons = root.querySelectorAll("button");
    const cancelBtn = buttons[0];
    expect(cancelBtn.textContent).toContain("Cancelar");

    const cancelListeners = cancelBtn.listeners.get("click") ?? [];
    expect(cancelListeners.length).toBe(1);
    cancelListeners[0]();

    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(mockAdapter.write).not.toHaveBeenCalled();
  });

  it("confirm button calls confirmAndExecuteOwnershipTransfer and triggers success callback on success", async () => {
    const onTransferSuccess = vi.fn();
    const executeSpy = vi.spyOn(safetyLayer, "confirmAndExecuteOwnershipTransfer").mockResolvedValue({
      success: true,
      manifest: {
        activeProducerId: targetProducerId,
        epoch: 5,
        updatedAt: "2026-09-01T15:00:00.000Z",
        reason: "manual-transfer",
      },
      previousManifest: {
        activeProducerId: currentProducerId,
        epoch: 4,
        updatedAt: "2026-09-01T14:00:00.000Z",
        reason: "initial-creation",
      },
    });

    const modal = new OwnershipTransferConfirmationModal(mockApp, preview, mockAdapter, onTransferSuccess);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.close = vi.fn();
    modal.onOpen();

    const buttons = root.querySelectorAll("button");
    const confirmBtn = buttons[1];
    expect(confirmBtn.textContent).toContain("Confirmar transferência");

    const confirmListeners = confirmBtn.listeners.get("click") ?? [];
    expect(confirmListeners.length).toBe(1);
    confirmListeners[0]();

    // Allow async handler to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executeSpy).toHaveBeenCalledWith(mockAdapter, preview, { confirmed: true });
    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(onTransferSuccess).toHaveBeenCalledTimes(1);

    const { Notice } = await import("obsidian");
    expect((Notice as any).instances.length).toBe(1);
    expect((Notice as any).instances[0].message).toContain("Ownership transferida com sucesso");

    executeSpy.mockRestore();
  });

  it("displays epoch mismatch error notice when manifest epoch changes concurrently", async () => {
    const onTransferSuccess = vi.fn();
    const executeSpy = vi.spyOn(safetyLayer, "confirmAndExecuteOwnershipTransfer").mockResolvedValue({
      success: false,
      reason: "epoch-mismatch",
      currentManifest: {
        activeProducerId: "other-device",
        epoch: 6,
        updatedAt: "2026-09-01T14:30:00.000Z",
        reason: "manual-transfer",
      },
    });

    const modal = new OwnershipTransferConfirmationModal(mockApp, preview, mockAdapter, onTransferSuccess);
    const root = makeElementStub("div");
    modal.contentEl = root as any;
    modal.close = vi.fn();
    modal.onOpen();

    const buttons = root.querySelectorAll("button");
    const confirmBtn = buttons[1];

    const confirmListeners = confirmBtn.listeners.get("click") ?? [];
    confirmListeners[0]();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executeSpy).toHaveBeenCalledWith(mockAdapter, preview, { confirmed: true });
    expect(modal.close).not.toHaveBeenCalled();
    expect(onTransferSuccess).not.toHaveBeenCalled();

    const { Notice } = await import("obsidian");
    expect((Notice as any).instances.length).toBe(1);
    expect((Notice as any).instances[0].message).toContain("alterada concorrentemente no disco");

    executeSpy.mockRestore();
  });

  it("preserves strict device role isolation (Role != Ownership)", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const modalSource = fs.readFileSync(
      path.resolve(__dirname, "../../src/device/ownershipTransferConfirmationModal.ts"),
      "utf-8"
    );

    // Modal must not touch device state or modify roles
    expect(modalSource).not.toContain("saveDeviceState");
    expect(modalSource).not.toContain("setDeviceRole");
    expect(modalSource).not.toContain(".lina/devices");
  });
});
