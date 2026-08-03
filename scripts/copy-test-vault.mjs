import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifacts = ["main.js", "manifest.json", "styles.css"];
const targetDirectory = process.env.LINA_TEST_PLUGIN_DIR?.trim();

if (!targetDirectory) {
  console.log("Local test-vault installation skipped (LINA_TEST_PLUGIN_DIR is not set).");
  process.exit(0);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinationDirectory = resolve(targetDirectory);

try {
  for (const artifact of artifacts) {
    const sourcePath = resolve(repositoryRoot, artifact);
    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isFile()) {
      throw new Error(`Required build artifact is not a file: ${artifact}`);
    }
  }

  await mkdir(destinationDirectory, { recursive: true });

  for (const artifact of artifacts) {
    await copyFile(resolve(repositoryRoot, artifact), resolve(destinationDirectory, artifact));
    console.log(`Copied ${artifact}`);
  }

  console.log(`Local test-vault installation completed: ${destinationDirectory}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Local test-vault installation failed: ${message}`);
  process.exit(1);
}
