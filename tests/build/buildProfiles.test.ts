import { describe, expect, it } from "vitest";
import { ARTIFACTS, validateDestination, validateProfileDestinations } from "../../scripts/copy-build-to-vault.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const buildConfig = readFileSync(resolve(process.cwd(), "esbuild.config.mjs"), "utf8");
const mainSource = readFileSync(resolve(process.cwd(), "main.ts"), "utf8");
const releaseCheck = readFileSync(resolve(process.cwd(), "scripts/release-check.js"), "utf8");

describe("dual DEV/TEST build profiles", () => {
  it("maps DEV to zettel and TEST to anselmo through explicit commands", () => {
    expect(packageJson.scripts.build).not.toContain("copy-build-to-vault");
    expect(packageJson.scripts["build:dev"]).toContain("copy-build-to-vault.mjs dev");
    expect(packageJson.scripts["build:test"]).toContain("copy-build-to-vault.mjs test");
    expect(existsSync(resolve(process.cwd(), "scripts/copy-test-vault.mjs"))).toBe(false);
    expect(buildConfig).toContain('resolve("dist", profile)');
  });

  it("refuses swapped, invalid, and equal destinations", () => {
    expect(() => validateDestination("dev", "D:\\anselmo\\__obsidian__\\anselmo\\.obsidian\\plugins\\lina", "dist\\dev")).toThrow("wrong vault");
    expect(() => validateDestination("test", "D:\\anselmo\\__obsidian__\\zettel\\.obsidian\\plugins\\lina", "dist\\test")).toThrow("wrong vault");
    expect(() => validateDestination("dev", "D:\\anselmo\\__obsidian__\\zettel\\.obsidian\\plugins\\lina", "dist\\test")).toThrow("invalid source");
    expect(() => validateProfileDestinations({ dev: "same", test: "same" })).toThrow("must be different");
  });

  it("copies only the three plugin artifacts", () => {
    expect(ARTIFACTS).toEqual(["main.js", "manifest.json", "styles.css"]);
  });

  it("keeps TEST-only registration behind profile-specific modules and blocks release leaks", () => {
    expect(mainSource).toContain('registerM6TestProfileFeatures(this)');
    expect(mainSource).toContain('registerM6TestProfileCommands(this)');
    expect(mainSource).not.toContain('id: "abrir-painel-testes-m6"');
    expect(buildConfig).toContain("exclude-test-profile-features-from-dev");
    expect(releaseCheck).toContain("TEST-only M6 diagnostics leaked into the DEV release bundle");
  });
});
