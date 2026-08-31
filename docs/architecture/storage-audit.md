# Lina Storage Architecture Audit — Persistence Inventory & Boundaries

**Status:** Technical Architecture Audit (Read-Only)  
**Author:** Architecture Audit  
**Date:** August 2026  
**Scope:** Complete inventory of persisted and semi-persisted state, `data.json` schema, `.lina/index/` artifacts, storage boundaries, concurrency risks, and lifecycle.

---

## 1. Executive Summary

Lina currently persists data across two distinct storage mechanisms provided by Obsidian:
1. **Plugin Settings (`data.json` via `Plugin.loadData()` / `Plugin.saveData()`):** Stores global user preferences, legacy migration fields, the historical Phase 1/2 in-memory index (`IndexData`), and a serialized dictionary of device configurations (`deviceSettingsById`).
2. **Vault Filesystem (`.lina/index/*` via `App.vault.adapter`):** Stores canonical published search assets (text index manifest, notes metadata, chunk lines, canonical embedding vectors in JSONL), checkpoint records for interruptible embedding generation, and compiled binary acceleration assets (`Float32Array` buffers and manifest).

### Key Findings
* **Secret Leakage in Synced Files:** Plaintext API keys (`analysisApiKey`, `embeddingsApiKey`, `aiProfileApiKeys`, legacy `aiApiKey`, `embeddingApiKey`) are stored inside `data.json`. Whenever a user synchronizes their vault via Obsidian Sync, Syncthing, iCloud, or Git, these secrets are broadcast across all synchronized devices.
* **Fragile Device Identity:** The current device ID used to key `deviceSettingsById` is computed by hashing `window.navigator` attributes (`userAgent|language|hardwareConcurrency|maxTouchPoints`) in [`src/settings.ts:231-241`](file:///d:/_dev/obsidian/lina/src/settings.ts#L231-L241). This fingerprint is non-unique across identical devices, changes on browser/OS updates, and fails to provide stable device isolation.
* **Mixed Storage Concerns in `data.json`:** `data.json` conflates global shared configuration (e.g. `interfaceLanguage`, `yamlAllowedProperties`), per-device local configuration (e.g. `analysisProvider`, `embeddingsModel`), secrets (API keys), and deprecated historical index data (`IndexData`).
* **Robust File Publication Mechanics in `.lina/index/`:** Canonical publication of text indices and embeddings implements staging (`.tmp`), atomic rename sequences, and rollback backups (`.bak`). However, this coordination is strictly **in-process / single-device** via [`IndexWriteCoordinator`](file:///d:/_dev/obsidian/lina/src/index/indexWriteCoordinator.ts). Concurrent writes across multiple synchronized devices risk severe filesystem race conditions and split-brain states.

---

## 2. Persistence Topology & System Map

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                             OBSIDIAN VAULT                                             │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  ┌──────────────────────────────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │     Obsidian Plugin Storage: data.json               │  │    Vault Filesystem: .lina/index/*     │  │
│  │     (Loaded via Plugin.loadData / saveData)          │  │    (Managed via App.vault.adapter)     │  │
│  ├──────────────────────────────────────────────────────┤  ├────────────────────────────────────────┤  │
│  │ 1. Global User Configuration (Shared)                │  │ 1. Canonical Published Text Index      │  │
│  │    • interfaceLanguage, embeddingsEnabled, etc.      │  │    • manifest.json                     │  │
│  │                                                      │  │    • notes.json                        │  │
│  │ 2. Device Settings Map (Mixed / Device-Scoped)       │  │    • chunks.jsonl                      │  │
│  │    • deviceSettingsById[fingerprint]                 │  │                                        │  │
│  │    • Models, Base URLs, Batch sizes                  │  │ 2. Canonical Published Embeddings      │  │
│  │                                                      │  │    • embeddings.jsonl                  │  │
│  │ 3. Secrets (High Risk / Unencrypted)                 │  │                                        │  │
│  │    • analysisApiKey, embeddingsApiKey                │  │ 3. In-Progress Checkpoints (Resumable) │  │
│  │    • legacy aiApiKey, embeddingApiKey                │  │    • embeddings.checkpoint.jsonl       │  │
│  │                                                      │  │    • embeddings.checkpoint.meta.json   │  │
│  │ 4. Legacy Deprecated Index (Orphaned)                │  │                                        │  │
│  │    • IndexData (entries, charCount, mtime)           │  │ 4. Compiled Binary Vector Acceleration │  │
│  │                                                      │  │    • embeddings.binary.manifest.json   │  │
│  │ 5. Compatibility / Migration Fallbacks               │  │    • embeddings.meta.jsonl             │  │
│  │    • provider, chatModel, ollamaUrl, etc.            │  │    • embeddings.vectors.f32            │  │
│  └──────────────────────────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Comprehensive Persistence Inventory

The table below catalogs every piece of persistent or semi-persistent state identified in the codebase.

### Classification Taxonomy
* `shared-config`: Vault-wide settings that reflect user intent and should be shared across all devices.
* `device-scoped`: Settings or state specific to a particular device hardware profile, resource budget, or local setup.
* `producer-owned`: Artifacts generated and maintained solely by the active Producer device.
* `secret`: Credentials, API tokens, or authorization headers that must not be exposed or synchronized unsafely.
* `regenerable`: Derived assets that can be completely recomputed from vault contents.
* `cache`: Ephemeral in-memory structures or fast-path mirrors used to accelerate execution.
* `temporary`: Staging, lock, or backup files with bounded short lifecycles.
* `unknown / requires decision`: Ambiguous state requiring architectural decision.

| Item / Path | Purpose & Source Symbols | Physical Location & Format | Writer(s) | Reader(s) | Lifecycle | Auth / Derived | Regen? | Needed By | Multi-Device Conflict Risk | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`data.json` (Root)** | Settings and legacy index envelope.<br>[`LinaPlugin.loadDataFromDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2430), [`LinaPlugin.saveDataToDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2471) | `.obsidian/plugins/lina/data.json`<br>(JSON) | `LinaPlugin` via Obsidian API | `LinaPlugin` via Obsidian API | Lifetime of plugin installation | Authoritative & Derived mix | Partial | Desktop & Mobile | **High**: Sync merges or overwrites whole JSON file; concurrent edits lose device settings | `shared-config` + `device-scoped` + `secret` mix |
| **Global Settings (`LinaSettings`)** | User preferences (language, exclusions, UI flags).<br>[`src/settings.ts:86-136`](file:///d:/_dev/obsidian/lina/src/settings.ts#L86-L136) | `data.json` -> `.settings` | Settings UI, `LinaSettingTab` | `LinaPlugin`, Search views, AI providers | Modified on user configuration | Authoritative | No | Desktop & Mobile | **Medium**: Last-write-wins across sync | `shared-config` |
| **Device Settings (`deviceSettingsById`)** | Per-device models, URLs, batch sizes, API keys.<br>[`src/settings.ts:67-84`](file:///d:/_dev/obsidian/lina/src/settings.ts#L67-L84) | `data.json` -> `.settings.deviceSettingsById` | Settings UI via `setDeviceSettingsContext` | `LinaPlugin`, Provider resolvers | Updated per device; persisted globally | Authoritative | No | Desktop & Mobile | **High**: Devices overwrite dictionary keys; identical fingerprints clash | `device-scoped` + `secret` mix |
| **API Keys (`analysisApiKey`, etc.)** | Provider authentication tokens.<br>[`pureCredentialModel.ts`](file:///d:/_dev/obsidian/lina/src/settings/pureCredentialModel.ts), [`credentialRuntimeBridge.ts`](file:///d:/_dev/obsidian/lina/src/settings/credentialRuntimeBridge.ts) | `data.json` -> `.settings` and `.deviceSettingsById` | Settings UI (`pureCredentialModel`) | `credentialRuntimeBridge`, Provider executors | Lifetime of user authorization | Authoritative | No | Desktop & Mobile | **High Security Risk**: Plaintext broadcast over all synchronization backends | `secret` |
| **Legacy `indexData`** | Phase 1B/1C note metadata index.<br>[`src/indexStore.ts:22-26`](file:///d:/_dev/obsidian/lina/src/indexStore.ts#L22-L26), [`main.ts:2468`](file:///d:/_dev/obsidian/lina/main.ts#L2468) | `data.json` -> `.index` | `updateIndexIncrementally` (fallback) | `runStartupIndexAutomation` (fallback) | Legacy fallback; largely superseded | Derived | Yes | Desktop | **Medium**: Bloats `data.json` (megabytes in large vaults), causing sync lag | `regenerable` / Deprecated |
| **`.lina/index/manifest.json`** | Canonical text & embedding publication metadata.<br>[`src/index/indexStore.ts:16-36`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L16-L36), [`src/index/embeddingPersistence.ts:6`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L6) | `.lina/index/manifest.json`<br>(JSON) | `persistAndActivateTextIndexCandidate`, `publishEmbeddingArtifacts` | `readTextIndexStatus`, `RuntimeEmbeddingIndex`, `MaintenanceEngine` | Permanent canonical publication | Authoritative for published identity | Yes | Desktop & Mobile | **High**: Overwrite by concurrent producer invalidates companion reader caches | `producer-owned` |
| **`.lina/index/notes.json`** | Scanned note metadata, sizes, mtimes, content hashes.<br>[`src/index/indexStore.ts:6-14`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L6-L14) | `.lina/index/notes.json`<br>(JSON Array) | `TextIndexWorker`, `saveTextIndex` | `readNotesIndexFile`, `TextSearchModal`, `LinaSearchView` | Published with text index | Derived | Yes | Desktop & Mobile | **High**: Concurrent producer writes corrupt or revert note hashes | `producer-owned` / `regenerable` |
| **`.lina/index/chunks.jsonl`** | Granular text chunks with textHash and overlap.<br>[`src/index/chunker.ts`](file:///d:/_dev/obsidian/lina/src/index/chunker.ts), [`src/index/indexStore.ts:97`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L97) | `.lina/index/chunks.jsonl`<br>(JSON Lines) | `TextIndexWorker`, `saveTextIndex` | `EmbeddingGenerator`, `TextSearchModal`, Hybrid Search | Published with text index | Derived | Yes | Desktop & Mobile | **High**: Multi-megabyte file; simultaneous rewrites cause sync conflicts | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.jsonl`** | Canonical vector embeddings for all active chunks.<br>[`src/index/embeddingPersistence.ts:31-42`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L31-L42) | `.lina/index/embeddings.jsonl`<br>(JSON Lines) | `EmbeddingWorker`, `publishEmbeddingArtifacts` | `RuntimeEmbeddingIndex`, `SemanticSearchModal`, `LinaSearchView` | Permanent canonical vector store | Derived | Yes (expensive) | Desktop & Mobile | **Critical**: High data volume; concurrent generation wastes API costs and causes write races | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.checkpoint.*`** | Resumable batch progress records and metadata.<br>[`src/index/embeddingPersistence.ts:7-8`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L7-L8) | `.lina/index/embeddings.checkpoint.jsonl`, `.meta.json` | `EmbeddingGenerator` during batch runs | `EmbeddingGenerator` on resume/startup | Transient during generation | Derived / Ephemeral | Yes | Desktop | **High**: If synchronized, a slow machine can overwrite an active machine's checkpoint | `temporary` / `producer-owned` |
| **`.lina/index/embeddings.vectors.f32`** | Contiguous raw Float32Array binary buffer for zero-parse search.<br>[`embeddingBinaryStorage.ts:145`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L145) | `.lina/index/embeddings.vectors.f32`<br>(Raw IEEE 754 Float32 Little-Endian) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex` (Desktop & Mobile) | Derived downstream from canonical JSONL | Derived | Yes | Desktop & Mobile | **Medium**: Binary sync conflicts; companions can fallback to JSONL | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.meta.jsonl`** | Binary vector index mapping chunkId to vector ordinal.<br>[`embeddingBinaryStorage.ts:144`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L144) | `.lina/index/embeddings.meta.jsonl`<br>(JSON Lines) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex` | Derived downstream from canonical JSONL | Derived | Yes | Desktop & Mobile | **Medium**: Must remain strictly paired with `vectors.f32` | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.binary.manifest.json`** | Digests, byte lengths, and generation identity for binary copy.<br>[`embeddingBinaryStorage.ts:17-37`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L17-L37) | `.lina/index/embeddings.binary.manifest.json`<br>(JSON) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex`, `BinaryEmbeddingCopyController` | Derived downstream from canonical JSONL | Derived | Yes | Desktop & Mobile | **Medium**: Digest check prevents loading partially synchronized binary files | `producer-owned` / `regenerable` |
| **Temporary / Staging files (`*.tmp`, `*.bak`, `*.tmp-*`)** | Atomic write staging and recovery backups.<br>[`indexStore.ts:353`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts#L353), [`embeddingPersistence.ts:9-16`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L9-L16) | `.lina/index/*.tmp*`, `.lina/index/*.bak*` | `indexStore`, `embeddingPersistence`, `embeddingBinaryStorage` | Rollback/cleanup handlers | Ephemeral during write transactions (< 500ms) | Temporary | Yes | Producer only | **Low/Medium**: External sync may inadvertently propagate orphan tmp files | `temporary` |
| **Runtime Embedding Index Cache** | In-memory parsed vectors and Float32Array buffers.<br>[`src/search/runtimeEmbeddingIndex.ts`](file:///d:/_dev/obsidian/lina/src/search/runtimeEmbeddingIndex.ts) | Host RAM | `RuntimeEmbeddingIndex` | `SemanticSearchModal`, `LinaSearchView`, `HybridSearch` | Lifetime of workspace session / until invalidated | Derived | Yes | Desktop & Mobile | None (In-memory) | `cache` |
| **Index Diagnostic Ring Buffer** | Last 50 indexing/reconciliation events.<br>[`main.ts:244-267`](file:///d:/_dev/obsidian/lina/main.ts#L244-L267) | Host RAM | `LinaPlugin.addDiagnosticEvent` | `IndexDiagnosticModal`, `getIndexDiagnosticData` | Process session | Ephemeral | N/A | Desktop & Mobile | None (In-memory) | `temporary` / `cache` |
| **Index Write Coordinator State** | In-process write lock and token manager.<br>[`src/index/indexWriteCoordinator.ts`](file:///d:/_dev/obsidian/lina/src/index/indexWriteCoordinator.ts) | Host RAM | `IndexWriteCoordinator` | Maintenance workers, embedding generators | Process session | Ephemeral | N/A | Producer only | **Critical limitation**: In-memory only; cannot coordinate across multiple devices | `temporary` |

---

## 4. Deep-Dive Audit of `data.json`

### 4.1 Root Schema & Persistence Flow
Obsidian stores plugin settings in `.obsidian/plugins/lina/data.json`. Lina serializes the root object via [`LinaPlugin.saveDataToDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2471):

```typescript
interface LinaStoredData {
  settings?: Partial<LinaSettings>;
  index?: IndexData; // Legacy Phase 1B/1C index data
}
```

When [`loadDataFromDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2430) executes, it merges `DEFAULT_SETTINGS` with `data?.settings` and explicitly preserves 27 user-configured keys.

### 4.2 Field Inventory & Classification

#### A. Global User Configuration (`shared-config`)
These fields represent global user preferences for the vault:
* `interfaceLanguage` (`"pt-PT" | "en"`, default: `"pt-PT"`): UI language.
* `embeddingDefaultLanguage` (`EmbeddingDefaultLanguage`, default: `"pt-PT"`): Search tokenization language.
* `embeddingsEnabled` (`boolean`, default: `false`): Master switch for semantic search.
* `yamlSuggestionsEnabled` (`boolean`, default: `true`): Enable YAML suggestions in note analysis.
* `yamlAllowedProperties` (`string`, default: `DEFAULT_ALLOWED_PROPERTIES`): Allowed frontmatter keys.
* `yamlIncludeTags` (`boolean`, default: `true`): Suggest tags inside YAML.
* `maxSuggestedTags` (`number`, default: `5`): Tag suggestion limit.
* `inboxFolderPath` (`string`, default: `"Inbox"`): Default folder for new/analyzed notes.
* `maxInboxNotesToAnalyze` (`number`, default: `20`): Inbox processing limit.
* `folderAnalysisMaxNotes` (`number`, default: `10`): Folder batch analysis limit.
* `folderAnalysisIncludeSubfolders` (`boolean`, default: `false`): Recursive folder analysis toggle.
* `lastAnalyzedFolderPath` (`string`, default: `""`): Last selected folder in UI.
* `indexExcludedFolders` (`string`, default: `""`): Newline-separated folder exclusions.
* `indexExcludedPathContains` (`string`, default: `""`): Substring path exclusions.
* `indexExcludedContentContains` (`string`, default: `""`): Sensitive term content exclusions.
* `autoUpdateIndexOnFileChanges` (`boolean`, default: `true`): Vault listener auto-update switch.
* `debugIndexUpdates` (`boolean`, default: `false`): Enable verbose diagnostic logging.
* `checkSyncOnStartup` (`boolean`, default: `false`): Legacy startup index sync notice.
* `updateIndexOnStartup` (`boolean`, default: `false`): Legacy startup index update.
* `generateEmbeddingsOnStartup` (`boolean`, default: `false`): Startup embedding automation switch.
* `generateOnlyMissingEmbeddings` (`boolean`, default: `true`): Incremental embedding toggle.
* `hybridSearchTextWeight` (`number`, default: `0.5`): Text score fusion weight.
* `hybridSearchSemanticWeight` (`number`, default: `0.5`): Semantic score fusion weight.
* `aiOutputLanguage` (`AIOutputLanguage`, default: `"pt-PT"`): Target generation language.

#### B. Per-Device Configuration (`device-scoped` & `secret` in `deviceSettingsById`)
Lina stores per-device configuration in a nested dictionary keyed by `deviceId`:
```typescript
deviceSettingsById: Record<string, LinaDeviceSettings>;
```
Each entry in `LinaDeviceSettings` contains:
* `deviceName` (`string`): Human-readable device nickname.
* `activeAiProfileId` (`string`): Selected AI profile ID.
* `analysisProvider` (`string`, e.g. `"ollama"`, `"mistral"`, `"openrouter"`).
* `analysisModel` (`string`): Analysis LLM model name.
* `analysisBaseUrl` (`string`): Analysis HTTP endpoint.
* `analysisTimeout` (`string`): Request timeout in seconds.
* `embeddingsProvider` (`string`, e.g. `"ollama"`, `"mistral"`, `"openrouter"`).
* `embeddingsModel` (`string`): Embedding model name.
* `embeddingsBaseUrl` (`string`): Embedding HTTP endpoint.
* `embeddingsBatchSize` (`string`): Batch size (e.g. `"10"`).
* `embeddingsTimeout` (`string`): Embedding request timeout in seconds.
* `embeddingStorageReadPreference` (`"jsonl" | "prefer-binary"`): Format preference.
* `maintainBinaryEmbeddingCopy` (`boolean`): Binary compilation switch.
* `analysisApiKey` (`string`): **UNENCRYPTED SECRET**.
* `embeddingsApiKey` (`string`): **UNENCRYPTED SECRET**.
* `aiProfileApiKeys` (`Record<string, string>`): **UNENCRYPTED SECRETS**.

#### C. Local Fallback Fields (Duplicated on Root)
For legacy reasons, `LinaSettings` duplicates device settings directly on the root object:
`localDeviceName`, `localActiveAiProfileId`, `localAnalysisProvider`, `localAnalysisModel`, `localAnalysisBaseUrl`, `localAnalysisApiKey`, `localAnalysisTimeout`, `localEmbeddingsProvider`, `localEmbeddingsModel`, `localEmbeddingsBaseUrl`, `localEmbeddingsApiKey`, `localEmbeddingsBatchSize`, `localEmbeddingsTimeout`.

#### D. Deprecated Legacy Fields
Preserved for backwards compatibility with Lina 0.1:
* `provider`, `ollamaUrl`, `openrouterUrl`, `chatModel`, `aiApiKey`
* `embeddingLocalEnabled`, `embeddingLocalBaseUrl`, `embeddingLocalModel`, `embeddingLocalTimeoutMs`, `embeddingApiKey`
* `autoGenerateEmbeddingsOnStartup`, `autoGenerateEmbeddingsOnlyWhenNeeded`

#### E. Legacy `index` Root Field
`LinaStoredData.index` (`IndexData` from [`src/indexStore.ts`](file:///d:/_dev/obsidian/lina/src/indexStore.ts)) contains an array of `IndexEntry` objects with complete file paths, word counts, character counts, and raw embeddings. This field is obsolete because canonical search assets now live in `.lina/index/*`. However, if updated, it inflates `data.json` to tens of megabytes, creating severe synchronization bottlenecks.

---

## 5. Synchronization Boundaries & Conflict Analysis

### 5.1 The Zero-Configuration Sync Invariant
**Architectural Invariant:** *Lina must maintain correctness and data integrity even if all files in the vault—including `.obsidian/plugins/lina/data.json` and all `.lina/index/*` files—are actively synchronized across devices without any exclusion rules.*

### 5.2 Conflict Vectors in Current Architecture

```
Device A (Desktop Producer)                      Device B (Laptop / Desktop)
───────────────────────────                      ───────────────────────────
Modifies notes -> Updates .lina/index/          Modifies notes -> Updates .lina/index/
Writes manifest.json (v1, 500 notes)            Writes manifest.json (v1, 480 notes)
Writes embeddings.jsonl (500 vectors)           Writes embeddings.jsonl (480 vectors)
            │                                                │
            └───────────────► [External Sync] ◄──────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
          Sync Conflict / Overwrite        Split-Brain / Vector Mismatch
          manifest.json from B             embeddings.jsonl from A
          (Manifest count mismatch error)  (Corrupted search results)
```

1. **`data.json` Collision:**
   When Device A and Device B both change settings (e.g. Device A edits exclusions, Device B sets an API key), sync synchronizers resolve `data.json` via whole-file replacement or file-level conflict copies (`data (conflicted copy).json`). Obsidian does not merge JSON sub-trees. Edits on one device are silently lost.
2. **Device Fingerprint Collision:**
   Because `getCurrentDeviceSettingsId()` relies on `window.navigator` attributes, two identical machines (e.g. two M2 MacBooks or two standard iPhone 15s) compute the exact same ID `device-xxxx`. They overwrite each other's `deviceSettingsById[id]`, overwriting endpoint URLs and credentials.
3. **Artifact Desynchronization & Non-Atomic Sync Delivery:**
   Lina publishes `.lina/index/notes.json`, `chunks.jsonl`, `embeddings.jsonl`, and `manifest.json` as a transaction on the local filesystem. However, external sync engines transmit files independently. A Companion device reading `.lina/index/` mid-sync may ingest an updated `manifest.json` before `chunks.jsonl` arrives, triggering validation failure (`manifest-count-mismatch` or `chunks-missing`).
4. **Checkpoint Collisions:**
   `embeddings.checkpoint.jsonl` is written during batch generation. If synchronized, a second producer resuming generation reads an alien checkpoint computed with different chunk hashes or provider configurations, polluting its vector database.

---

## 6. Recommendations for Target Storage Architecture

1. **Purge Secrets from `data.json`:**
   Migrate all API keys and authorization tokens to Obsidian's official `app.secretStorage` (`SecretStorage`). Never write plaintext keys to `data.json` or any file within the vault.
2. **Deconflate `data.json`:**
   * **Keep `data.json` purely for `shared-config`:** Only store global user preferences that apply to the entire vault.
   * **Purge legacy `IndexData`:** Completely eliminate the `index` key from `LinaStoredData` to prevent megabyte-scale bloat in `data.json`.
3. **Establish Stable Device-Local Identity:**
   Replace the fragile `window.navigator` fingerprint with a persistent UUID stored in `app.loadLocalStorage` / `app.saveLocalStorage`.
4. **Isolate Device Configuration:**
   Move device-scoped settings (hardware limits, local endpoints, role preferences) into a device-specific namespace (e.g. `.lina/devices/<deviceId>.json` or device-local storage).
5. **Enforce Single-Active-Producer Ownership:**
   Introduce epoch/generation tokens and active producer metadata to prevent concurrent writes to `.lina/index/*`.
