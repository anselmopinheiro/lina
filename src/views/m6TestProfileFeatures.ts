import type { Plugin } from "obsidian";
import { M6_TESTS_PANEL_VIEW_TYPE, M6TestsPanelView, type M6TestsPanelHost } from "./m6TestsPanelView";

type M6TestProfilePlugin = Plugin & M6TestsPanelHost;

/** TEST-profile wiring for the technical M6 panel. */
export function registerM6TestProfileFeatures(plugin: M6TestProfilePlugin): void {
  plugin.registerView(M6_TESTS_PANEL_VIEW_TYPE, (leaf) => new M6TestsPanelView(leaf, plugin));
}

export async function activateM6TestProfilePanel(plugin: M6TestProfilePlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(M6_TESTS_PANEL_VIEW_TYPE)[0];
  if (!leaf) {
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) throw new Error("Não foi possível criar painel Testes M6.");
    leaf = rightLeaf;
    await leaf.setViewState({ type: M6_TESTS_PANEL_VIEW_TYPE, active: true });
  }
  await workspace.revealLeaf(leaf);
}
