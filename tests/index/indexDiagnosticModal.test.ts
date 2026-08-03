import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
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
    createEl: (childTag, childOptions) => {
      const child = makeElementStub(childTag, childOptions);
      element.children.push(child);
      return child;
    },
    createDiv: (childOptions) => element.createEl("div", childOptions),
    createSpan: (childOptions) => element.createEl("span", childOptions),
    addEventListener: () => {},
    empty: () => {
      element.children = [];
    },
  };

  return element;
}

function getEventsList(root: ElementStub): ElementStub | undefined {
  return root.children.find((child) => child.options?.attr?.style?.includes("max-height: 300px"));
}

function renderModal(recentEvents: Array<{ timestamp: string; eventType: "create" | "modify"; path: string; message: string }>): ElementStub {
  const plugin = {
    getIndexDiagnosticData: () => ({
      autoUpdateEnabled: false,
      debugEnabled: false,
      pendingDebounces: 0,
      recentEvents,
    }),
    clearIndexDiagnosticEvents: vi.fn(),
  };
  const modal = new IndexDiagnosticModal(new App(), plugin as never);
  const root = makeElementStub();
  modal.contentEl = root as never;

  modal.onOpen();

  return root;
}

describe("index diagnostic modal event list", () => {
  beforeEach(() => {
    Object.defineProperty(IndexDiagnosticModal.prototype, "setTitle", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("does not create an events list when there are no recent events", () => {
    expect(getEventsList(renderModal([]))).toBeUndefined();
  });

  it("renders one ordered row with four fields for each recent event", () => {
    const root = renderModal([
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
});
