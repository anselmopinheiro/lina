import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Modal } from "obsidian";
import { IndexDiagnosticModal } from "../../src/indexDiagnosticModal";

interface ElementOptions {
  text?: string;
  attr?: { style?: string };
}

interface ElementStub {
  tag: string;
  textContent: string;
  options?: ElementOptions;
  children: ElementStub[];
  listeners: Map<string, Array<() => void>>;
  createEl: (tag: string, options?: ElementOptions) => ElementStub;
  createDiv: (options?: ElementOptions) => ElementStub;
  createSpan: (options?: ElementOptions) => ElementStub;
  addEventListener: (type: string, listener: () => void) => void;
  empty: () => void;
}

function makeElementStub(tag = "root", options?: ElementOptions): ElementStub {
  const element: ElementStub = {
    tag,
    textContent: options?.text ?? "",
    options,
    children: [],
    listeners: new Map(),
    createEl: (childTag, childOptions) => {
      const child = makeElementStub(childTag, childOptions);
      element.children.push(child);
      return child;
    },
    createDiv: (childOptions) => element.createEl("div", childOptions),
    createSpan: (childOptions) => element.createEl("span", childOptions),
    addEventListener: (type, listener) => {
      const listeners = element.listeners.get(type) ?? [];
      listeners.push(listener);
      element.listeners.set(type, listeners);
    },
    empty: () => {
      element.children = [];
    },
  };

  return element;
}

function getEventsList(root: ElementStub): ElementStub | undefined {
  return root.children.find((child) => child.options?.attr?.style?.includes("max-height: 300px"));
}

interface RenderedModal {
  root: ElementStub;
  modal: IndexDiagnosticModal;
  plugin: {
    clearIndexDiagnosticEvents: ReturnType<typeof vi.fn>;
  };
}

function renderModal(recentEvents: Array<{ timestamp: string; eventType: "create" | "modify"; path: string; message: string }>): RenderedModal {
  let currentEvents = recentEvents;
  const plugin = {
    getIndexDiagnosticData: () => ({
      autoUpdateEnabled: false,
      debugEnabled: false,
      pendingDebounces: 0,
      recentEvents: currentEvents,
    }),
    clearIndexDiagnosticEvents: vi.fn(() => {
      currentEvents = [];
    }),
  };
  const modal = new IndexDiagnosticModal(new App(), plugin as never);
  const root = makeElementStub();
  modal.contentEl = root as never;

  modal.onOpen();

  return { root, modal, plugin };
}

function getClearButton(root: ElementStub): ElementStub | undefined {
  return root.children.find((child) => child.tag === "div" && child.options?.attr?.style?.includes("margin-top: 16px"))?.children[0];
}

describe("index diagnostic modal event list", () => {
  beforeEach(() => {
    Object.defineProperty(IndexDiagnosticModal.prototype, "setTitle", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not create an events list when there are no recent events", () => {
    expect(getEventsList(renderModal([]).root)).toBeUndefined();
  });

  it("renders one ordered row with four fields for each recent event", () => {
    const { root } = renderModal([
      { timestamp: "09:00:00", eventType: "create", path: "inbox/first.md", message: "first event" },
      { timestamp: "09:01:00", eventType: "modify", path: "inbox/second.md", message: "second event" },
    ]);
    const eventsList = getEventsList(root);

    expect(eventsList).toBeDefined();
    expect(eventsList?.children).toHaveLength(2);
    expect(eventsList?.children.map((row) => row.children.map((field) => field.textContent))).toEqual([
      ["[09:00:00] ", "create — ", "inbox/first.md — ", "first event"],
      ["[09:01:00] ", "modify — ", "inbox/second.md — ", "second event"],
    ]);
    expect(eventsList?.children[0].children.map((field) => field.options?.attr?.style)).toEqual([
      "color: var(--text-muted); font-family: monospace;",
      "font-weight: bold;",
      "color: var(--text-accent);",
      "color: var(--text-normal);",
    ]);
  });

  it("clears events once, closes, and opens a fresh modal without the events list", () => {
    const { root, plugin } = renderModal([
      { timestamp: "09:00:00", eventType: "create", path: "inbox/first.md", message: "first event" },
    ]);
    const button = getClearButton(root);
    const reopenedRoots: ElementStub[] = [];
    const closeSpy = vi.spyOn(Modal.prototype, "close");
    const openSpy = vi.spyOn(Modal.prototype, "open").mockImplementation(function () {
      const reopenedRoot = makeElementStub();
      this.contentEl = reopenedRoot as never;
      reopenedRoots.push(reopenedRoot);
      this.onOpen();
    });

    expect(button?.textContent).toBe("Limpar eventos");
    expect(button?.listeners.get("click")).toHaveLength(1);

    button?.listeners.get("click")?.[0]();

    expect(plugin.clearIndexDiagnosticEvents).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(reopenedRoots).toHaveLength(1);
    expect(getEventsList(reopenedRoots[0])).toBeUndefined();
    expect(getClearButton(reopenedRoots[0])?.listeners.get("click")).toHaveLength(1);
  });
});
