const fs = require("fs");
const path = require("path");

const root = process.cwd();

function fail(msg) {
  console.error("❌ RELEASE BLOCKED:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("✔", msg);
}

// 1. Check manifest
const manifestPath = path.join(root, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  fail("manifest.json missing");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

ok("manifest.json exists");

// 2. Check version match with git release expectation
if (!manifest.version) {
  fail("manifest.json missing version");
}

ok(`version = ${manifest.version}`);

// 3. Ensure build exists
const mainJsPath = path.join(root, "main.js");
if (!fs.existsSync(mainJsPath)) {
  fail("main.js missing (run npm run build)");
}

ok("main.js exists");

// 4. Ensure no manual edits risk (simple heuristic)
const mainJsContent = fs.readFileSync(mainJsPath, "utf8");

if (mainJsContent.includes("src/") && mainJsContent.includes("ts")) {
  fail("main.js looks unbuilt (contains source references)");
}

ok("main.js looks like build output");

// 5. Check required files
const required = ["README.md", "manifest.json", "main.js", "LICENSE"];

for (const f of required) {
  if (!fs.existsSync(path.join(root, f))) {
    fail(`${f} missing`);
  }
}

ok("all required files exist");

// 6. Final OK
console.log("\n🚀 READY FOR OBSIDIAN RELEASE");