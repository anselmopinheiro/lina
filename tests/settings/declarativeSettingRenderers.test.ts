import { describe, expect, it } from "vitest";
import { getStrings } from "../../src/i18n/strings";
import {
  clampDetachedWeight,
  createDetachedConfigNoteRenderer,
  createDetachedInformationalSettingDefinitions,
  createDetachedSupportLinkRenderer,
} from "../../src/settings/declarativeSettingRenderers";

type ElementCall = { tag: string; options: Record<string, unknown> };

function createSettingDouble() {
  const calls: { name?: string; description?: string; elements: ElementCall[] } = { elements: [] };
  const setting = {
    setName(name: string) { calls.name = name; return setting; },
    setDesc(description: string) { calls.description = description; return setting; },
    descEl: {
      createSpan(options: Record<string, unknown>) { calls.elements.push({ tag: "span", options }); },
      createEl(tag: string, options: Record<string, unknown>) { calls.elements.push({ tag, options }); },
    },
  };
  return { calls, setting };
}

describe("detached declarative setting renderers", () => {
  it("preserves hybrid weight limits and fallbacks", () => { expect(clampDetachedWeight("-1", .7)).toBe(0); expect(clampDetachedWeight("2", .3)).toBe(1); expect(clampDetachedWeight("invalid", .7)).toBe(.7); });

  it("renders the config directory note in PT-PT, English, and fallback without a hardcoded directory", () => {
    for (const language of ["pt-PT", "en", "unknown"] as const) {
      const { calls, setting } = createSettingDouble();
      createDetachedConfigNoteRenderer(getStrings(language), ".obsidian-escola")(setting as never, {} as never);
      expect(calls.description).toContain(".obsidian-escola");
      expect(calls.description).not.toContain("{configDir}");
      expect(calls.elements).toEqual([]);
    }
    const source = createDetachedConfigNoteRenderer.toString();
    expect(source).not.toContain(".obsidian");
    expect(source).not.toContain("innerHTML");
  });

  it("renders the existing support link with its safe DOM structure and no outbound work", () => {
    const { calls, setting } = createSettingDouble();
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => { fetchCalls.push(args); return Promise.resolve(new Response()); }) as typeof fetch;
    try {
      createDetachedSupportLinkRenderer(getStrings("pt-PT"))(setting as never, {} as never);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls.name).toBe(getStrings("pt-PT").settingsSupportLink);
    expect(calls.elements).toEqual([
      { tag: "span", options: { text: `${getStrings("pt-PT").settingsSupportLink}: ` } },
      { tag: "a", options: { href: "https://www.buymeacoffee.com/apinheiro", text: "Buy Me a Coffee", attr: { target: "_blank", rel: "noopener noreferrer" } } },
    ]);
    expect(fetchCalls).toEqual([]);
    expect(createDetachedSupportLinkRenderer.toString()).not.toContain("innerHTML");
  });

  it("creates exactly two disconnected render definitions without controls or actions", () => {
    const definitions = createDetachedInformationalSettingDefinitions(getStrings("en"), ".obsidian-escola");
    expect(definitions).toHaveLength(2);
    expect(new Set(definitions.map(({ id }) => id)).size).toBe(2);
    expect(definitions.every((definition) => typeof definition.render === "function")).toBe(true);
    expect(definitions.every((definition) => !("control" in definition) && !("action" in definition))).toBe(true);
  });
});
