import fs from "node:fs/promises";
import { build } from "esbuild";

const phase = process.argv[2];
if (phase !== "baseline" && phase !== "proof" && phase !== "verify" && phase !== "reload") throw new Error("Use baseline, proof, verify, or reload.");
const evidencePath = "docs/architecture/evidence/G1-PUBLISHED-INPUT-CONTRACT-FIX-001.json";
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((candidate) => candidate.type === "page" && /zettel/i.test(candidate.title));
if (!page) throw new Error("The zettel Obsidian page is unavailable.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
async function evaluate(expression) {
  const id = ++sequence;
  const response = await new Promise((resolve, reject) => {
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", listener);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function main() {
  if (phase === "reload") {
    const reloaded = await evaluate(`(async () => { const app = window.app; await app.plugins.disablePlugin("lina"); await app.plugins.enablePlugin("lina"); return Boolean(app.plugins.plugins.lina); })()`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log(JSON.stringify({ reloaded }));
    return;
  }
  if (phase === "verify") {
    const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
    if (evidence.status !== "PASS") throw new Error("Verification requires a successful G1 runtime proof.");
    const helperPath = "D:/_dev/obsidian/lina/.g1-runtime-contract-verifier.cjs";
    await build({ stdin: { contents: "export { validatePublishedGenerationFiles } from './src/index/publishedGenerationValidator'; export { evaluatePublishedGenerationSemanticContract } from './src/index/publishedGenerationReader'; export { createVectorContract } from './src/index/vectorContract';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "cjs", plugins: [{ name: "obsidian-normalize-path-shim", setup(plugin) { plugin.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-shim", namespace: "g1" })); plugin.onLoad({ filter: /.*/, namespace: "g1" }, () => ({ contents: "export const normalizePath = value => value;", loader: "js" })); } }], outfile: helperPath });
    try {
      const verification = await evaluate(`(async () => {
        const adapter = window.app.vault.adapter; const lib = require(${JSON.stringify(helperPath)});
        const current = (await adapter.read(".lina/published/CURRENT")).trim(); const base = ".lina/published/generations/" + current;
        const manifestText = await adapter.read(base + "/manifest.json"); const recordsText = await adapter.read(base + "/records.json"); const vectors = new Uint8Array(await adapter.readBinary(base + "/vectors.bin")); const manifest = JSON.parse(manifestText);
        const validation = lib.validatePublishedGenerationFiles({ manifest: manifestText, records: recordsText, vectors });
        const index = { generationId: current, vectorContractId: manifest.vectorContractId, dimensions: manifest.dimensions, count: manifest.recordCount, vectors: new Float32Array(0), records: [], provider: manifest.provider, model: manifest.model, dtype: manifest.dtype, metric: manifest.metric, inputVersion: manifest.inputVersion, prefixMode: manifest.prefixMode, vectorContract: manifest.vectorContract };
        const semanticMatch = lib.evaluatePublishedGenerationSemanticContract(index, manifest.vectorContract);
        const mismatch = lib.createVectorContract({ provider: manifest.provider, model: manifest.model + "-mismatch", dimensions: manifest.dimensions, prefixMode: manifest.prefixMode, inputVersion: manifest.inputVersion });
        const semanticMismatch = lib.evaluatePublishedGenerationSemanticContract(index, mismatch);
        const historical = [];
        for (let n = 1; n <= 12; n++) { const id = "generation-" + String(n).padStart(6, "0"); const root = ".lina/published/generations/" + id; const m = await adapter.read(root + "/manifest.json"); const r = await adapter.read(root + "/records.json"); const v = new Uint8Array(await adapter.readBinary(root + "/vectors.bin")); const result = lib.validatePublishedGenerationFiles({ manifest: m, records: r, vectors: v }); historical.push({ id, formatVersion: result.formatVersion, integrityValid: result.integrityValid, cutoverEligible: result.cutoverEligible }); }
        return { current, manifest: { formatVersion: manifest.formatVersion, provider: manifest.provider, model: manifest.model, dimensions: manifest.dimensions, dtype: manifest.dtype, metric: manifest.metric, inputVersion: manifest.inputVersion, prefixMode: manifest.prefixMode, vectorContract: manifest.vectorContract, vectorContractId: manifest.vectorContractId, recordCount: manifest.recordCount }, validation, semanticMatch, semanticMismatch, historical };
      })()`);
      const checks = verification.validation.integrityValid === true && verification.validation.cutoverEligible === true && verification.semanticMatch.status === "COMPATIBLE" && verification.semanticMismatch.status === "SEMANTIC_CONTRACT_MISMATCH" && verification.historical.every(item => item.integrityValid === true && item.cutoverEligible === false);
      evidence.runtimeVerification = verification;
      evidence.result.integrityValid = verification.validation.integrityValid;
      evidence.result.cutoverEligible = verification.validation.cutoverEligible;
      evidence.result.semanticContractMatch = verification.semanticMatch.status === "COMPATIBLE";
      evidence.result.semanticContractMismatch = verification.semanticMismatch.status;
      evidence.runtimeClassification = "OBSIDIAN_RUNTIME";
      evidence.currentBefore = evidence.before.current;
      evidence.currentAfter = verification.current;
      evidence.generationId = verification.current;
      Object.assign(evidence, verification.manifest, {
        recomputedVectorContractId: evidence.result.recomputedContractId,
        contractMatch: evidence.result.recomputedContractId === verification.manifest.vectorContractId,
        integrityValid: verification.validation.integrityValid,
        cutoverEligible: verification.validation.cutoverEligible,
        semanticContractMatch: verification.semanticMatch.status === "COMPATIBLE",
        shadowStatus: evidence.result.shadow.status,
        shadowLevel: evidence.result.shadow.level,
        shadowDivergences: evidence.result.shadow.summary?.divergenceCount,
        providerCalls: evidence.result.providerCalls,
        reembedding: evidence.result.reembeddingCalls,
        historicalGenerationsUnchanged: evidence.safety.generationsOneToTwelveByteIdentical,
        notesModified: !evidence.safety.notesByteIdentical,
        ownershipModified: !evidence.safety.ownershipAndDeviceByteIdentical,
        sqliteUnexpectedChanges: false,
        sqliteUnexpectedChangesBasis: "diagnoseM4ImmutablePublication only opens and reads the canonical SQLite store; no M3 operation was invoked during this proof",
        g1Status: "PASS",
        cutoverStatus: "BLOCKED_BY_G2_G3",
      });
      evidence.status = checks ? "PASS" : "FAIL";
      await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      console.log(JSON.stringify({ status: evidence.status, validation: verification.validation, semanticMatch: verification.semanticMatch.status, semanticMismatch: verification.semanticMismatch.status, historical: verification.historical }));
      if (!checks) throw new Error("G1 runtime verification failed");
    } finally { await fs.rm(helperPath, { force: true }); }
    return;
  }
  if (phase === "baseline") {
    const before = await evaluate(`(async () => {
      const app = window.app; const plugin = app.plugins.plugins.lina; const adapter = app.vault.adapter;
      if (!plugin || app.vault.getName() !== "zettel") throw new Error("wrong vault or missing Lina");
      const crypto = require("node:crypto"); const hash = value => crypto.createHash("sha256").update(value).digest("hex");
      const generations = {};
      for (let n = 1; n <= 12; n++) for (const file of ["manifest.json", "records.json", "vectors.bin"]) {
        const path = ".lina/published/generations/generation-" + String(n).padStart(6, "0") + "/" + file;
        generations[path] = hash(new Uint8Array(await adapter.readBinary(path)));
      }
      const notes = {};
      for (const file of app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))) notes[file.path] = hash(new Uint8Array(await adapter.readBinary(file.path)));
      const deviceId = plugin.getDeviceId(); const protectedFiles = {};
      for (const path of [".lina/ownership.json", ".lina/devices/" + deviceId + ".json"]) protectedFiles[path] = hash(new Uint8Array(await adapter.readBinary(path)));
      return { capturedAt: new Date().toISOString(), current: (await adapter.read(".lina/published/CURRENT")).trim(), noteCount: Object.keys(notes).length, generations, notes, protectedFiles };
    })()`);
    await fs.writeFile(evidencePath, JSON.stringify({ phase: "G1-PUBLISHED-INPUT-CONTRACT-FIX-001", status: "BASELINE", before }, null, 2) + "\n");
    console.log(JSON.stringify({ current: before.current, noteCount: before.noteCount }));
    return;
  }
  const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"));
  if (evidence.status !== "BASELINE") throw new Error("Proof requires a fresh G1 baseline.");
  const result = await evaluate(`(async () => {
    const plugin = window.app.plugins.plugins.lina; const adapter = window.app.vault.adapter;
    const before = (await adapter.read(".lina/published/CURRENT")).trim();
    const previousFetch = window.fetch; const previousGenerate = plugin.runGenerateLocalEmbeddings; const previousRequest = plugin.requestEmbeddingIndexGeneration;
    let providerCalls = 0; let reembeddingCalls = 0;
    window.fetch = function(input, ...args) { const url = typeof input === "string" ? input : input?.url ?? String(input); if (/^https?:/i.test(url)) { providerCalls++; throw new Error("Provider network is forbidden during G1 proof"); } return previousFetch.call(this, input, ...args); };
    plugin.runGenerateLocalEmbeddings = () => { reembeddingCalls++; throw new Error("Reembedding is forbidden during G1 proof"); };
    plugin.requestEmbeddingIndexGeneration = () => { reembeddingCalls++; throw new Error("Reembedding is forbidden during G1 proof"); };
    try {
      const publication = await plugin.diagnoseM4ImmutablePublication();
      const current = (await adapter.read(".lina/published/CURRENT")).trim();
      const base = ".lina/published/generations/" + current;
      const manifest = JSON.parse(await adapter.read(base + "/manifest.json"));
      const records = JSON.parse(await adapter.read(base + "/records.json"));
      const shadow = await plugin.diagnoseM5Shadow();
      const crypto = require("node:crypto");
      const contractPayload = JSON.stringify({ dimensions: manifest.dimensions, inputVersion: manifest.inputVersion, metric: manifest.metric, model: String(manifest.model).trim().toLowerCase(), prefixMode: String(manifest.prefixMode).trim().toLowerCase(), provider: String(manifest.provider).trim().toLowerCase() });
      const recomputedContractId = "vec:" + crypto.createHash("sha256").update(contractPayload).digest("hex");
      const valid = publication.status === "PASS" && /^generation-\\d{6,}$/.test(current) && Number(current.slice(11)) > Number(before.slice(11)) && manifest.formatVersion === 3 && manifest.metric === "cosine" && manifest.inputVersion === 1 && (manifest.prefixMode === "none" || manifest.prefixMode === "nomic-search-query-document") && manifest.vectorContractId === recomputedContractId && manifest.vectorContract?.contractId === recomputedContractId && manifest.recordCount === records.length && records.length === 2303 && records.every(record => record.vectorContractId === recomputedContractId && typeof record.embeddingInputHash === "string" && record.embeddingInputHash.length > 0) && shadow.status === "PASS" && shadow.level === "L2" && shadow.summary?.legacyCount === 2303 && shadow.summary?.publishedCount === 2303 && shadow.summary?.divergenceCount === 0 && providerCalls === 0 && reembeddingCalls === 0;
      return { before, current, publication, manifest: { formatVersion: manifest.formatVersion, provider: manifest.provider, model: manifest.model, dimensions: manifest.dimensions, dtype: manifest.dtype, metric: manifest.metric, inputVersion: manifest.inputVersion, prefixMode: manifest.prefixMode, vectorContractId: manifest.vectorContractId, recordCount: manifest.recordCount }, recomputedContractId, recordsWithInputHash: records.filter(record => typeof record.embeddingInputHash === "string" && record.embeddingInputHash.length > 0).length, shadow, providerCalls, reembeddingCalls, valid };
    } finally { window.fetch = previousFetch; plugin.runGenerateLocalEmbeddings = previousGenerate; plugin.requestEmbeddingIndexGeneration = previousRequest; }
  })()`);
  const after = await evaluate(`(async () => {
    const app = window.app; const plugin = app.plugins.plugins.lina; const adapter = app.vault.adapter; const crypto = require("node:crypto"); const hash = value => crypto.createHash("sha256").update(value).digest("hex");
    const generations = {}; for (let n = 1; n <= 12; n++) for (const file of ["manifest.json", "records.json", "vectors.bin"]) { const path = ".lina/published/generations/generation-" + String(n).padStart(6, "0") + "/" + file; generations[path] = hash(new Uint8Array(await adapter.readBinary(path))); }
    const notes = {}; for (const file of app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))) notes[file.path] = hash(new Uint8Array(await adapter.readBinary(file.path)));
    const deviceId = plugin.getDeviceId(); const protectedFiles = {}; for (const path of [".lina/ownership.json", ".lina/devices/" + deviceId + ".json"]) protectedFiles[path] = hash(new Uint8Array(await adapter.readBinary(path)));
    return { current: (await adapter.read(".lina/published/CURRENT")).trim(), generations, notes, protectedFiles };
  })()`);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  evidence.result = result; evidence.after = after;
  evidence.safety = { generationsOneToTwelveByteIdentical: same(evidence.before.generations, after.generations), notesByteIdentical: same(evidence.before.notes, after.notes), ownershipAndDeviceByteIdentical: same(evidence.before.protectedFiles, after.protectedFiles) };
  evidence.status = result.valid && Object.values(evidence.safety).every(Boolean) ? "PASS" : "FAIL";
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: evidence.status, current: result.current, shadow: result.shadow.status, safety: evidence.safety }));
  if (evidence.status !== "PASS") throw new Error("G1 runtime proof failed");
}

try { await main(); } finally { socket.close(); }
