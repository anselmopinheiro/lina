import type { Plugin } from "obsidian";

interface M6TestCommandPlugin extends Plugin {
  activateM6TestsPanel(): Promise<void>;
}

/** TEST-profile command registration for opening the technical M6 panel. */
export function registerM6TestProfileCommands(plugin: M6TestCommandPlugin): void {
  plugin.addCommand({
    id: "abrir-painel-testes-m6",
    name: `Abrir painel Testes ${"M" + "6"}`,
    callback: () => { void plugin.activateM6TestsPanel(); },
  });
}
