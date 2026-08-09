import type { SettingDefinition } from "obsidian";
import { getStrings } from "../../src/i18n/strings";
import {
  createDeclarativeSettingsCandidateComposition,
  type DeclarativeSettingsCandidateDefinition,
} from "../../src/settings/declarativeSettingsCandidateComposition";

export type SettingsParityControlKind = "text" | "textarea" | "dropdown" | "toggle" | "button";

export interface SettingsParityUnit {
  kind: "setting" | "content";
  name?: string;
  description?: string;
  text?: string;
  controlKinds: SettingsParityControlKind[];
  buttonLabels: string[];
}

export interface DeclarativeSettingsParityManifestItem {
  id: string;
  ordinal: number;
  group: string;
  heading: string;
  visible: boolean;
  units: SettingsParityUnit[];
}

export interface DeclarativeSettingsParityManifest {
  groups: readonly { id: string; heading: string }[];
  items: DeclarativeSettingsParityManifestItem[];
}

interface MutableUnit extends SettingsParityUnit {
  descriptionParts: string[];
}

function createUnit(): MutableUnit {
  return { kind: "setting", controlKinds: [], buttonLabels: [], descriptionParts: [] };
}

function finaliseUnit(unit: MutableUnit): SettingsParityUnit {
  const description = unit.description ?? unit.descriptionParts.filter(Boolean).join(" ");
  return {
    kind: unit.kind,
    ...(unit.name ? { name: unit.name } : {}),
    ...(description ? { description } : {}),
    ...(unit.text ? { text: unit.text } : {}),
    controlKinds: [...unit.controlKinds],
    buttonLabels: [...unit.buttonLabels],
  };
}

function createControl(kind: SettingsParityControlKind, unit: MutableUnit) {
  unit.controlKinds.push(kind);
  const text = {
    inputEl: { type: "text" },
    setPlaceholder() { return text; },
    setValue() { return text; },
    onChange() { return text; },
  };
  const dropdown = {
    addOption() { return dropdown; },
    setValue() { return dropdown; },
    onChange() { return dropdown; },
  };
  const toggle = {
    setValue() { return toggle; },
    setDisabled() { return toggle; },
    onChange() { return toggle; },
  };
  const button = {
    setButtonText(label: string) { unit.buttonLabels.push(label); return button; },
    setDisabled() { return button; },
    setDestructive() { return button; },
    setCta() { return button; },
    onClick() { return button; },
  };
  return kind === "text" || kind === "textarea" ? text : kind === "dropdown" ? dropdown : kind === "toggle" ? toggle : button;
}

function recordRenderedDefinition(definition: DeclarativeSettingsCandidateDefinition): SettingsParityUnit[] {
  const units: MutableUnit[] = [];
  const addUnit = (): MutableUnit => {
    const unit = createUnit();
    units.push(unit);
    return unit;
  };
  const renderInto = (unit: MutableUnit) => {
    const descriptionElement = {
      createEl(_tag: string, options?: { text?: string }) {
        if (options?.text) unit.descriptionParts.push(options.text);
        return { setText(value: string) { if (value) unit.descriptionParts.push(value); } };
      },
      createSpan(options?: { text?: string }) {
        if (options?.text) unit.descriptionParts.push(options.text);
        return descriptionElement;
      },
    };
    const setting = {
      setName(name: string) { unit.name = name; return setting; },
      setDesc(description: string) { unit.description = description; return setting; },
      descEl: descriptionElement,
      addText(callback: (component: ReturnType<typeof createControl>) => void) { callback(createControl("text", unit)); return setting; },
      addTextArea(callback: (component: ReturnType<typeof createControl>) => void) { callback(createControl("textarea", unit)); return setting; },
      addDropdown(callback: (component: ReturnType<typeof createControl>) => void) { callback(createControl("dropdown", unit)); return setting; },
      addToggle(callback: (component: ReturnType<typeof createControl>) => void) { callback(createControl("toggle", unit)); return setting; },
      addButton(callback: (component: ReturnType<typeof createControl>) => void) { callback(createControl("button", unit)); return setting; },
    };
    return setting;
  };
  const primary = addUnit();
  primary.name = definition.name;
  primary.description = definition.desc;
  if ("control" in definition && definition.control) {
    primary.controlKinds.push(definition.control.type as SettingsParityControlKind);
  }
  if ("action" in definition && definition.action) {
    primary.controlKinds.push("button");
    primary.buttonLabels.push(definition.name);
  }
  if ("render" in definition && definition.render) {
    const group = {
      addSetting(callback: (setting: ReturnType<typeof renderInto>) => void) {
        callback(renderInto(addUnit()));
      },
      listEl: {
        createEl(_tag: string, options?: { text?: string }) {
          if (options?.text) units.push({ ...createUnit(), kind: "content", text: options.text });
        },
      },
    };
    definition.render(renderInto(primary) as never, group as never);
  }
  return units.map(finaliseUnit);
}

function createCandidateFixture() {
  let snapshot = {
    settings: {
      deviceSettingsById: {
        device: {
          analysisProvider: "mistral",
          analysisApiKey: "SUPER_SECRET_SENTINEL",
          embeddingsProvider: "mistral",
          embeddingsApiKey: "SUPER_SECRET_SENTINEL",
        },
      },
    },
  };
  return createDeclarativeSettingsCandidateComposition({
    strings: getStrings("pt-PT"),
    configDir: ".obsidian",
    runtimeHost: {
      getSnapshot: () => snapshot,
      replaceSnapshot(next) { snapshot = next as typeof snapshot; },
      async saveSnapshot() {},
      getCurrentDeviceId: () => "device",
      async runEffect() {},
    },
    runtimeOptions: { globalDefaults: { autoUpdateIndexOnFileChanges: false, maxSuggestedTags: 8, maxInboxNotesToAnalyze: 10, hybridSearchTextWeight: 0.7, hybridSearchSemanticWeight: 0.3, interfaceLanguage: "pt-PT" } },
    lifecycle: { requestHostUpdate() {}, scheduleUpdate() {} },
    connectionCredentials: {
      connectionPorts: { async testAnalysisConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; }, async testEmbeddingsConnection() { return { outcome: "success" as const, messageKey: "connection-success" as const }; } },
      credentialStatus: { getAvailability() { return { required: true, available: true }; } },
      credentialMutations: { async save() { return { ok: true, available: true }; }, async clear() { return { ok: true, available: false }; } },
      getConnectionConfiguration: (domain) => ({ provider: "mistral", model: domain === "analysis" ? "mistral-small" : "mistral-embed", baseUrl: "https://api.mistral.ai", timeout: "60", credentialAvailable: false }),
      getCredentialRef: (domain) => ({ deviceId: "device", domain }),
      confirmCredentialClear: async () => true,
    },
    binary: {
      getCurrentStatus: () => ({ status: "absent" as const }),
      check: async () => ({ status: "valid" as const }),
      createOrUpdate: async () => ({ status: "valid" as const }),
      remove: async () => undefined,
      confirmRemove: async () => true,
      getReadPreference: () => "jsonl" as const,
      getMaintainBinaryCopy: () => false,
    },
  });
}

/** Captures real candidate definitions and invokes render construction only; registered callbacks are never called. */
export function captureDeclarativeSettingsParityManifest(): DeclarativeSettingsParityManifest {
  const candidate = createCandidateFixture();
  try {
    const groupById = new Map(candidate.groups.flatMap((group) => group.items.map((item) => [item.id, group])));
    return {
      groups: candidate.groups.map((group) => ({ id: group.id, heading: group.heading })),
      items: candidate.definitions.map((definition, ordinal) => {
        const group = groupById.get(definition.id);
        if (!group) throw new Error(`Candidate definition without blueprint group: ${definition.id}`);
        return {
          id: definition.id,
          ordinal,
          group: group.id,
          heading: group.heading,
          visible: typeof definition.visible === "function" ? definition.visible() : definition.visible !== false,
          units: recordRenderedDefinition(definition),
        };
      }),
    };
  } finally {
    candidate.dispose();
  }
}
