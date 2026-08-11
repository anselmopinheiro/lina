export type ImperativeControlKind = "text" | "textarea" | "dropdown" | "toggle" | "button";

export interface ImperativeSettingControlManifest {
  kind: ImperativeControlKind;
  disabled?: boolean;
  destructive?: boolean;
  inputType?: string;
  hasInitialValue?: boolean;
  hasPlaceholder?: boolean;
  hasOnChange?: boolean;
  hasOnClick?: boolean;
  label?: string;
}

export interface ImperativeSettingManifestItem {
  ordinal: number;
  kind: "heading" | "setting" | "content";
  section?: string;
  name?: string;
  description?: string;
  text?: string;
  visible: true;
  controlKinds: ImperativeControlKind[];
  controls: ImperativeSettingControlManifest[];
}

export interface ImperativeSettingsManifest {
  items: ImperativeSettingManifestItem[];
}

interface MutableItem extends Omit<ImperativeSettingManifestItem, "controls" | "controlKinds"> {
  controls: ImperativeSettingControlManifest[];
}

interface HarnessElement {
  createEl: (tag: string, options?: Record<string, unknown>) => HarnessElement;
  createSpan: (options?: Record<string, unknown>) => HarnessElement;
  setText: (value: string) => void;
  addClass: (value: string) => void;
  removeClass: (value: string) => void;
}

function createElement(onText?: (value: string) => void): HarnessElement {
  return {
    createEl: (_tag, options) => {
      if (typeof options?.text === "string") onText?.(options.text);
      return createElement(onText);
    },
    createSpan: (options) => {
      if (typeof options?.text === "string") onText?.(options.text);
      return createElement(onText);
    },
    setText(value: string) { onText?.(value); },
    addClass() {},
    removeClass() {},
  };
}

export class ImperativeSettingsParityHarness {
  private readonly itemBySetting = new WeakMap<object, MutableItem>();
  private readonly items: MutableItem[] = [];
  private currentSection: string | undefined;

  createContainer(): { empty: () => void; createEl: HarnessElement["createEl"] } {
    return {
      empty: () => {},
      createEl: (tag, options) => {
        if (tag !== "p") return createElement();
        let text = "";
        let item: MutableItem | undefined;
        const appendText = (value: string): void => {
          text += value;
          if (!text.trim()) return;
          item ??= this.createContentItem();
          item.text = text;
        };
        if (typeof options?.text === "string") appendText(options.text);
        return createElement(appendText);
      },
    };
  }

  setName(setting: object, name: string): void {
    this.ensureItem(setting).name = name;
  }

  setDescription(setting: object, description: string): void {
    this.ensureItem(setting).description = description;
  }

  setHeading(setting: object): void {
    const item = this.ensureItem(setting);
    item.kind = "heading";
    item.section = item.name;
    this.currentSection = item.name;
  }

  addControl(setting: object, kind: ImperativeControlKind): number {
    const item = this.ensureItem(setting);
    item.controls.push({ kind });
    return item.controls.length - 1;
  }

  markInitialValue(setting: object, index: number): void {
    this.control(setting, index).hasInitialValue = true;
  }

  markPlaceholder(setting: object, index: number): void {
    this.control(setting, index).hasPlaceholder = true;
  }

  markInputType(setting: object, index: number, inputType: string): void {
    this.control(setting, index).inputType = inputType;
  }

  markOnChange(setting: object, index: number): void {
    this.control(setting, index).hasOnChange = true;
  }

  markOnClick(setting: object, index: number): void {
    this.control(setting, index).hasOnClick = true;
  }

  markDisabled(setting: object, index: number, disabled: boolean): void {
    this.control(setting, index).disabled = disabled;
  }

  markDestructive(setting: object, index: number): void {
    this.control(setting, index).destructive = true;
  }

  markButtonText(setting: object, index: number, label: string): void {
    this.control(setting, index).label = label;
  }

  snapshot(): ImperativeSettingsManifest {
    return {
      items: this.items.map((item) => ({
        ordinal: item.ordinal,
        kind: item.kind,
        ...(item.section ? { section: item.section } : {}),
        ...(item.name ? { name: item.name } : {}),
        ...(item.description ? { description: item.description } : {}),
        ...(item.text ? { text: item.text } : {}),
        visible: true,
        controlKinds: item.controls.map((control) => control.kind),
        controls: item.controls.map((control) => ({ ...control })),
      })),
    };
  }

  private ensureItem(setting: object): MutableItem {
    const existing = this.itemBySetting.get(setting);
    if (existing) return existing;
    const item: MutableItem = {
      ordinal: this.items.length,
      kind: "setting",
      ...(this.currentSection ? { section: this.currentSection } : {}),
      visible: true,
      controls: [],
    };
    this.itemBySetting.set(setting, item);
    this.items.push(item);
    return item;
  }

  private createContentItem(): MutableItem {
    const item: MutableItem = {
      ordinal: this.items.length,
      kind: "content",
      ...(this.currentSection ? { section: this.currentSection } : {}),
      visible: true,
      controls: [],
    };
    this.items.push(item);
    return item;
  }

  private control(setting: object, index: number): ImperativeSettingControlManifest {
    const control = this.ensureItem(setting).controls[index];
    if (!control) throw new Error("Unknown imperative settings control.");
    return control;
  }
}
