import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedVaultByProfile = { dev: "zettel", test: "anselmo" };
const defaultDestinationByProfile = {
  dev: "D:\\anselmo\\__obsidian__\\zettel\\.obsidian\\plugins\\lina",
  test: "D:\\anselmo\\__obsidian__\\anselmo\\.obsidian\\plugins\\lina",
};

function normalizedParts(path) {
  return resolve(path).toLowerCase().split(/[\\/]+/).filter(Boolean);
}

export function validateDestination(profile, destination, sourceDirectory) {
  if (!(profile in expectedVaultByProfile)) throw new Error(`Unknown build profile: ${profile}`);
  const destinationParts = normalizedParts(destination);
  const sourceParts = normalizedParts(sourceDirectory);
  const expectedVault = expectedVaultByProfile[profile];
  if (!destinationParts.includes(expectedVault) || !destinationParts.join(sep).endsWith(`${expectedVault}${sep}.obsidian${sep}plugins${sep}lina`)) {
    throw new Error(`Refusing to copy ${profile.toUpperCase()} build into the wrong vault.`);
  }
  if (!sourceParts.join(sep).endsWith(`dist${sep}${profile}`)) {
    throw new Error(`Refusing to copy ${profile.toUpperCase()} build from an invalid source directory.`);
  }
}

export function validateProfileDestinations(destinations) {
  if (resolve(destinations.dev) === resolve(destinations.test)) {
    throw new Error("DEV and TEST build destinations must be different.");
  }
}

export async function copyBuildToVault(profile, destination = defaultDestinationByProfile[profile]) {
  const sourceDirectory = resolve(root, "dist", profile);
  const resolvedDestination = resolve(destination);
  validateProfileDestinations({
    dev: defaultDestinationByProfile.dev,
    test: defaultDestinationByProfile.test,
  });
  validateDestination(profile, resolvedDestination, sourceDirectory);
  await mkdir(resolvedDestination, { recursive: true });
  for (const artifact of ARTIFACTS) {
    const source = resolve(sourceDirectory, artifact);
    if (!(await stat(source)).isFile()) throw new Error(`Required build artifact is not a file: ${artifact}`);
    await copyFile(source, resolve(resolvedDestination, artifact));
  }
  return resolvedDestination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profile = process.argv[2];
  try {
    const destination = await copyBuildToVault(profile);
    console.log(`${profile.toUpperCase()} build installed in ${destination}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
