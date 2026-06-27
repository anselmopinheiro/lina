/**
 * bump-version.js — Script seguro para incrementar versão do plugin Lina.
 *
 * Uso:
 *   node scripts/bump-version.js patch       # 0.1.3 -> 0.1.4
 *   node scripts/bump-version.js minor       # 0.1.3 -> 0.2.0
 *   node scripts/bump-version.js major       # 0.1.3 -> 1.0.0
 *   node scripts/bump-version.js 0.1.4       # versão explícita
 *
 * Atualiza: manifest.json, package.json, package-lock.json, versions.json.
 * Não cria tag, release, commit ou push.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const LOCK_PATH = path.join(ROOT, "package-lock.json");
const VERSIONS_PATH = path.join(ROOT, "versions.json");
const GIT_DIR = path.join(ROOT, ".git");

// --- Helpers ---

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function semverParts(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function checkCleanWorkingTree() {
  // Verifica se existe .git para validar working tree
  if (fs.existsSync(GIT_DIR)) {
    const { execSync } = require("child_process");
    try {
      const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
      if (status.length > 0) {
        console.error("Erro: working tree tem alterações pendentes. Faz commit ou stash antes de bump.");
        process.exit(1);
      }
    } catch (error) {
      console.error("Erro: não foi possível confirmar se a working tree está limpa.");
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

function checkCoherence() {
  const manifest = readJSON(MANIFEST_PATH);
  const pkg = readJSON(PACKAGE_PATH);
  const lock = fs.existsSync(LOCK_PATH) ? readJSON(LOCK_PATH) : null;

  const versions = [manifest.version, pkg.version];
  if (lock) {
    versions.push(lock.version);
    if (lock.packages && lock.packages[""]) {
      versions.push(lock.packages[""].version);
    }
  }

  const unique = [...new Set(versions)];
  if (unique.length > 1) {
    console.error("Erro: versões incoerentes entre ficheiros:", unique.join(", "));
    process.exit(1);
  }

  return { manifest, pkg, lock, currentVersion: unique[0] };
}

function computeNewVersion(current, arg) {
  // Versão explícita
  if (semverParts(arg)) {
    return arg;
  }

  // Incremento semver
  const parts = semverParts(current);
  if (!parts) {
    console.error("Erro: versão atual inválida:", current);
    process.exit(1);
  }

  switch (arg) {
    case "patch":
      return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
    case "minor":
      return `${parts.major}.${parts.minor + 1}.0`;
    case "major":
      return `${parts.major + 1}.0.0`;
    default:
      return null;
  }
}

// --- Main ---

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: node scripts/bump-version.js <patch|minor|major|x.y.z>");
    process.exit(1);
  }

  checkCleanWorkingTree();

  const { manifest, pkg, lock, currentVersion } = checkCoherence();
  const newVersion = computeNewVersion(currentVersion, arg);

  if (!newVersion) {
    console.error("Erro: argumento inválido '" + arg + "'. Usa patch, minor, major ou versão x.y.z.");
    process.exit(1);
  }

  if (!semverParts(newVersion)) {
    console.error("Erro: versão inválida '" + newVersion + "'. Formato esperado: x.y.z.");
    process.exit(1);
  }

  const minAppVersion = manifest.minAppVersion;
  if (typeof minAppVersion !== "string" || minAppVersion.trim().length === 0) {
    console.error("Erro: manifest.json não tem minAppVersion válido.");
    process.exit(1);
  }

  // Verifica se a versão já existe em versions.json
  let versions = {};
  if (fs.existsSync(VERSIONS_PATH)) {
    versions = readJSON(VERSIONS_PATH);
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
      console.error("Erro: versions.json deve conter um objeto JSON.");
      process.exit(1);
    }
    if (versions[newVersion]) {
      console.error("Erro: a versão " + newVersion + " já existe em versions.json.");
      process.exit(1);
    }
  }

  // --- Atualiza ficheiros ---

  // manifest.json
  manifest.version = newVersion;
  writeJSON(MANIFEST_PATH, manifest);
  console.log("manifest.json: " + currentVersion + " -> " + newVersion);

  // package.json
  pkg.version = newVersion;
  writeJSON(PACKAGE_PATH, pkg);
  console.log("package.json: " + currentVersion + " -> " + newVersion);

  // package-lock.json
  if (lock) {
    lock.version = newVersion;
    if (lock.packages && lock.packages[""]) {
      lock.packages[""].version = newVersion;
    }
    writeJSON(LOCK_PATH, lock);
    console.log("package-lock.json: " + currentVersion + " -> " + newVersion);
  }

  // versions.json
  versions[newVersion] = minAppVersion;
  writeJSON(VERSIONS_PATH, versions);
  console.log("versions.json: entrada '" + newVersion + "' -> '" + minAppVersion + "' adicionada.");

  console.log("\nBump concluído. Versão atual: " + currentVersion + " -> " + newVersion);
  console.log("Próximos passos recomendados:");
  console.log("  npm ci");
  console.log("  npm run typecheck");
  console.log("  npm run build");
  console.log("  npm run release-check");
  console.log("  git diff --check");
  console.log("  git add -A && git commit -m \"chore: bump version to " + newVersion + "\"");
  console.log("  git tag " + newVersion);
  console.log("  git push origin master && git push origin " + newVersion);
}

main();
