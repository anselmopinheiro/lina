import { describe, it, expect, vi } from "vitest";
import {
  buildDeviceDiagnostics,
  readDeviceDiagnostics,
} from "../../src/device/deviceDiagnostics";
import { DeviceDiagnosticsModal } from "../../src/device/deviceDiagnosticsModal";
import { OwnershipDataAdapter } from "../../src/device/deviceOwnership";
import { getStrings } from "../../src/i18n/strings";
import { App } from "obsidian";

const MOCK_PRODUCER_ID = "550e8400-e29b-41d4-a716-446655440001";
const MOCK_COMPANION_ID = "550e8400-e29b-41d4-a716-446655440002";

function createMockAdapter(files: Record<string, string> = {}): OwnershipDataAdapter {
  const store = new Map<string, string>(Object.entries(files));
  return {
    exists: vi.fn(async (path: string) => store.has(path)),
    read: vi.fn(async (path: string) => {
      const content = store.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    write: vi.fn(async (path: string, data: string) => {
      store.set(path, data);
    }),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      const content = store.get(oldPath);
      if (content === undefined) throw new Error(`File not found: ${oldPath}`);
      store.delete(oldPath);
      store.set(newPath, content);
    }),
    remove: vi.fn(async (path: string) => {
      store.delete(path);
    }),
    list: vi.fn(async () => Array.from(store.keys())),
  };
}

function createMockContainer(elements: { tag: string; text?: string; attr?: any }[]) {
  const createMockNode = (tag: string, opts?: any): any => {
    elements.push({ tag, text: opts?.text, attr: opts?.attr });
    return {
      createEl: vi.fn((childTag: string, childOpts?: any) => createMockNode(childTag, childOpts)),
      createDiv: vi.fn((childOpts?: any) => createMockNode("div", childOpts)),
      createSpan: vi.fn((spanOpts?: any) => createMockNode("span", spanOpts)),
      empty: vi.fn(),
      addClass: vi.fn(),
      addEventListener: vi.fn(),
    };
  };

  return {
    empty: vi.fn(),
    addClass: vi.fn(),
    createEl: vi.fn((tag: string, opts?: any) => createMockNode(tag, opts)),
    createDiv: vi.fn((opts?: any) => createMockNode("div", opts)),
    createSpan: vi.fn((spanOpts?: any) => createMockNode("span", spanOpts)),
  };
}

describe("DeviceDiagnostics Companion Search Section (Phase 0.4.2.1)", () => {
  describe("Capability and Role Resolution", () => {
    it("reports companion role as companion in diagnostics", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: {
          deviceId: MOCK_COMPANION_ID,
          role: "companion",
          deviceName: "iPad Pro",
          createdAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 10,
          totalChunks: 30,
        },
      });

      expect(diag.companionSearch.isCompanionRole).toBe(true);
      expect(diag.companionSearch.supported).toBe(true);
      expect(diag.companionSearch.available).toBe(true);
      expect(diag.companionSearch.mode).toBe("text-only");
    });

    it("reports producer role correctly without disabling search consumption", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_PRODUCER_ID,
        deviceState: {
          deviceId: MOCK_PRODUCER_ID,
          role: "producer",
          deviceName: "MacBook Pro",
          createdAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 15,
        },
      });

      expect(diag.companionSearch.isCompanionRole).toBe(false);
      expect(diag.companionSearch.supported).toBe(true);
      expect(diag.companionSearch.available).toBe(true);
    });

    it("reports unassigned device role with neutral defaults", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: "550e8400-e29b-41d4-a716-446655440099",
        deviceState: null,
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 15,
        },
      });

      expect(diag.companionSearch.isCompanionRole).toBe(false);
      expect(diag.companionSearch.supported).toBe(true);
      expect(diag.companionSearch.available).toBe(true);
    });
  });

  describe("Search Availability and Consumption Modes", () => {
    it("reports 'full' mode when text index and embeddings are both available", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 20,
          totalChunks: 80,
          embeddingsEnabled: true,
          embeddings: {
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
            publicationId: "pub-1",
          },
        },
        binaryManifestRaw: {
          version: 1,
          generationId: "gen-1",
          sourcePublicationId: "pub-1",
          provider: "ollama",
          model: "nomic-embed-text",
          recordCount: 80,
          dimensions: 768,
          createdAt: "2026-08-31T10:00:00.000Z",
        },
      });

      expect(diag.companionSearch.available).toBe(true);
      expect(diag.companionSearch.mode).toBe("full");
      expect(diag.companionSearch.textIndexAvailable).toBe(true);
      expect(diag.companionSearch.embeddingsAvailable).toBe(true);
    });

    it("reports 'text-only' mode when embeddings are disabled or missing", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 20,
          totalChunks: 80,
          embeddingsEnabled: false,
        },
      });

      expect(diag.companionSearch.available).toBe(true);
      expect(diag.companionSearch.mode).toBe("text-only");
      expect(diag.companionSearch.textIndexAvailable).toBe(true);
      expect(diag.companionSearch.embeddingsAvailable).toBe(false);
    });

    it("reports 'unavailable' mode when index manifest is absent", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        textManifestRaw: null,
      });

      expect(diag.companionSearch.available).toBe(false);
      expect(diag.companionSearch.mode).toBe("unavailable");
      expect(diag.companionSearch.textIndexAvailable).toBe(false);
      expect(diag.companionSearch.embeddingsAvailable).toBe(false);
    });

    it("preserves availability under stale or unknown provenance", () => {
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        ownership: {
          schemaVersion: 1,
          activeProducerId: MOCK_PRODUCER_ID,
          epoch: 10,
          acquiredAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 5,
          totalChunks: 10,
          provenance: {
            producerDeviceId: MOCK_PRODUCER_ID,
            producerEpoch: 2, // stale epoch
            generatedAt: "2026-08-31T08:00:00.000Z",
          },
        },
      });

      expect(diag.companionSearch.available).toBe(true);
      expect(diag.companionSearch.mode).toBe("text-only");
      expect(diag.artifacts.index.status).toBe("stale");
    });
  });

  describe("Zero-Mutation & Safety Invariants", () => {
    it("never calls write, rename, remove when reading diagnostics", async () => {
      const adapter = createMockAdapter({
        [`.lina/devices/${MOCK_COMPANION_ID}.json`]: JSON.stringify({
          schemaVersion: 2,
          deviceId: MOCK_COMPANION_ID,
          role: "companion",
          deviceName: "Phone",
          createdAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        }),
        ".lina/ownership.json": JSON.stringify({
          schemaVersion: 1,
          activeProducerId: MOCK_PRODUCER_ID,
          epoch: 1,
          acquiredAt: "2026-08-31T10:00:00.000Z",
          updatedAt: "2026-08-31T10:00:00.000Z",
        }),
        ".lina/index/manifest.json": JSON.stringify({
          version: 1,
          indexType: "text",
          totalNotes: 15,
          totalChunks: 45,
        }),
      });

      const diag = await readDeviceDiagnostics(adapter, MOCK_COMPANION_ID);

      expect(diag.companionSearch.available).toBe(true);
      expect(diag.companionSearch.isCompanionRole).toBe(true);

      // Verify zero mutations
      expect(adapter.write).not.toHaveBeenCalled();
      expect(adapter.rename).not.toHaveBeenCalled();
      expect(adapter.remove).not.toHaveBeenCalled();
    });
  });

  describe("UI Modal and Internationalization (pt-PT and en)", () => {
    it("renders companion search section correctly in pt-PT", () => {
      const ptStrings = getStrings("pt-PT");
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        textManifestRaw: {
          version: 1,
          indexType: "text",
          totalNotes: 10,
          totalChunks: 25,
        },
      });

      const elements: { tag: string; text?: string; attr?: any }[] = [];
      const mockContainer = createMockContainer(elements);
      const mockApp = {} as App;
      const modal = new DeviceDiagnosticsModal(mockApp, diag, ptStrings);
      (modal as any).contentEl = mockContainer;

      modal.onOpen();

      const renderedTexts = elements.map((e) => e.text).filter(Boolean);
      expect(renderedTexts).toContain(ptStrings.deviceDiagnosticsSectionCompanionSearch);
      expect(renderedTexts).toContain(ptStrings.deviceDiagnosticsCompanionStatusAvailable);
      expect(renderedTexts).toContain(ptStrings.deviceDiagnosticsCompanionModeTextOnly);
    });

    it("renders companion search section correctly in en", () => {
      const enStrings = getStrings("en");
      const diag = buildDeviceDiagnostics({
        deviceId: MOCK_COMPANION_ID,
        deviceState: { deviceId: MOCK_COMPANION_ID, role: "companion" },
        textManifestRaw: null, // unavailable
      });

      const elements: { tag: string; text?: string }[] = [];
      const mockContainer = createMockContainer(elements);
      const mockApp = {} as App;
      const modal = new DeviceDiagnosticsModal(mockApp, diag, enStrings);
      (modal as any).contentEl = mockContainer;

      modal.onOpen();

      const renderedTexts = elements.map((e) => e.text).filter(Boolean);
      expect(renderedTexts).toContain(enStrings.deviceDiagnosticsSectionCompanionSearch);
      expect(renderedTexts).toContain(enStrings.deviceDiagnosticsCompanionStatusUnavailable);
      expect(renderedTexts).toContain(enStrings.deviceDiagnosticsCompanionModeUnavailable);
    });
  });
});
