/**
 * A minimal fake Obsidian App for testing index-related functions.
 * Only provides what indexStore.ts uses: app.vault.adapter and app.vault.configDir.
 */

import { FakeAdapter } from "./fakeAdapter";

export class FakeVault {
  adapter: FakeAdapter;
  configDir: string;

  constructor(adapter: FakeAdapter, configDir = ".obsidian") {
    this.adapter = adapter;
    this.configDir = configDir;
  }
}

export class FakeApp {
  vault: FakeVault;

  constructor(adapter?: FakeAdapter, configDir?: string) {
    this.vault = new FakeVault(
      adapter ?? new FakeAdapter(),
      configDir ?? ".obsidian"
    );
  }

  /** Convenience to get the adapter */
  get adapter(): FakeAdapter {
    return this.vault.adapter;
  }
}