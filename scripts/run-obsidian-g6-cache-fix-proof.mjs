import fs from 'node:fs/promises';
import { build } from 'esbuild';

const phase = process.argv[2];
if (!['baseline', 'proof'].includes(phase)) throw new Error('Use baseline or proof');
const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = pages.find(p => p.type === 'page' && /zettel/i.test(p.title));
if (!page) throw new Error('zettel page unavailable');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
async function evaluate(expression) {
  const id = ++nextId;
  const response = await new Promise((resolve, reject) => {
    const listener = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', listener);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    };
    ws.addEventListener('message', listener);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function snapshot() {
  const app = window.app;
  if (app.vault.getName() !== 'zettel') throw new Error('Wrong vault');
  const plugin = app.plugins.plugins.lina;
  if (!plugin || plugin.settings.generateEmbeddingsOnStartup || plugin.settings.autoGenerateEmbeddingsOnStartup || plugin.settings.checkSyncOnStartup || plugin.settings.updateIndexOnStartup) throw new Error('Startup flags unsafe');
  const adapter = app.vault.adapter;
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const old = {};
  for (let n = 1; n <= 10; n++) for (const file of ['manifest.json', 'records.json', 'vectors.bin']) {
    const path = '.lina/published/generations/generation-' + String(n).padStart(6, '0') + '/' + file;
    old[path] = hash(new Uint8Array(await adapter.readBinary(path)));
  }
  const notes = {};
  for (const file of app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))) notes[file.path] = hash(new Uint8Array(await adapter.readBinary(file.path)));
  const protectedFiles = {};
  const deviceId = plugin.getDeviceId();
  for (const path of ['.lina/ownership.json', '.lina/devices/' + deviceId + '.json']) protectedFiles[path] = hash(new Uint8Array(await adapter.readBinary(path)));
  const dbPath = 'C:/Users/ansel/AppData/Local/lina/db/lina-producer.db';
  const copy = 'D:/_dev/obsidian/lina/.g6-fix-sqlite-copy.db';
  fs.copyFileSync(dbPath, copy);
  if (fs.existsSync(dbPath + '-wal')) fs.copyFileSync(dbPath + '-wal', copy + '-wal');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(copy, { readOnly: true });
  let sqlite;
  try {
    const rows = db.prepare('SELECT * FROM embedding_records ORDER BY chunk_id').all();
    const vectors = {};
    for (const row of rows) vectors[row.chunk_id] = { vectorHash: hash(row.embedding_blob), inputHash: row.embedding_input_hash };
    sqlite = { integrity: db.prepare('PRAGMA integrity_check').get(), count: rows.length, recordsDigest: hash(JSON.stringify(rows)), spacesDigest: hash(JSON.stringify(db.prepare('SELECT * FROM embedding_spaces ORDER BY space_id').all())), vectors };
  } finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(copy + suffix)) fs.unlinkSync(copy + suffix);
  }
  const jsonl = (await adapter.read('.lina/index/embeddings.jsonl')).trim().split('\n').map(line => JSON.parse(line));
  const canonical = {};
  for (const r of jsonl) canonical[r.chunkId] = { vectorHash: hash(Buffer.from(new Float32Array(r.embedding).buffer)), inputHash: r.embeddingInputHash };
  const binaryMetadata = (await adapter.read('.lina/index/embeddings.meta.jsonl')).trim().split('\n').map(line => JSON.parse(line));
  const binaryBytes = new Uint8Array(await adapter.readBinary('.lina/index/embeddings.vectors.f32'));
  const binary = {};
  for (const r of binaryMetadata) binary[r.chunkId] = { vectorHash: hash(binaryBytes.subarray(r.vectorOrdinal * 4096, (r.vectorOrdinal + 1) * 4096)), inputHash: r.embeddingInputHash };
  const current = (await adapter.read('.lina/published/CURRENT')).trim();
  const publishedBase = '.lina/published/generations/' + current;
  const publishedRecords = JSON.parse(await adapter.read(publishedBase + '/records.json'));
  const publishedBytes = new Uint8Array(await adapter.readBinary(publishedBase + '/vectors.bin'));
  const published = {};
  for (const r of publishedRecords) published[r.chunkId] = { vectorHash: hash(publishedBytes.subarray(r.offsetBytes, r.offsetBytes + 4096)), inputHash: r.embeddingInputHash };
  return { capturedAt: new Date().toISOString(), current, lastDecision: plugin.getOwnershipGate().getLastDecision(), old, notes, protectedFiles, sqlite, canonical, binary, published, noteCount: Object.keys(notes).length };
}

const evidencePath = 'docs/architecture/evidence/G6-BINARY-OWNERSHIP-CACHE-FIX-RUNTIME-001.json';
try {
  if (phase === 'baseline') {
    const before = await evaluate('(' + snapshot.toString() + ')()');
    if (!/^generation-\d{6}$/.test(before.current) || before.sqlite.count !== 2303) throw new Error('Unexpected baseline');
    let previousAttempt;
    try {
      const previous = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
      if (previous.status !== 'FAIL') throw new Error('Only a failed safety attempt may be followed by a new baseline');
      previousAttempt = { status: previous.status, currentBefore: previous.before.current, currentAfter: previous.result.currentAfterDiagnosis, diagnosis: previous.result.diagnosis, safety: previous.safety, beforeSqliteRecordsDigest: previous.before.sqlite.recordsDigest, afterSqliteRecordsDigest: previous.after.sqlite.recordsDigest, explanation: 'The initial reload ran the pre-existing automatic M3 canonical diagnostic, rewriting SQLite metadata and legacy publication identities. Vector/input hashes, old M4 generations and notes were unchanged. The final isolated G6 run uses a settled post-startup baseline.' };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(evidencePath, JSON.stringify({ status: 'BASELINE', before, ...(previousAttempt ? { previousAttempt } : {}) }, null, 2) + '\n');
    console.log(JSON.stringify({ current: before.current, notes: before.noteCount, sqliteCount: before.sqlite.count, cache: before.lastDecision }));
  } else {
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    if (evidence.status !== 'BASELINE') throw new Error('Proof has already run');
    await build({ stdin: { contents: "export { validatePublishedGenerationFiles } from './src/index/publishedGenerationValidator';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: '.g6-fix-validator.cjs' });
    // The deployed plugin must already be reloaded and its startup diagnostics settled.
    // A reload here would race the pre-existing automatic M3 diagnostic/reprojection.
    const result = await evaluate(`(async () => {
      const plugin = window.app.plugins.plugins.lina;
      const adapter = window.app.vault.adapter;
      const gate = plugin.getOwnershipGate();
      const token = await gate.acquireFence({autoClaimIfUnclaimed:false});
      if (!token || !(await gate.assertFence(token))) throw new Error('Authority unavailable');
      const authority = { token, decision: gate.getLastDecision() };
      if (!authority.decision.authorized) throw new Error('Cache not synchronized');
      const previousFetch = window.fetch;
      const previousGenerate = plugin.runGenerateLocalEmbeddings;
      const previousRequest = plugin.requestEmbeddingIndexGeneration;
      let providerCalls = 0, reembeddingCalls = 0;
      window.fetch = function(input, ...args) {
        const url = typeof input === 'string' ? input : input?.url ?? String(input);
        if (/^https?:/i.test(url)) { providerCalls++; throw new Error('HTTP network forbidden during proof'); }
        // Obsidian uses fetch for app://vault reads; those are local filesystem operations.
        return previousFetch.call(this, input, ...args);
      };
      plugin.runGenerateLocalEmbeddings = () => { reembeddingCalls++; throw new Error('Reembedding forbidden during proof'); };
      plugin.requestEmbeddingIndexGeneration = () => { reembeddingCalls++; throw new Error('Embedding generation forbidden during proof'); };
      try {
        const repaired = await plugin.createOrUpdateBinaryEmbeddingCopy();
        const currentAfterRepair = (await adapter.read('.lina/published/CURRENT')).trim();
        if (repaired.status !== 'valid' || currentAfterRepair !== ${JSON.stringify(evidence.before.current)}) throw new Error('Binary repair failed: '+JSON.stringify({repaired,currentAfterRepair}));
        const diagnosis = await plugin.diagnoseG6EmbeddingInputHashBackfill();
        const counts = diagnosis.backfill?.counts;
        if (diagnosis.status !== 'PASS' || diagnosis.binaryStatus !== 'valid' || diagnosis.publishedGenerationStatus !== 'PASS' || diagnosis.equivalenceDivergences !== 0 || diagnosis.providerCalls !== 0 || counts?.ALREADY_PRESENT !== 2303 || counts?.BACKFILLED_VERIFIED !== 0 || Object.entries(counts ?? {}).some(([k,v]) => k !== 'ALREADY_PRESENT' && v !== 0)) throw new Error('Final G6 failed: '+JSON.stringify({ ...diagnosis, backfill: counts }));
        const current = (await adapter.read('.lina/published/CURRENT')).trim();
        const binary = await plugin.checkBinaryEmbeddingCopy();
        const shadow = await plugin.diagnoseM5Shadow();
        if (shadow.status !== 'PASS' || shadow.level !== 'L2' || shadow.generationId !== current || shadow.summary?.legacyCount !== 2303 || shadow.summary?.publishedCount !== 2303 || shadow.summary?.divergenceCount !== 0 || shadow.providerCalls !== 0 || binary.status !== 'valid') throw new Error('Final binary/shadow validation failed');
        const base = '.lina/published/generations/' + current;
        const lib = require('D:/_dev/obsidian/lina/.g6-fix-validator.cjs');
        const validation = lib.validatePublishedGenerationFiles({ manifest: await adapter.read(base+'/manifest.json'), records: await adapter.read(base+'/records.json'), vectors: new Uint8Array(await adapter.readBinary(base+'/vectors.bin')) });
        if (!validation.integrityValid || !validation.cutoverEligible || providerCalls || reembeddingCalls) throw new Error('Format or zero-provider validation failed');
        return { authority, repaired, currentAfterRepair, diagnosis, currentAfterDiagnosis: current, binary, shadow, validation, providerCalls, reembeddingCalls, cacheAfter: gate.getLastDecision() };
      } finally { window.fetch = previousFetch; plugin.runGenerateLocalEmbeddings = previousGenerate; plugin.requestEmbeddingIndexGeneration = previousRequest; }
    })()`);
    // Persist the diagnosis before the additional immutable-data checks.
    evidence.result = result;
    evidence.status = 'RUNTIME_EXECUTED';
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    const after = await evaluate('(' + snapshot.toString() + ')()');
    const normalize = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])])) : value;
    const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
    const safety = {
      oldGenerationsByteIdentical: same(evidence.before.old, after.old),
      notesByteIdentical: same(evidence.before.notes, after.notes),
      ownershipAndDeviceByteIdentical: same(evidence.before.protectedFiles, after.protectedFiles),
      sqliteRecordsIdentical: evidence.before.sqlite.recordsDigest === after.sqlite.recordsDigest,
      sqliteSpacesIdentical: evidence.before.sqlite.spacesDigest === after.sqlite.spacesDigest,
      canonicalVectorsAndInputHashesIdentical: same(evidence.before.canonical, after.canonical),
      sqliteToCanonicalIdentical: same(after.sqlite.vectors, after.canonical),
      sqliteToBinaryIdentical: same(after.sqlite.vectors, after.binary),
      sqliteToPublishedIdentical: same(after.sqlite.vectors, after.published),
    };
    evidence.after = after;
    evidence.safety = safety;
    evidence.status = Object.values(safety).every(Boolean) ? 'PASS' : 'FAIL';
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: evidence.status, current: result.currentAfterDiagnosis, binary: result.binary.status, shadow: result.shadow.status, safety }));
    if (evidence.status !== 'PASS') throw new Error('Safety comparison failed');
  }
} finally {
  ws.close();
  await fs.rm('.g6-fix-validator.cjs', { force: true });
}
