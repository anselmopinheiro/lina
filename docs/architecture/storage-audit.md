# Lina Storage Architecture Audit — Persistence Inventory & Boundaries

**Status:** Consolidated Architecture Reference (Phases A–C Completed)  
**Scope:** Complete inventory of persisted state, `data.json` schema, `.lina/devices/` state, `app.secretStorage`, `.lina/index/` artifacts, storage boundaries, concurrency risks, and lifecycle.

---

## 1. Executive Summary & Migration Status

Lina has transitioned from a legacy monolithic settings model to an explicit, partitioned storage architecture. Data is now separated across official Obsidian storage mechanisms based on strict ownership, privacy, and synchronization boundaries.

### Storage Classification & Status

| Category | Location | Status | Description |
| :--- | :--- | :--- | :--- |
| **Shared configuration** | `data.json` | **Implemented** | Global vault-wide user preferences (language, exclusions, search weights, YAML settings). |
| **Device identity** | Obsidian local storage | **Implemented** | Persistent random UUID v4 in `app.loadLocalStorage` / `app.saveLocalStorage` (Phase A). |
| **Device scoped state** | `.lina/devices/<deviceId>.json` | **Implemented** | Device nickname, creation/update timestamps, and local installation state (Phase B). |
| **Secrets** | `app.secretStorage` | **Implemented** | Secure, unsynchronized API keys for remote providers (Phase C). |
| **Producer ownership** | --- | *Future* | Active producer coordination, epochs, and single-writer publication tokens. |
| **Sync coordination** | --- | *Future* | Multi-device sync conflict avoidance, partial sync detection, and companion delta search. |

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
│  │    • Exclusions, Search weights, YAML settings       │  │    • notes.json                        │  │
│  │                                                      │  │    • chunks.jsonl                      │  │
│  │ 2. Provider Models & Endpoints (Shared Preferences)  │  │                                        │  │
│  │    • analysisProvider, analysisModel, baseUrl        │  │ 2. Canonical Published Embeddings      │  │
│  │    • embeddingsProvider, embeddingsModel, baseUrl    │  │    • embeddings.jsonl                  │  │
│  │                                                      │  │                                        │  │
│  │ (Secrets & Device State completely removed)          │  │ 3. Compiled Binary Vector Acceleration │  │
│  │                                                      │  │    • embeddings.binary.manifest.json   │  │
│  │                                                      │  │    • embeddings.meta.jsonl             │  │
│  │                                                      │  │    • embeddings.vectors.f32            │  │
│  └──────────────────────────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                                        │
│  ┌──────────────────────────────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │     Device-Scoped State: .lina/devices/<id>.json     │  │     Host Unsynchronized Storage        │  │
│  │     (Managed via App.vault.adapter)                  │  │     (Official Obsidian Platform APIs)  │  │
│  ├──────────────────────────────────────────────────────┤  ├────────────────────────────────────────┤  │
│  │ 1. Persistent Device State                           │  │ 1. Device Identity (Phase A)           │  │
│  │    • schemaVersion: 1                                │  │    • app.loadLocalStorage              │  │
│  │    • deviceId: UUID v4                               │  │    • Key: "lina_device_id"             │  │
│  │    • createdAt, updatedAt                            │  │                                        │  │
│  │    • deviceName (local nickname)                     │  │ 2. Secret Storage (Phase C)            │  │
│  │                                                      │  │    • app.secretStorage                 │  │
│  │ 2. Single-Writer Invariant                           │  │    • "lina-analysis-api-key"           │  │
│  │    • Device A writes only to <idA>.json              │  │    • "lina-embeddings-api-key"         │  │
│  │    • Zero sync write collisions                      │  │    • Never written to disk/vault       │  │
│  └──────────────────────────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Comprehensive Persistence Inventory

The table below catalogs every piece of persistent state in the codebase:

### Classification Taxonomy
* `shared-config`: Vault-wide settings that reflect user intent and are shared across all devices (`data.json`).
* `device-identity`: Cryptographically unique UUID stored in `app.loadLocalStorage` / `app.saveLocalStorage`.
* `device-scoped`: State specific to a particular installation persisted in `.lina/devices/<deviceId>.json`.
* `secret`: Credentials and API tokens stored exclusively in `app.secretStorage`.
* `producer-owned`: Canonical search artifacts generated by the active Producer device in `.lina/index/`.
* `regenerable`: Derived assets that can be completely recomputed from vault markdown notes.
* `cache`: In-memory structures or fast-path mirrors used to accelerate execution.
* `temporary`: Staging files (`*.tmp-*`) with bounded short lifecycles (< 500ms).

| Item / Path | Purpose & Source Symbols | Physical Location & Format | Writer(s) | Reader(s) | Lifecycle | Status | Multi-Device Conflict Risk | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`data.json`** | Shared user preferences & provider configuration.<br>[`LinaPlugin.loadDataFromDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2430), [`saveDataToDisk`](file:///d:/_dev/obsidian/lina/main.ts#L2483) | `.obsidian/plugins/lina/data.json`<br>(JSON) | `LinaPlugin` via Obsidian API | `LinaPlugin` via Obsidian API | Lifetime of plugin installation | Implemented | **Low**: Plaintext secrets and device states purged; shared prefs merge smoothly | `shared-config` |
| **Device Identity** | Stable UUID v4 identity for this installation.<br>[`src/device/deviceIdentity.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceIdentity.ts) | Host Webview/Electron Local Storage | `deviceIdentity.ts` | `main.ts`, `settings.ts`, `deviceState.ts` | Permanent per host device | Implemented | **Zero**: Never synchronized across devices | `device-identity` |
| **Device State** | Nickname, schema version, timestamps.<br>[`src/device/deviceState.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceState.ts) | `.lina/devices/<deviceId>.json`<br>(JSON) | `deviceState.ts` | `deviceState.ts`, future role managers | Permanent per device | Implemented | **Zero**: Strict single-writer invariant per file | `device-scoped` |
| **Secrets** | API keys for remote providers (Mistral, OpenRouter).<br>[`src/device/secretStorage.ts`](file:///d:/_dev/obsidian/lina/src/device/secretStorage.ts) | `app.secretStorage` | `secretStorage.ts`, `credentialRuntimeBridge.ts` | `credentialRuntimeBridge.ts`, Provider executors | Lifetime of user authorization | Implemented | **Zero**: Local to device, never written to vault | `secret` |
| **`.lina/index/manifest.json`** | Canonical text & embedding publication metadata.<br>[`src/index/indexStore.ts`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts) | `.lina/index/manifest.json`<br>(JSON) | `persistAndActivateTextIndexCandidate`, `publishEmbeddingArtifacts` | `readTextIndexStatus`, `RuntimeEmbeddingIndex`, `MaintenanceEngine` | Permanent canonical publication | Implemented | **High**: Requires future Single-Producer ownership coordination | `producer-owned` |
| **`.lina/index/notes.json`** | Scanned note metadata, sizes, mtimes, content hashes.<br>[`src/index/indexStore.ts`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts) | `.lina/index/notes.json`<br>(JSON Array) | `TextIndexWorker`, `saveTextIndex` | `readNotesIndexFile`, `TextSearchModal`, `LinaSearchView` | Published with text index | Implemented | **High**: Handled by active Producer | `producer-owned` / `regenerable` |
| **`.lina/index/chunks.jsonl`** | Granular text chunks with textHash and overlap.<br>[`src/index/chunker.ts`](file:///d:/_dev/obsidian/lina/src/index/chunker.ts) | `.lina/index/chunks.jsonl`<br>(JSON Lines) | `TextIndexWorker`, `saveTextIndex` | `EmbeddingGenerator`, `TextSearchModal`, Hybrid Search | Published with text index | Implemented | **High**: Handled by active Producer | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.jsonl`** | Canonical vector embeddings for all active chunks.<br>[`src/index/embeddingPersistence.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts) | `.lina/index/embeddings.jsonl`<br>(JSON Lines) | `EmbeddingWorker`, `publishEmbeddingArtifacts` | `RuntimeEmbeddingIndex`, `SemanticSearchModal`, `LinaSearchView` | Permanent canonical vector store | Implemented | **Critical**: High data volume; requires single-producer coordination | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.vectors.f32`** | Contiguous raw Float32Array binary buffer.<br>[`src/index/embeddingBinaryStorage.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts) | `.lina/index/embeddings.vectors.f32`<br>(Raw IEEE 754 Float32 Little-Endian) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex` (Desktop & Mobile) | Derived downstream from canonical JSONL | Implemented | **Medium**: Binary sync conflicts; companions can fallback to JSONL | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.meta.jsonl`** | Binary vector index mapping chunkId to ordinal.<br>[`src/index/embeddingBinaryStorage.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts) | `.lina/index/embeddings.meta.jsonl`<br>(JSON Lines) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex` | Derived downstream from canonical JSONL | Implemented | **Medium**: Strictly paired with `vectors.f32` | `producer-owned` / `regenerable` |
| **`.lina/index/embeddings.binary.manifest.json`** | Digests and byte lengths for binary copy.<br>[`src/index/embeddingBinaryStorage.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts) | `.lina/index/embeddings.binary.manifest.json`<br>(JSON) | `BinaryWorker`, `publishBinaryEmbeddingArtifacts` | `RuntimeEmbeddingIndex`, `BinaryEmbeddingCopyController` | Derived downstream from canonical JSONL | Implemented | **Medium**: Digest check prevents loading partial binary sync | `producer-owned` / `regenerable` |

---

## 4. Completed Migrations (Phases A–C)

### 4.1 Phase A: Persistent Device Identity
* **Problem:** Hashing `window.navigator` attributes resulted in collision across identical hardware models and lost configuration on browser/OS updates.
* **Solution:** `getOrCreatePersistentDeviceId(app)` generates a standard UUID v4 and persists it in `app.saveLocalStorage("lina_device_id", uuid)`. This identity is stable, platform-independent, and never synchronized.

### 4.2 Phase B: Device-Scoped State Foundation
* **Problem:** Multi-device synchronization wrote conflicting dictionaries into `deviceSettingsById` in `data.json`, causing whole-file overwrites.
* **Solution:** Isolated per-device state files at `.lina/devices/<deviceId>.json`. Each device reads and writes strictly to its own file.

### 4.3 Phase C: Secret Storage Migration
* **Problem:** Plaintext API keys in `data.json` were broadcast across cloud sync services (Obsidian Sync, iCloud, Git, Syncthing).
* **Solution:** All API keys are migrated to Obsidian's official `app.secretStorage` under keys `lina-analysis-api-key` and `lina-embeddings-api-key`. Plaintext keys are purged from settings upon verified storage.

---

## 5. Next Steps: Future Architecture Phases

With the storage, identity, and security foundation complete, Lina is prepared for:
1. **Device Roles (Producer / Companion):** Capability enforcement and user role selection.
2. **Single-Active-Producer Ownership:** Epoch/generation tokens preventing concurrent writes to `.lina/index/`.
3. **Sync Coordination & Companion Delta Search:** Detecting sync drift, partial transfers, and surfacing unindexed note modifications on mobile companion devices.
