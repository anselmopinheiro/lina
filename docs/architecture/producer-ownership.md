# Lina Architecture — Active Producer Ownership

**Status:** Implemented (Phase D2.1 Ownership Manifest Service, Phase D2.2 Worker Ownership Gating, Phase D2.3 Artifact Provenance Tracking, Phase D2.3.1 Provenance Validation Audit, Phase D2.4.1 Internal Diagnostics Model Foundation, & Phase D2.4.2 Diagnostics UI / Status Panel)
**Scope:** Definition of the Active Producer Ownership model, separation of capabilities, roles, ownership, and provenance, ownership manifest specification (`.lina/ownership.json`), artifact provenance schemas, tracking, validation audit, read-only internal diagnostics snapshot and status panel UI, epoch fencing mechanisms, multi-device lifecycle coordination, and worker ownership gating across text, embedding, binary, and reconciliation pipelines.

---

## 1. Problem Statement & Motivation

In multi-device Obsidian environments (synchronized via Obsidian Sync, Syncthing, iCloud, Nextcloud, Git, or Dropbox), multiple devices may participate in the same vault.

Lina's device foundation layers establish:
1. **Persistent Device Identity (Phase A):** Every installation possesses a unique, stable, unsynchronized UUID (`deviceId`).
2. **Device-Scoped State (Phase B):** Every device records its local state in an isolated, single-writer file (`.lina/devices/<deviceId>.json`).
3. **Device Role Model (Phase D1 & D1.1):** A user may configure an installation's operational role as `"producer"` or `"companion"`.

### The Core Problem: Role Is Not Ownership

A device role answers:
> *"What is this installation configured to do?"*

Ownership answers:
> *"Which installation is currently authorized to publish shared artifacts?"*

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ROLE != OWNERSHIP                                │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    [Device A (Workstation)]                 [Device B (Laptop)]
    • role = "producer"                      • role = "producer"
    • Capable of indexing                    • Capable of indexing
    • Active Producer (Epoch 2)              • Standby Producer (Epoch 2)
    • AUTHORIZED to publish                  • READ-ONLY consumer until promoted
```

If multiple devices configured as `producer` were permitted to publish to `.lina/index/*` simultaneously without coordination, the following critical failures would occur:

1. **Split-Brain Indexing:** Two machines indexing concurrent note modifications would generate divergent `.lina/index/notes.json` and `chunks.jsonl` files.
2. **Synchronization Conflict Files:** External sync engines would produce conflicted copies (e.g. `manifest (conflicted copy).json`), corrupting the canonical index.
3. **Stale Artifact Overwrites:** A device waking from sleep or reconnecting after offline work would overwrite newly published index states with an obsolete local snapshot.
4. **Wasted Computation & API Quotas:** Multiple machines would independently compute vector embeddings for the same notes via LLM/embedding providers, wasting local resources and external API budgets.

Therefore, Lina requires an explicit **Active Producer Ownership** layer to ensure **single-active-publisher authority** over shared search assets.

---

## 2. Architectural Separation of Concerns

Lina strictly separates hardware capabilities, user configuration, runtime publication authorization, and provenance validation across the lifecycle:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. Device Capabilities (Hardware & Platform Layer)                       │
│    • Answers: "What can this installation technically do?"               │
│    • Evaluated in-memory from host hardware bounds & platform flags      │
│    • Properties: canMaintainTextIndex, canGenerateEmbeddings             │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. Device Role (Device Configuration Layer)                              │
│    • Answers: "What is this installation configured to do?"              │
│    • Persisted in .lina/devices/<deviceId>.json (single-writer per node) │
│    • Values: "producer" | "companion" | unassigned (undefined)           │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. Active Producer Ownership (Global Authorization Layer)                │
│    • Answers: "Which installation can publish shared artifacts now?"     │
│    • Persisted in .lina/ownership.json (shared vault manifest)           │
│    • Single active producer with monotonically increasing Epoch          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. Worker Ownership Gating (Execution Authorization Layer)               │
│    • Verifies authorization before any write batch executes              │
│    • Standby producers & companions safely skip index write operations   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 5. Artifact Provenance (Immutable Snapshot Metadata)                     │
│    • Answers: "Who produced this specific artifact snapshot?"            │
│    • Stamped into .lina/index/* manifests (producerDeviceId, epoch, time)│
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 6. Provenance Validation (Coherence & Diagnostic Layer)                  │
│    • Answers: "Is this artifact state coherent with active ownership?"   │
│    • Deterministic status: "valid" | "stale" | "unknown" | "future"      │
│    • Non-blocking and zero automatic repair                              │
└──────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Separation Invariants:**
> - Having `canMaintainTextIndex = true` does not automatically make a device a `producer`.
> - Having `role = "producer"` does not grant immediate write authorization.
> - Only the device matching `activeProducerId` in `.lina/ownership.json` under the current `epoch` may write to `.lina/index/*`.
> - **Ownership != Provenance:** Ownership is mutable authorization (*"Who may write now?"*), whereas Provenance is immutable metadata (*"Who produced this?"*).
> - **Validation is Non-Blocking:** Artifacts evaluated as `"stale"`, `"future"`, or `"unknown"` remain 100% usable for search without triggering automatic rebuilds or repair.

---

## 3. Multiple Producer Policy

Lina adopts the **Multiple Producers Allowed, Single Active Publisher** policy:

### Policy Comparison

| Architecture | Description | Evaluation |
| :--- | :--- | :--- |
| **A. Single Producer Globally** | Enforce that only one device across the entire vault may have `role = "producer"`. | ❌ **Rejected:** Overly restrictive. A user with a desktop workstation and a travel laptop would have to reconfigure device roles every time they switch machines. Furthermore, device state files are isolated, making global uniqueness checks fragile. |
| **B. Unrestricted Multiple Producers** | Allow any device with `role = "producer"` to write to `.lina/index/*` whenever changes occur. | ❌ **Rejected:** Guarantees sync conflicts, split-brain indexing, and corrupted search indexes across synchronized vaults. |
| **C. Multiple Producers, Single Active Publisher** *(Lina Model)* | Multiple devices may hold `role = "producer"`, but **strictly one** is designated as the **Active Producer** via a shared ownership manifest. | ✅ **Selected:** Maximum flexibility and safety. Capable devices remain in standby mode (functioning as consumers) until ownership is transferred. |

---

## 4. Ownership Storage Strategy

Ownership authority must be accessible to all devices in the vault while remaining decoupled from unrelated settings.

### Evaluation of Storage Targets

1. **`data.json` (Shared Plugin Settings):**
   - *Why NOT:* `data.json` contains user preferences (UI options, exclusion patterns, language). Storing high-frequency or operational ownership tokens in `data.json` creates high risk of whole-file merge conflicts, risking corruption of user settings.
2. **`.lina/devices/<deviceId>.json` (Device-Scoped State):**
   - *Why NOT:* Device state files are strictly device-scoped and single-writer. They cannot represent global vault-level consensus without requiring distributed multi-file polling and ad-hoc consensus protocols.
3. **`.lina/ownership.json` (Dedicated Ownership Manifest):**
   - *Why YES:* A dedicated, minimal manifest under `.lina/` isolated from both settings and device state. It supports atomic write/rename sequences and provides a clean, observable single source of truth for all participating devices.

---

## 5. Ownership Manifest Schema

The ownership state is persisted at `.lina/ownership.json`.

### 5.1 TypeScript Interface

```typescript
export interface OwnershipManifest {
  /** Schema version integer for forward/backward compatibility. */
  readonly schemaVersion: 1;

  /** Persistent UUID v4 of the device currently authorized to publish. */
  readonly activeProducerId: string;

  /** Monotonically increasing fencing token generation number. */
  readonly epoch: number;

  /** ISO 8601 timestamp when ownership was acquired. */
  readonly acquiredAt: string;

  /** ISO 8601 timestamp of last confirmed publication or heartbeat. */
  readonly updatedAt: string;

  /** Reason for the ownership claim. */
  readonly reason?: "initial" | "manual-transfer" | "recovery-claim";
}
```

### 5.2 JSON Serialization Example

```json
{
  "schemaVersion": 1,
  "activeProducerId": "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
  "epoch": 2,
  "acquiredAt": "2026-09-01T09:00:00.000Z",
  "updatedAt": "2026-09-01T09:30:00.000Z",
  "reason": "manual-transfer"
}
```

---

## 6. The Epoch Concept (Fencing Token)

To guarantee safety across asynchronous, high-latency synchronization systems (e.g. Syncthing, iCloud, or Obsidian Sync), Lina uses an **Epoch counter** as a distributed fencing token.

### 6.1 Fencing Mechanism
1. **Monotonically Increasing:** The `epoch` starts at `1` and strictly increases with every ownership claim or transfer (`epoch = previousEpoch + 1`).
2. **Pre-Write Validation:** Before executing any index build, chunk update, or embedding generation, workers inspect `.lina/ownership.json`:
   - If `activeProducerId === localDeviceId` and `localEpoch === manifest.epoch`: Write is authorized.
   - If `manifest.epoch > localEpoch` or `activeProducerId !== localDeviceId`: Write is **aborted immediately**.
3. **Stale Producer Disarm:** If an old producer was asleep or offline during a transfer, upon waking it observes a higher `epoch` or a different `activeProducerId`. It immediately disarms its background workers and drops to standby consumer mode without mutating shared files.

```
Device A (Old Producer, Epoch 1)               Device B (New Producer, Epoch 2)
───────────────────────────────               ───────────────────────────────
                                              1. User promotes Device B
                                              2. Writes ownership.json (Epoch 2)
                                              3. Publishes index (Epoch 2)
[Wakes from sleep]
4. Checks ownership.json
5. Observes Epoch 2 > Epoch 1
6. Disarms background workers (Yields)
7. Becomes Standby Consumer (Safe)
```

---

## 7. Ownership Lifecycle

### 7.1 Initial Claim (First-Run)
1. Plugin starts on a device with `role = "producer"`.
2. Lina detects `.lina/ownership.json` is missing.
3. The device atomically creates `.lina/ownership.json` with:
   - `activeProducerId = localDeviceId`
   - `epoch = 1`
   - `reason = "initial"`
4. The device becomes the Active Producer.

### 7.2 Manual Transfer (Promotion)
1. The user on Device B (currently a standby producer) initiates "Set as Active Producer".
2. Device B reads current `.lina/ownership.json` to obtain `currentEpoch`.
3. Device B atomically writes `.lina/ownership.json` with:
   - `activeProducerId = deviceB_UUID`
   - `epoch = currentEpoch + 1`
   - `reason = "manual-transfer"`
4. Device B begins publishing shared artifacts stamped with `producerEpoch = currentEpoch + 1`.

### 7.3 Recovery & Standby Behavior
- **Standby Producers:** Devices with `role = "producer"` that do not hold ownership function as read-only consumers. They read `.lina/index/*` for fast search and note analysis, but do not execute automatic file batching or index writing.
- **Recovery Claim:** If the active producer is decommissioned, lost, or inaccessible, any capable producer device can perform a manual recovery takeover, incrementing the epoch and claiming publishing rights safely.

### 7.4 Artifact Provenance Tracking (Phase D2.3)
Ownership answers *"Who is authorized to publish now?"*, while Provenance answers *"Who produced this specific artifact snapshot?"*.

Every shared search asset published to the vault contains structured provenance metadata:

```json
{
  "producerDeviceId": "d35767c1-4c36-4cb7-a31b-c90cb307d565",
  "producerEpoch": 3,
  "generatedAt": "2026-09-01T12:00:00.000Z"
}
```

- **Text Index Manifest (`.lina/index/manifest.json`):** Tracks `manifest.provenance`.
- **Canonical Vector Embeddings (`manifest.embeddings.provenance`):** Stamped at canonical publication.
- **Embedding Checkpoint (`embeddings.checkpoint.meta.json`):** Retains `provenance` during multi-batch generation.
- **Derived Binary Embeddings (`embeddings.binary.manifest.json`):** Inherits canonical publication provenance.
- **Backward Compatibility:** Manifests created prior to Phase D2.3 continue to load with 100% fidelity without forcing rebuilds. Missing provenance evaluates cleanly as `origin: "unknown"`.

### 7.5 Artifact Provenance Validation Audit (Phase D2.3.1)
Lina evaluates existing stored artifacts against current vault ownership using a deterministic, non-destructive validation model:

```
┌────────────────────────────────────────────────────────┐
│ 1. Stored Artifact Provenance                          │
│    { producerDeviceId, producerEpoch, generatedAt }    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Active Vault Ownership State                        │
│    { activeProducerId, epoch, updatedAt }              │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Provenance Validation Result                        │
│    evaluateArtifactProvenance(provenance, ownership)   │
│    → status: "valid" | "stale" | "unknown" | "future"  │
└────────────────────────────────────────────────────────┘
```

#### Status Definitions
1. **Valid Artifact (`status = "valid"`):**
   - Condition: `artifact.producerDeviceId === ownership.activeProducerId` AND `artifact.producerEpoch === ownership.epoch`.
   - Meaning: Produced by the currently authorized active producer under the current epoch generation.
2. **Stale Artifact (`status = "stale"`):**
   - Condition: `artifact.producerEpoch < ownership.epoch` OR (`artifact.producerEpoch === ownership.epoch` with `producerDeviceId !== activeProducerId`).
   - Meaning: A newer producer generation or different producer node exists in the vault.
   - Behavior: Remains **100% usable for search and diagnostics**. **No automatic rebuild** or forced re-indexing is triggered.
3. **Unknown Artifact (`status = "unknown"`):**
   - Condition: Missing provenance, legacy vault index, malformed provenance, or missing ownership manifest.
   - Meaning: Legacy or unversioned index artifact.
   - Behavior: Continues loading with full compatibility without warnings or forced repair.
4. **Future Artifact (`status = "future"`):**
   - Condition: `artifact.producerEpoch > ownership.epoch`.
   - Meaning: Out-of-order sync arrival or lagging local ownership file.
   - Behavior: Remains usable for search. **No automatic rollback or repair** is performed.

#### Strict Non-Reparative Invariants
- **Non-blocking Usability:** Stale, future, or legacy artifacts never prevent searching or plugin initialization.
- **Zero Automatic Repair:** Lina does NOT automatically reindex, recompute embeddings, transfer ownership, or delete files based on provenance evaluations.

---

## 8. Implementation Roadmap (Phases D2.1 – D2.4)

The Active Producer Ownership architecture progresses across the following focused sub-phases:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE D2 IMPLEMENTATION ROADMAP                                          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.1: Ownership Manifest Service [COMPLETED]                       │
│ • Implemented src/device/deviceOwnership.ts                              │
│ • Schema validation, atomic persistence (.tmp staging + rename)          │
│ • API: loadOwnership(), saveOwnership(), claimOwnership(), transfer()    │
│ • Monotonic epoch fencing & unassigned initial state                     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.2: Worker Ownership Gating [COMPLETED]                          │
│ • Integrated ownership checks into TextIndexWorker, ReconciliationWorker,│
│   EmbeddingWorker, BinaryWorker, and MaintenanceEngine                   │
│ • Gating policy: Standby producers skip write batches safely             │
│ • Stale producer disarm when higher epoch is observed                    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.3: Artifact Provenance Tracking [COMPLETED]                     │
│ • Added producerDeviceId, producerEpoch, and generatedAt to manifests    │
│ • Text index, canonical embeddings, checkpoints, & binary copies stamped │
│ • 100% backward compatible with legacy vaults                            │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.3.1: Artifact Provenance Validation Audit [COMPLETED]           │
│ • Pure evaluation: "valid" | "stale" | "unknown" | "future"              │
│ • Diagnostic helpers and OwnershipGate validation integration            │
│ • Non-blocking usability & zero automatic repair guarantees              │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.4.1: Internal Diagnostics Model Foundation [COMPLETED]          │
│ • Unified read-only snapshot aggregating device, ownership, & artifacts  │
│ • Pure builder and defensive async file reader without write side-effects│
│ • Structured foundation for future UI and troubleshooting tools          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.4.2: Diagnostics UI / Status Panel [COMPLETED]                  │
│ • Read-only DeviceDiagnosticsModal presenting device, ownership, & state │
│ • Command "mostrar-diagnostico-dispositivo" registered in main.ts        │
│ • Zero mutation controls (strictly diagnostic observation)               │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.4.3: Manual Ownership Transfer Controls [NEXT PHASE]            │
│ • Provide explicit "Set as Active Producer" action for producer devices  │
│ • Epoch-fenced transfer with overwrite protection and race handling      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Terminology Standards

To maintain clarity and avoid hardware-centric assumptions, all Lina codebase symbols, tests, and documentation must adhere to standard terminology:

| Standard Term | Definition | Prohibited / Deprecated Terms |
| :--- | :--- | :--- |
| **Producer** | A device configured with `role = "producer"` indicating readiness to generate shared search assets. | Primary computer, Master device |
| **Companion** | A device configured with `role = "companion"` operating strictly as a consumer of shared search assets. | Secondary computer, Slave device, Client node |
| **Active Producer** | The specific producer device currently authorized to publish shared artifacts under the active epoch. | Master producer, Leader node |
| **Standby Producer** | A producer device not currently holding ownership authorization. | Slave producer, Secondary producer |
| **Ownership** | Exclusive authorization to publish `.lina/index/*` artifacts. | Master lock, Primary status |
| **Epoch** | Monotonically increasing fencing generation number. | Version counter, Lock generation |
| **Artifact Publication** | Atomically writing canonical index and vector files to `.lina/index/*`. | Master push, Index dump |
