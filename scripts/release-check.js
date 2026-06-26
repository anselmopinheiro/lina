const fs = require("fs");
const path = require("path");

const root = process.cwd();

function fail(msg) {
  console.error("RELEASE BLOCKED:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("OK:", msg);
}

// 1. Check manifest.json exists and is valid JSON
const manifestPath = path.join(root, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  fail("manifest.json missing");
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  fail("manifest.json is not valid JSON");
}

ok("manifest.json exists and is valid");

// 2. Check manifest has a version
if (!manifest.version) {
  fail("manifest.json missing version");
}

ok(`version = ${manifest.version}`);

// 3. Check required release assets (only what Obsidian downloads)
const required = ["manifest.json", "main.js", "styles.css"];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  fail(`missing required release files: ${missing.join(", ")}`);
}

ok("all required release files exist");

// 4. Final OK
console.log("\nREADY FOR OBSIDIAN RELEASE");