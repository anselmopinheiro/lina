import fs from "node:fs/promises";

const evidencePath = "docs/architecture/evidence/G2-SOURCE-GENERATION-LINK-FIX-001.json";
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((candidate) => candidate.type === "page" && /zettel/i.test(candidate.title));
if (!page) throw new Error("The zettel Obsidian page is unavailable.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
async function evaluate(expression) {
  const id = ++sequence;
  const response = await new Promise((resolve, reject) => {
    const listener = (event) => { const message = JSON.parse(event.data); if (message.id !== id) return; socket.removeEventListener("message", listener); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); };
    socket.addEventListener("message", listener); socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
try {
  const baseline = await evaluate(`(async () => { const a = window.app.vault.adapter; const crypto = require("node:crypto"); const hash = async p => crypto.createHash("sha256").update(new Uint8Array(await a.readBinary(p))).digest("hex"); const generations = {}; for (let n = 1; n <= 13; n++) for (const f of ["manifest.json", "records.json", "vectors.bin"]) { const p = ".lina/published/generations/generation-" + String(n).padStart(6, "0") + "/" + f; generations[p] = await hash(p); } return { current: (await a.read(".lina/published/CURRENT")).trim(), generations }; })()`);
  const proof = await evaluate(`(async () => { const plugin = window.app.plugins.plugins.lina; const a = window.app.vault.adapter; const before = (await a.read(".lina/published/CURRENT")).trim(); const fetch0 = window.fetch; const generate0 = plugin.runGenerateLocalEmbeddings; const request0 = plugin.requestEmbeddingIndexGeneration; let providerCalls = 0; let reembeddingCalls = 0; window.fetch = function(input, ...args) { const url = typeof input === "string" ? input : input?.url ?? String(input); if (/^https?:/i.test(url)) { providerCalls++; throw new Error("network forbidden"); } return fetch0.call(this, input, ...args); }; plugin.runGenerateLocalEmbeddings = () => { reembeddingCalls++; throw new Error("reembedding forbidden"); }; plugin.requestEmbeddingIndexGeneration = () => { reembeddingCalls++; throw new Error("reembedding forbidden"); }; try { const publication = await plugin.diagnoseM4ImmutablePublication(); const current = (await a.read(".lina/published/CURRENT")).trim(); const base = ".lina/published/generations/" + current; const manifest = JSON.parse(await a.read(base + "/manifest.json")); const records = JSON.parse(await a.read(base + "/records.json")); const shadow = await plugin.diagnoseM5Shadow(); return { before, current, publication, manifest, recordCount: records.length, shadow, providerCalls, reembeddingCalls }; } finally { window.fetch = fetch0; plugin.runGenerateLocalEmbeddings = generate0; plugin.requestEmbeddingIndexGeneration = request0; } })()`);
  const after = await evaluate(`(async () => { const a = window.app.vault.adapter; const crypto = require("node:crypto"); const hash = async p => crypto.createHash("sha256").update(new Uint8Array(await a.readBinary(p))).digest("hex"); const generations = {}; for (let n = 1; n <= 13; n++) for (const f of ["manifest.json", "records.json", "vectors.bin"]) { const p = ".lina/published/generations/generation-" + String(n).padStart(6, "0") + "/" + f; generations[p] = await hash(p); } return { current: (await a.read(".lina/published/CURRENT")).trim(), generations }; })()`);
  const m = proof.manifest;
  const valid = proof.publication.status === "PASS" && proof.current === "generation-000014" && m.formatVersion === 4 && m.recordCount === 2303 && proof.recordCount === 2303 && typeof m.sourceTextGenerationId === "string" && typeof m.sourceChunksDigest === "string" && typeof m.sourcePublicationId === "string" && m.sourceRecordCount === 2303 && proof.shadow.status === "PASS" && proof.shadow.level === "L2" && proof.shadow.summary?.divergenceCount === 0 && proof.providerCalls === 0 && proof.reembeddingCalls === 0 && JSON.stringify(baseline.generations) === JSON.stringify(after.generations);
  const evidence = { phase: "G2-SOURCE-GENERATION-LINK-FIX-001", status: valid ? "PASS" : "FAIL", baseline, proof, after, safety: { generationsOneToThirteenByteIdentical: JSON.stringify(baseline.generations) === JSON.stringify(after.generations) } };
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: evidence.status, current: proof.current, formatVersion: m.formatVersion, sourceTextGenerationId: m.sourceTextGenerationId, sourceRecordCount: m.sourceRecordCount, shadow: proof.shadow.status, providerCalls: proof.providerCalls, reembeddingCalls: proof.reembeddingCalls }));
  if (!valid) throw new Error("G2 runtime proof failed");
} finally { socket.close(); }
