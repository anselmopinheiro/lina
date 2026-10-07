import { readFileSync } from "node:fs";
import { App, Platform } from "obsidian";
import { describe, expect, it } from "vitest";
import LinaPlugin from "../../main.ts";
import { saveOwnership } from "../../src/device/deviceOwnership";
import { generateDeviceId } from "../../src/device/deviceIdentity";
import { FakeAdapter } from "../helpers/fakeAdapter";

async function createPlugin(): Promise<{ plugin: LinaPlugin; adapter: FakeAdapter }> {
  Platform.isMobile = false;
  (Platform as unknown as { isDesktop: boolean }).isDesktop = true;
  const adapter = new FakeAdapter();
  const app = new App();
  app.vault.adapter = adapter;
  const plugin = new LinaPlugin(app);
  await plugin.loadDataFromDisk();
  return { plugin, adapter };
}

describe("M6 startup diagnostics", () => {
  it("does not schedule M3 canonical or runtime SQLite diagnostics during plugin startup", () => {
    const source = readFileSync("main.ts", "utf8");
    const onload = source.slice(source.indexOf("async onload()"), source.indexOf("this.addRibbonIcon", source.indexOf("async onload()")));
    expect(onload).toMatch(/const runDiagnostics = \(\) => \{\s*\};/);
    expect(onload).not.toContain("diagnoseM3Canonical");
    expect(onload).not.toContain("diagnoseRuntimeSqlite");
  });

  it("rejects M3 on a non-producer without opening producer diagnostics or changing vault data", async () => {
    const { plugin, adapter } = await createPlugin();
    await plugin.assignDeviceRole("companion");
    await adapter.mkdir(".lina/producer");
    const report = await plugin.diagnoseM3Canonical();
    expect(report).toMatchObject({ status: "BLOCKED", reason: "active-producer-required", role: "companion" });
    expect(adapter.hasFile(".lina/producer/m3-canonical-diagnostic.json")).toBe(false);
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("rejects M3 when canonical SQLite is disabled, without forcing the setting", async () => {
    const { plugin, adapter } = await createPlugin();
    await plugin.assignDeviceRole("producer");
    plugin.settings.producerSqliteCanonicalEnabled = false;
    const report = await plugin.diagnoseM3Canonical();
    expect(report).toMatchObject({ status: "BLOCKED", reason: "canonical-mode-disabled" });
    expect(report.flags?.producerSqliteCanonicalEnabled).toBe(false);
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("rejects M3 when ownership does not match the producer", async () => {
    const { plugin, adapter } = await createPlugin();
    await plugin.assignDeviceRole("producer");
    plugin.settings.producerSqliteCanonicalEnabled = true;
    await saveOwnership(adapter, { schemaVersion: 1, activeProducerId: generateDeviceId(), epoch: 1, acquiredAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", reason: "initial" });
    const report = await plugin.diagnoseM3Canonical();
    expect(report).toMatchObject({ status: "BLOCKED", reason: "ownership-fence-rejected" });
    expect(adapter.hasFile(".lina/index/embeddings.jsonl")).toBe(false);
  });

  it("keeps SQLite runtime probing read-only for an unauthorized device", async () => {
    const { plugin, adapter } = await createPlugin();
    await plugin.assignDeviceRole("companion");
    await adapter.mkdir(".lina/producer");
    await plugin.diagnoseRuntimeSqlite();
    expect(adapter.hasFile(".lina/producer/sqlite-runtime-diagnostic.json")).toBe(false);
  });
});
