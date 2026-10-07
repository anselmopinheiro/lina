import fs from 'node:fs/promises';
import { build } from 'esbuild';
// Run with Node >=22 (WebSocket) from the canonical repository root.
const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = pages.find(p => p.type === 'page' && /zettel/i.test(p.title));
if (!page) throw new Error('zettel runtime page unavailable');
const baseline = JSON.parse(await fs.readFile('.g6-prestart-hashes.json','utf8'));
await build({stdin:{contents:`
export { validatePublishedGenerationFiles } from './src/index/publishedGenerationValidator';
export { recoverPublishedGenerationPointer } from './src/index/publishedGenerationWriter';
export { publishSqliteCanonicalGeneration } from './src/index/publishedGenerationPublicationService';
export { SqliteProducerLocalStore } from './src/index/sqliteProducerLocalStore';
export { DefaultProducerLocalStorePathResolver } from './src/index/producerLocalStorePathResolver';
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['obsidian','node:sqlite'],outfile:'.g6-runtime-modules.cjs'});
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
async function evaluate(expression) {
  const callId = ++id;
  const result = await new Promise((resolve, reject) => {
    const listener = event => {
      const message = JSON.parse(event.data);
      if (message.id !== callId) return;
      ws.removeEventListener('message', listener);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    };
    ws.addEventListener('message', listener);
    ws.send(JSON.stringify({id:callId,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  const report = await evaluate(`(async () => {
    const baseline = ${JSON.stringify(baseline)};
    const evidence = {executionContext:'OBSIDIAN_RUNTIME',vault:'zettel',capturedAt:new Date().toISOString(),status:'RUNNING',oldGenerationHashesBefore:baseline.hashes,cutover:'BLOCKED'};
    const saveEvidence = () => require('node:fs').writeFileSync('D:/_dev/obsidian/lina/docs/architecture/evidence/G6-PUBLISHED-FORMAT-V2-001.json',JSON.stringify(evidence,null,2)+'\\n');
    try {
    const app = window.app;
    if (app.vault.getName() !== 'zettel') throw new Error('Wrong vault');
    const plugin = app.plugins.plugins.lina;
    if (!plugin || plugin.settings.generateEmbeddingsOnStartup) throw new Error('Unsafe runtime configuration');
    const authority = await plugin.getOwnershipGate().acquireFence({autoClaimIfUnclaimed:false});
    if (!authority) throw new Error('Active producer authority unavailable');
    evidence.authorityStatus = 'authorized';
    const lib = require('D:/_dev/obsidian/lina/.g6-runtime-modules.cjs');
    const crypto = require('node:crypto');
    const originalFetch = window.fetch;
    let providerCalls = 0;
    const rejectNetwork = () => { providerCalls++; throw new Error('Network forbidden during G6 proof'); };
    window.fetch = rejectNetwork;
    try {
    const adapter = app.vault.adapter;
    const root = '.lina/published';
    const digest = bytes => crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    async function oldHashes() {
      const hashes = {};
      for (let n=1;n<=8;n++) {
        const generation = 'generation-' + String(n).padStart(6,'0');
        for (const file of ['manifest.json','records.json','vectors.bin']) {
          const path = root + '/generations/' + generation + '/' + file;
          hashes[generation+'/'+file] = digest(await adapter.readBinary(path));
        }
      }
      return hashes;
    }
    async function validate(id) {
      const base = root + '/generations/' + id;
      const records = await adapter.read(base+'/records.json');
      return { generationId:id, ...lib.validatePublishedGenerationFiles({manifest:await adapter.read(base+'/manifest.json'),records,vectors:new Uint8Array(await adapter.readBinary(base+'/vectors.bin'))}), recordCount:JSON.parse(records).length, missingInputHashes:JSON.parse(records).filter(r=>!r.embeddingInputHash).length };
    }
    const currentBefore = (await adapter.read(root+'/CURRENT')).trim();
    if (currentBefore !== 'generation-000008') throw new Error('Unexpected CURRENT: '+currentBefore);
    const before = await oldHashes();
    if (JSON.stringify(before) !== JSON.stringify(baseline.hashes)) throw new Error('Old generations changed during startup');
    evidence.currentBefore = currentBefore; saveEvidence();
    const v1 = await validate(currentBefore);
    if (!v1.integrityValid || v1.cutoverEligible) throw new Error('Invalid legacy contract');
    const recovery = await lib.recoverPublishedGenerationPointer(adapter);
    if (!recovery.success) throw new Error('Recovery failed');
    evidence.v1 = v1; evidence.recovery = recovery; saveEvidence();
    const resolver = new lib.DefaultProducerLocalStorePathResolver(adapter);
    const store = new lib.SqliteProducerLocalStore({databasePath:resolver.resolveStorePath().databasePath});
    store.open();
    let publication;
    try {
      const records = store.getAllRecords();
      if (store.getSchemaVersion() !== 2 || records.length !== 2303 || records.some(r=>!r.embeddingInputHash)) throw new Error('Invalid SQLite source');
      publication = await lib.publishSqliteCanonicalGeneration(store,{enabled:true,canonicalEnabled:true,deviceRole:'producer',adapter});
    } finally { store.close(); }
    if (!publication.result?.success) throw new Error('Publication failed: '+JSON.stringify(publication));
    evidence.publication = publication; saveEvidence();
    const currentPublished = (await adapter.read(root+'/CURRENT')).trim();
    if (currentPublished !== 'generation-000009') throw new Error('Unexpected generation');
    const v2 = await validate(currentPublished);
    if (!v2.integrityValid || !v2.cutoverEligible || v2.missingInputHashes) throw new Error('Invalid v2');
    evidence.currentPublished = currentPublished; evidence.v2 = v2; saveEvidence();
    const afterPublication = await oldHashes();
    if (JSON.stringify(before) !== JSON.stringify(afterPublication)) throw new Error('Old generations changed after publication');
    const shadow = await plugin.diagnoseM5Shadow();
    evidence.shadow = shadow; saveEvidence();
    if (shadow.status !== 'PASS' || shadow.level !== 'L2' || shadow.generationId !== currentPublished || shadow.summary?.legacyCount !== 2303 || shadow.summary?.publishedCount !== 2303 || shadow.summary?.divergenceCount !== 0 || shadow.providerCalls !== 0) throw new Error('Shadow M5 proof failed');
    const diagnosis = await plugin.diagnoseG6EmbeddingInputHashBackfill();
    evidence.diagnosis = diagnosis; saveEvidence();
    const counts = diagnosis.backfill?.counts;
    if (diagnosis.status !== 'PASS' || diagnosis.binaryStatus !== 'valid' || diagnosis.publishedGenerationStatus !== 'PASS' || diagnosis.equivalenceDivergences !== 0 || diagnosis.providerCalls !== 0 || counts?.ALREADY_PRESENT !== 2303 || counts?.BACKFILLED_VERIFIED !== 0 || Object.entries(counts ?? {}).some(([key,value]) => key !== 'ALREADY_PRESENT' && value !== 0)) throw new Error('Final G6 diagnosis failed');
    const currentAfterDiagnosis = (await adapter.read(root+'/CURRENT')).trim();
    const after = await oldHashes();
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    if (!unchanged || providerCalls !== 0) throw new Error('Immutability or provider guard failed');
    return {...evidence,status:'PASS',currentAfterDiagnosis,oldGenerationHashesAfter:after,oldGenerationsByteIdentical:unchanged,providerCalls,reembeddingCalls:0,fetchBlockedDuringProof:true,providerEvidence:'publication service and G6/M5 diagnostic paths do not invoke embedding providers; all report providerCalls=0',diagnosisWrites:['legacy projection','immutable generation','binary copy','diagnostic evidence']};
    } finally { window.fetch = originalFetch; }
    } catch (error) { evidence.status = 'FAIL'; evidence.error = String(error); saveEvidence(); throw error; }
  })()`);
  await fs.writeFile('docs/architecture/evidence/G6-PUBLISHED-FORMAT-V2-001.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({currentBefore:report.currentBefore,currentPublished:report.currentPublished,currentAfterDiagnosis:report.currentAfterDiagnosis,shadow:report.shadow,diagnosis:report.diagnosis,oldGenerationsByteIdentical:report.oldGenerationsByteIdentical}));
} finally { ws.close(); await fs.rm('.g6-runtime-modules.cjs',{force:true}); }
