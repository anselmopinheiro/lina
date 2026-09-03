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
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 7. Internal Diagnostics & UI (Observation & Troubleshooting Layer)       │
│    • Answers: "What is the complete diagnostic state of this node?"      │
│    • Read-only DeviceDiagnostics snapshot & DeviceDiagnosticsModal       │
│    • Zero mutation controls, zero duplicated logic, purely observational │
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
export type OwnershipReason = "initial" | "manual-transfer" | "recovery-claim" | "relinquish";

export interface OwnershipManifest {
  /** Schema version integer for forward/backward compatibility. */
  readonly schemaVersion: 1;

  /** Persistent UUID v4 of the device currently authorized to publish, or null if ownership was relinquished. */
  readonly activeProducerId: string | null;

  /** Monotonically increasing fencing token generation number. */
  readonly epoch: number;

  /** ISO 8601 timestamp when ownership was acquired. */
  readonly acquiredAt: string;

  /** ISO 8601 timestamp of last confirmed publication or heartbeat. */
  readonly updatedAt: string;

  /** Reason for the ownership transition. */
  readonly reason?: OwnershipReason;
}
```

### 5.2 JSON Serialization Example

Active Producer held:
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

Relinquished state (Active Producer demoted to Companion):
```json
{
  "schemaVersion": 1,
  "activeProducerId": null,
  "epoch": 3,
  "acquiredAt": "2026-09-03T18:00:00.000Z",
  "updatedAt": "2026-09-03T18:00:00.000Z",
  "reason": "relinquish"
}
```


---

## 6. The Epoch Concept (Fencing Token)

To guarantee safety across asynchronous, high-latency synchronization systems (e.g. Syncthing, iCloud, Nextcloud, Git, or Obsidian Sync), Lina uses an **Epoch counter** as a distributed fencing token.

### 6.1 Fencing Mechanism
1. **Monotonically Increasing:** The `epoch` starts at `1` and strictly increases with every ownership claim, transfer, or relinquish (`epoch = previousEpoch + 1`). Epoch numbers are permanent and strictly monotonic; they are **never reset to 1 or decremented**.
2. **Pre-Write Validation:** Before executing any index build, chunk update, or embedding generation, workers inspect `.lina/ownership.json`:
   - If `activeProducerId === localDeviceId` and `localEpoch === manifest.epoch`: Write is authorized.
   - If `manifest.epoch > localEpoch` or `activeProducerId !== localDeviceId` (including `activeProducerId === null`): Write is **aborted immediately**.
3. **Stale Producer Disarm:** If an old producer was asleep or offline during a transfer, upon waking it observes a higher `epoch` or a different `activeProducerId`. It immediately disarms its background workers and drops to standby consumer mode without mutating shared files.

### 6.2 Synchronization Reality & Convergence
- **Local Authority Revocation:** Revocation on the local machine (e.g. during demotion from Active Producer to Companion) is **immediate**. Background workers stop synchronously and in-memory authorization is cleared before role persistence.
- **Remote Device Convergence:** Remote devices observe ownership changes upon synchronization convergence—i.e. when external synchronization software (Syncthing, Obsidian Sync, etc.) delivers the updated `.lina/ownership.json` file to their local disk. Lina does not claim or assume that remote fencing is instantaneous before sync transport delivers the updated manifest.

```text
Device A (Old Producer, Epoch 1)               Device B (New Producer, Epoch 2)
───────────────────────────────               ───────────────────────────────
                                              1. User promotes Device B
                                              2. Writes ownership.json (Epoch 2)
                                              3. Publishes index (Epoch 2)
[Sync delivers ownership.json]
4. Checks ownership.json
5. Observes Epoch 2 > Epoch 1
6. Disarms background workers (Yields)
7. Becomes Standby Consumer (Safe)
```

---

## 7. Ownership Lifecycle

### 7.1 Initial Claim (Unowned Vault)
1. Plugin starts on a device configured with `role = "producer"`.
2. Lina detects `.lina/ownership.json` is missing.
3. If `autoClaimIfUnclaimed` is enabled (first evaluation on Producer):
   - The device atomically creates `.lina/ownership.json` with:
     - `activeProducerId = localDeviceId`
     - `epoch = 1`
     - `reason = "initial"`
   - The device becomes the authorized Active Producer at epoch 1.

### 7.2 Manual Transfer (Standby Producer Promotion)
1. The user on Device B (currently a Standby Producer) initiates "Make this device the Active Producer" from Settings or the Command Palette.
2. Device B prepares a zero-side-effect preview (`prepareOwnershipTransferPreview`) reading current `epoch = E`.
3. The user reviews and confirms in `OwnershipTransferConfirmationModal`.
4. Device B executes `confirmAndExecuteOwnershipTransfer`:
   - Atomically writes `.lina/ownership.json` with `activeProducerId = deviceB_UUID`, `epoch = E + 1`, `reason = "manual-transfer"`.
   - Appends an immutable audit record to `.lina/ownership-history/`.
5. Device B becomes the Active Producer at epoch $E + 1$.
6. When synchronization delivers the updated manifest to Device A, Device A detects a higher epoch and safely yields authority to become a Standby Producer.

### 7.3 Ownership Relinquish (Active Producer Demotion to Companion)
When an Active Producer at epoch $E$ is demoted to Companion (`role = "companion"`):
1. **Relinquish Authority First:** Before changing device role on disk, the device invokes `relinquishOwnership()`:
   - Atomically increments epoch: $E \to E + 1$.
   - Sets `activeProducerId = null` and `reason = "relinquish"`.
   - Appends an immutable audit event to `.lina/ownership-history/` recording `previousProducerId = oldId`, `newProducerId = null`, `previousEpoch = E`, `newEpoch = E + 1`, `reason = "relinquish"`.
2. **Stop Background Workers:** Shuts down `MaintenanceEngine` immediately (stops `TextIndexWorker`, `ReconciliationWorker`, `BinaryWorker`, and disables `EmbeddingScheduler`).
3. **Persist Role:** Saves `role = "companion"` to `.lina/devices/<deviceId>.json`.
4. **Refresh Gate & Listeners:** Re-evaluates `OwnershipGate` (`status: "not-producer-role"`, `authorized: false`) and cleans up vault event listeners.

> [!IMPORTANT]
> **Understanding `activeProducerId = null`:**
> - `activeProducerId = null` signifies that **no device currently holds Active Producer publication authority** at the current ownership epoch.
> - This does **not** delete or reset ownership: the epoch remains strictly monotonic ($E + 1$) and ownership history is preserved.
> - Lina **never** performs automatic leader election or automatic transfer to another device.
> - The invariant holds: a device can **never** finish in `role = "companion" AND OwnershipGate.authorized = true`.

### 7.4 How an Unowned or Relinquished Vault Obtains an Active Producer
Based on actual implementation logic:
- **Case 1: Fresh Unowned Vault (Manifest Missing):**
  A device configured as `role = "producer"` automatically claims initial ownership via `claimInitialOwnership()` during gate evaluation, creating epoch 1 with `reason = "initial"`.
- **Case 2: Relinquished Vault (`activeProducerId = null` at epoch $E$):**
  Any Standby Producer (`role = "producer"`) can claim active authority through the explicit manual transfer flow (`confirmAndExecuteOwnershipTransfer()`). The transfer service detects that the current owner is `null`, validates that the target device is a valid Producer, and advances the epoch to $E + 1$ with `reason = "manual-transfer"`.

### 7.5 Standby Behavior
- **Standby Producers:** Devices with `role = "producer"` where `activeProducerId !== localDeviceId` function as read-only consumers. They read `.lina/index/*` for fast search and note analysis, but do not execute automatic file batching, embedding generation, or index writes.


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

### 7.6 Internal Diagnostics Model & Status Panel (Phases D2.4.1 & D2.4.2)

To enable transparent observation and troubleshooting across multi-device vaults without risking accidental state changes, Lina establishes a unified, read-only internal diagnostics pipeline:

```
┌────────────────────────────────────────────────────────┐
│ Vault File System (.lina/devices, ownership, index)   │
└───────────────────────────┬────────────────────────────┘
                            │ (Defensive Read-Only Query)
                            ▼
┌────────────────────────────────────────────────────────┐
│ readDeviceDiagnostics() / buildDeviceDiagnostics()     │
│ → DeviceDiagnostics Snapshot                           │
├────────────────────────────────────────────────────────┤
│ • device: { id, name, role, isConfigured, ... }        │
│ • ownership: { activeProducerId, epoch, state, ... }   │
│ • artifacts: { index, embeddings, binary, checkpoint } │
└───────────────────────────┬────────────────────────────┘
                            │ (Pure Presentation)
                            ▼
┌────────────────────────────────────────────────────────┐
│ DeviceDiagnosticsModal ("mostrar-diagnostico...")       │
│ • Read-only UI panel with status badges                │
│ • Exactly 1 control: "Fechar" (Close)                  │
│ • Zero mutation buttons, zero sync/repair side effects │
└────────────────────────────────────────────────────────┘
```

#### Diagnostic Invariants
1. **Strictly Read-Only:** The diagnostics reader only issues defensive file reads. It never invokes writes, renames, deletions, or auto-claims.
2. **Zero Business Logic in UI:** The presentation modal consumes the resolved `DeviceDiagnostics` snapshot directly and does not inspect filesystem files, calculate epoch comparisons, or validate provenance.
3. **No Automatic Repair or Sync Actions:** The diagnostic UI provides visibility only; all sync transport remains managed by external engines and future ownership transfer controls remain guarded.

---

### 7.7 Manual Ownership Transfer Service Foundation (Phase D2.5.1)

Lina establishes a dedicated service layer (`src/device/deviceOwnershipTransfer.ts`) for executing controlled, validated manual ownership transfers:

```
┌────────────────────────────────────────────────────────┐
│ Caller (Future UI Action / Settings Controller)        │
└───────────────────────────┬────────────────────────────┘
                            │ transferOwnershipToDevice(adapter, targetDeviceId, options)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Ownership Transfer Validation Gate                     │
│ 1. Current ownership manifest exists                   │
│ 2. Target device ID is a valid UUID                    │
│ 3. Target device != current active producer            │
│ 4. Expected epoch matches current epoch (if supplied)  │
└───────────────────────────┬────────────────────────────┘
                            │ (Validation Passed)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Atomic Epoch Increment & Persistence                   │
│ • epoch = currentEpoch + 1                             │
│ • reason = "manual-transfer"                           │
│ • Staging (.tmp) → Atomic Rename (.lina/ownership.json)│
└────────────────────────────────────────────────────────┘
```

### 7.8 Ownership Transfer Safety & Confirmation Layer (Phase D2.5.2)

To prevent accidental, silent, or stale ownership transfers, Lina implements a safety preparation layer (`src/device/ownershipTransferSafety.ts`):

```
┌────────────────────────────────────────────────────────┐
│ Caller (Future UI Action / Transfer Controller)        │
└───────────────────────────┬────────────────────────────┘
                            │ 1. prepareOwnershipTransferPreview(adapter, targetDeviceId)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Structured Read-Only Preview                           │
│ • currentProducerId, targetProducerId                  │
│ • currentEpoch, nextEpoch (currentEpoch + 1)           │
│ • requiresConfirmation: true                           │
│ • ZERO filesystem writes / zero side effects           │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ 2. confirmAndExecuteOwnershipTransfer(adapter, preview, confirmation)
                            ▼
┌────────────────────────────────────────────────────────┐
│ Safety & Confirmation Validation Gate                  │
│ 1. Explicit confirmation required (confirmed === true) │
│ 2. Preview schema & integrity check                    │
│ 3. Monotonic epoch revalidation (fencing guard)        │
│ 4. Rejection on stale preview or concurrent change     │
└───────────────────────────┬────────────────────────────┘
                            │ (Validation Passed)
                            ▼
┌────────────────────────────────────────────────────────┐
│ transferOwnershipToDevice(adapter, target, guard)      │
│ • Atomic staging & rename                              │
│ • Increments epoch on disk                             │
└────────────────────────────────────────────────────────┘
```

### 7.9 Diagnostics Integration for Ownership Transfer (Phase D2.5.3)

To surface transfer readiness transparently before any UI controls are introduced, Lina extends the read-only diagnostic snapshot (`src/device/deviceDiagnostics.ts`) with a dedicated transfer section:

```
┌────────────────────────────────────────────────────────┐
│ DeviceDiagnostics Snapshot                             │
├────────────────────────────────────────────────────────┤
│ • device: id, name, role, isConfigured                 │
│ • ownership: activeProducerId, epoch, reason           │
│ • transfer:                                            │
│     ├── ownershipExists: boolean                       │
│     ├── activeProducerId?: string                      │
│     ├── currentEpoch?: number                          │
│     ├── localDeviceId: string                          │
│     ├── isLocalActiveProducer: boolean                 │
│     ├── canTransferOwnership: boolean                  │
│     └── eligibilityReason:                             │
│           "ready" | "already-active-producer" |        │
│           "missing-ownership" | "companion-role" |     │
│           "unassigned-role"                            │
│ • artifacts: index, embeddings, binary, checkpoint     │
└────────────────────────────────────────────────────────┘
```

#### Diagnostic Invariants & Scope
1. **Observation Only:** Diagnostics solely observe and report transfer readiness. They never call transfer services, never prepare write previews, never prompt for confirmation, and never alter `.lina/ownership.json` or `.lina/devices/<deviceId>.json`.
2. **Deterministic Readiness Reporting:** The snapshot explicitly answers:
   - **Active Producer:** The device holding current publication authority (`activeProducerId`).
   - **Current Epoch:** The active epoch fencing token (`currentEpoch`).
   - **Local Ownership State:** Whether the local device is the active producer (`isLocalActiveProducer`).
   - **Eligibility Reason:** Structured categorization (`"ready"`, `"already-active-producer"`, `"missing-ownership"`, `"companion-role"`, `"unassigned-role"`).
3. **No Execution or Automatic Takeover:** Diagnostics does NOT execute transfers, no confirmation flow exists in the UI, and no automatic promotion or failover routines exist.
4. **Read-Only UI Presentation:** `DeviceDiagnosticsModal` displays transfer readiness using internationalized labels (`UiStrings`) and maintains safe read-only defaults.

---

### 7.10 Manual Ownership Transfer UI (Phase D2.5.4)

Phase D2.5.4 delivers the user-facing workflow enabling explicit, controlled ownership transfers from standby producer devices to claim active producer authority:

```
┌────────────────────────────────────────────────────────┐
│ Standby Producer User Action                           │
│ • Click "Promover a produtor ativo" in diagnostics    │
│ • Or invoke command "Promover este dispositivo..."     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Ownership Transfer Safety Preview                      │
│ • prepareOwnershipTransferPreview(adapter, deviceId)   │
│ • Validates role readiness & extracts current epoch    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ OwnershipTransferConfirmationModal                     │
│ • Current active producer ID & current epoch           │
│ • Target device ID (this device) & next epoch (+1)     │
│ • Explicit warning (Role != Ownership, zero data loss) │
│ • Explicit action: [Cancelar] / [Confirmar]           │
└───────────────────────────┬────────────────────────────┘
                            │ User clicks Confirm
                            ▼
┌────────────────────────────────────────────────────────┐
│ confirmAndExecuteOwnershipTransfer                     │
│ • Atomic persistence to .lina/ownership.json           │
│ • Monotonic epoch fencing (epoch + 1)                  │
│ • Emits user notification & refreshes gate/diagnostics │
└────────────────────────────────────────────────────────┘
```

#### UI Workflow & Complete Execution Chain

The end-to-end execution chain flows strictly through the safety and service foundations without bypassing validation:

```
    User action (Diagnostics modal or Command palette)
          │
          ▼
    Transfer Preview (prepareOwnershipTransferPreview)
          │
          ▼
    Confirmation Modal (OwnershipTransferConfirmationModal)
          │ [User clicks Confirm]
          ▼
    Safety Validation (confirmAndExecuteOwnershipTransfer)
          │
          ▼
    Ownership Transfer Service (transferOwnershipToDevice)
          │
          ▼
    ownership.json update (Atomic .tmp staging + rename)
```

#### UI Workflow & Safety Invariants
1. **User Action Entry Points:** Manual transfers are initiated via the diagnostics modal button ("Promover a produtor ativo" / "Promote to active producer") when the local device is an eligible standby producer, or directly via the command palette (`"transferir-ownership-dispositivo"`).
2. **Transfer Preview Generation:** Before prompting the user, `prepareOwnershipTransferPreview` evaluates eligibility, reads current ownership, and constructs a structured, immutable preview token without disk mutations.
3. **Mandatory Explicit Confirmation:** Transfers strictly require human confirmation via `OwnershipTransferConfirmationModal`. The modal transparently displays:
   - Current active producer ID & current epoch;
   - Target device ID (the local device) & next epoch (`currentEpoch + 1`);
   - Explicit safety warning explaining publication authority change, zero data loss, and unchanged device roles.
4. **Safety Layer Execution:** When confirmed, the UI invokes `confirmAndExecuteOwnershipTransfer({ confirmed: true })`, which validates the preview, re-checks on-disk epoch to prevent race conditions, and delegates persistence exclusively to `transferOwnershipToDevice`.
5. **Strict Role Isolation (`Role != Ownership`):** Ownership transfer changes publication authority in `.lina/ownership.json` only. Local device operational roles (`.lina/devices/*.json`) remain 100% untouched.
6. **No Automatic Takeover or Heartbeats:** Lina does not implement heartbeats, TTLs, background monitoring, automatic failover, or silent promotions.
7. **External Sync Independence:** Lina relies exclusively on external file synchronization engines (e.g. Syncthing, Obsidian Sync) for file transport and does not implement a custom cloud synchronization engine.
8. **Comprehensive Error Handling:** Concurrency collisions (stale epoch fencing mismatches) and filesystem errors are trapped gracefully and presented with translated, user-friendly notices (`UiStrings`).

---

### 7.11 Ownership Transfer Audit Trail Foundation (Phase D2.5.5)

Phase D2.5.5 establishes an immutable, append-only historical audit trail of all active producer ownership transitions stored in `.lina/ownership-history/`.

#### Audit Model & Storage Hierarchy

```
.lina/
 ├── ownership.json              <-- Canonical active producer state & current epoch
 └── ownership-history/          <-- Immutable, append-only historical event log
      ├── 001.json               <-- Initial ownership claim or epoch 1 transition
      ├── 002.json               <-- Transition to epoch 2
      └── 003.json               <-- Transition to epoch 3
```

Each event file conforms to the `OwnershipAuditEvent` schema:

```typescript
export interface OwnershipAuditEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly previousProducerId?: string;
  readonly newProducerId: string;
  readonly previousEpoch?: number;
  readonly newEpoch: number;
  readonly reason: "initial" | "manual-transfer" | "recovery-claim";
  readonly executedAt: string;
}
```

#### Operational & Invariant Guarantees
1. **Append-Only Immutability:** Existing event files are never modified, overwritten, or deleted. Each transition writes a new sequentially numbered file (`001.json`, `002.json`, ...).
2. **Atomic Persistence:** Each event is staged in a temporary file (`.<filename>.<timestamp>.tmp`) before atomic renaming.
3. **Execution Integration Order:** An audit event is recorded strictly **after** `ownership.json` has been atomically persisted to disk:
   ```
   Confirmation → Safety validation → Transfer service → ownership.json update → Audit event append
   ```
4. **Zero Erroneous Entries on Failure:** Failed transfers (e.g. missing confirmation, epoch mismatch, invalid target ID, or disk failure) **never** generate audit entries.
5. **Fault-Tolerant History Loading:** If `.lina/ownership-history/` is absent, `loadOwnershipAuditHistory` returns `[]`. Non-JSON or schema-invalid files in the history directory are skipped safely without throwing.
6. **Strict Independence:** Device operational roles (`.lina/devices/*.json`) are never touched, no worker side-effects or index rebuilds occur, and `.lina/ownership.json` schema remains unchanged.

---

### 7.12 Ownership Recovery Diagnostics Foundation (Phase D2.5.6)

Phase D2.5.6 establishes an observation-only diagnostic foundation (`evaluateOwnershipRecovery`) to detect inconsistent, missing, or diverged ownership and audit trail states across multi-device synchronizations without performing automated recovery.

#### Recovery Diagnostics Model

```typescript
export type OwnershipRecoveryStatus =
  | "healthy"
  | "missing-manifest"
  | "missing-history"
  | "history-ahead-of-manifest"
  | "epoch-inconsistency"
  | "unknown";

export interface OwnershipRecoveryDiagnostics {
  readonly status: OwnershipRecoveryStatus;
  readonly hasManifest: boolean;
  readonly hasHistory: boolean;
  readonly currentProducerId?: string;
  readonly currentEpoch?: number;
  readonly latestAuditProducerId?: string;
  readonly latestAuditEpoch?: number;
  readonly lastKnownProducerId?: string;
  readonly totalAuditEvents: number;
  readonly warnings: readonly string[];
  readonly evaluatedAt: string;
}
```

#### Discrepancy Detection Rules & Guarantees

| Status | Condition | Observation & Reporting |
| :--- | :--- | :--- |
| **`healthy`** | Manifest and history exist with matching active producer ID and matching epoch. | Fully coherent; zero warnings. |
| **`missing-manifest`** | History exists in `.lina/ownership-history/`, but `.lina/ownership.json` is absent or unparseable. | Reports latest audit epoch and producer. Does NOT recreate manifest. |
| **`missing-history`** | Manifest exists, but no audit events are found. | Reports manifest state and notes absence of audit history. |
| **`history-ahead-of-manifest`** | `latestAudit.newEpoch > manifest.epoch`. | Reports diverged synchronization state where audit log is newer than active manifest. |
| **`epoch-inconsistency`** | Manifest is ahead of audit log (`manifest.epoch > latestAudit.newEpoch`), or producers mismatch at same epoch, or invalid epoch values. | Reports structural inconsistency. |
| **`unknown`** | Neither manifest nor history exists. | Uninitialized or freshly created vault state. |

#### Strict Observation-Only Guarantees
- **Zero Automatic Recovery:** Diagnostics never recreate missing files, mutate `ownership.json`, or perform automatic claims.
- **Zero Disk Writes:** Evaluation does not execute `adapter.write`, `adapter.remove`, or `adapter.rename`.
- **Zero Worker Side Effects:** Background workers, index builders, and maintenance routines are never invoked.
- **Strict Role Isolation:** Device roles (`.lina/devices/*.json`) remain completely untouched.

---

### 7.13 Ownership Recovery Diagnostics UI Integration (Phase D2.5.7)

Phase D2.5.7 integrates the observation-only recovery diagnostics into the active diagnostics presentation layer (`DeviceDiagnostics` snapshot model and `DeviceDiagnosticsModal`).

#### Visual & Architectural Presentation
- **Consistency Status Badge:** Color-coded badges for `healthy` (success), `missing-history`/`missing-manifest` (warning), `history-ahead-of-manifest`/`epoch-inconsistency` (error), and `unknown` (neutral).
- **Epoch Comparison:** Side-by-side presentation of `currentEpoch` (from manifest) and `latestAuditEpoch` (from history).
- **Producer Identification:** Transparent reporting of current active producer and last known producer from audit records.
- **Audit Event Count:** Total number of verified chronological transitions recorded in `.lina/ownership-history/`.
- **Integrity Warnings:** Dedicated bulleted warning list when discrepancies or structural divergence are detected.
- **Strict Observation Only:** Contains **zero recovery action buttons**, **zero automatic repair triggers**, and **zero sync engine dependencies**.
- **Full Internationalization:** All section titles, labels, badges, and status descriptions are localized via `UiStrings` (`pt-PT` / `en`).

---

### 7.14 Comprehensive Ownership State Matrix & Hardening Audit (Phase D2.5.8)

Phase D2.5.8 consolidates the completed active producer ownership architecture through a comprehensive state matrix audit, verifying that all system invariants hold across multi-device synchronizations:

#### A. Device States Matrix
| Device State | Configured Role | Manifest Match | Local Ownership Status | OwnershipGate Action | Transfer Eligibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Active Producer** | `"producer"` | `activeProducerId === localDeviceId` | Active (`isActiveProducer: true`) | Authorized to publish shared artifacts under active epoch | Not eligible (`already-active-producer`) |
| **Standby Producer** | `"producer"` | `activeProducerId !== localDeviceId` (including `null`) | Standby (`isStandbyProducer: true`) | Read-only; write batches skipped safely | Eligible for manual promotion (`ready`) |
| **Companion** | `"companion"` | Any | Companion (`isCompanion: true`) | Read-only consumer; workers deactivated | Ineligible (`companion-role`) |
| **Unassigned** | Omitted (`undefined`) | Any | Unassigned (`isUnassigned: true`) | Read-only; no write operations permitted | Ineligible (`unassigned-role`) |

#### B. Ownership & Recovery States Matrix
| Consistency Status | Manifest State | Audit Trail State | Epoch Comparison | Diagnostic Observation & Invariant Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **`healthy`** | Present & Valid | Present (`>= 1` events) | `manifest.epoch === latestAudit.newEpoch` & producers match (or both `null` on relinquish) | Vault ownership and audit trail fully synchronized; 0 warnings. |
| **`missing-manifest`** | Absent / Corrupted | Present (`>= 1` events) | Manifest unavailable | Reports latest audit epoch and producer. Observation only; zero auto-recreation. |
| **`missing-history`** | Present & Valid | Absent / Empty | Audit trail empty | Reports manifest state and notes absence of audit history. Zero auto-generation. |
| **`history-ahead-of-manifest`**| Present & Valid | Present (`>= 1` events) | `latestAudit.newEpoch > manifest.epoch` | Reports diverged synchronization state (e.g. sync delay). Zero automatic overwrite. |
| **`epoch-inconsistency`** | Present & Valid | Present (`>= 1` events) | `manifest.epoch > latestAudit.newEpoch` or producer mismatch | Reports structural inconsistency. Zero automatic rollback. |
| **`unknown`** | Absent / Unclaimed | Absent / Empty | No epochs | Uninitialized or freshly created vault state. |


#### C. Artifact Provenance States Matrix
| Provenance Status | Artifact Metadata | Active Manifest Comparison | Runtime Behavior & Usability |
| :--- | :--- | :--- | :--- |
| **`valid`** | Well-formed | `producerEpoch === activeEpoch` & producers match | Fully trusted; active for local search and retrieval. |
| **`stale`** | Well-formed | `producerEpoch < activeEpoch` or producer mismatch | Usable for non-destructive reading; flagged for background update by active producer. |
| **`future`** | Well-formed | `producerEpoch > activeEpoch` | Usable for non-destructive reading; indicates newer vault epoch synchronized. |
| **`unknown`** | Missing / Corrupted | Metadata missing or unparseable | Usable for search with fallback; backward compatible with legacy unversioned vaults. |

#### D. Core Architectural Invariants Verified
1. **Strict Role Isolation (`Role != Ownership`):** Changing, transferring, or claiming ownership **never modifies `.lina/devices/*.json`**.
2. **Single Active Publisher:** Multiple producer-capable devices may coexist; only the single node holding `activeProducerId` under the active epoch is authorized to publish.
3. **Monotonic Epoch Fencing:** Epochs strictly increment (`currentEpoch + 1`). Stale transfers with out-of-date expected epochs fail immediately with `epoch-mismatch`.
4. **Append-Only Audit Immutability:** Audit files (`001.json`, `002.json`, ...) are permanently immutable; failed transfers never write audit entries.
5. **Observation-Only Recovery:** Diagnostics inspect and report; zero auto-recovery, zero auto-claims, and zero background recovery loops.
6. **Readiness for Companion Delta Search:** The ownership foundation is fully hardened and verified for Phase 0.4.x.

---

## 8. Implementation Roadmap (Phases D2.1 – D2.5)

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
│ Phase D2.4.2 & D2.4.4: Diagnostics UI & i18n Alignment [COMPLETED]       │
│ • Read-only DeviceDiagnosticsModal presenting device, ownership, & state │
│ • Command "mostrar-diagnostico-dispositivo" registered in main.ts        │
│ • Full internationalization (pt-PT / en) via UiStrings                   │
│ • Zero mutation controls (strictly diagnostic observation)               │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.1: Manual Ownership Transfer Service Foundation [COMPLETED]   │
│ • Implemented src/device/deviceOwnershipTransfer.ts                      │
│ • Validated, atomic transfer service with monotonic epoch increments     │
│ • Pure service layer without UI, auto-claims, or worker side-effects     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.2: Ownership Transfer Safety & Confirmation Layer [COMPLETED] │
│ • Implemented src/device/ownershipTransferSafety.ts                      │
│ • Read-only transfer previews, explicit confirmation validation, and     │
│   stale-epoch race condition protection                                  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.3: Diagnostics Integration [COMPLETED]                        │
│ • Surface transfer readiness and eligibility in diagnostics model/UI     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.4: UI Manual Ownership Transfer [COMPLETED]                   │
│ • Implemented src/device/ownershipTransferConfirmationModal.ts           │
│ • User-facing transfer trigger with explicit confirmation modal          │
│ • Integrated with DeviceDiagnosticsModal and command palette             │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.5: Ownership Transfer Audit Trail Foundation [COMPLETED]      │
│ • Implemented src/device/deviceOwnershipAudit.ts                         │
│ • Append-only, immutable history in .lina/ownership-history/             │
│ • Atomic event logging, chronological loading, and corruption resilience │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.6: Ownership Recovery Diagnostics Foundation [COMPLETED]      │
│ • Implemented src/device/ownershipRecoveryDiagnostics.ts                 │
│ • Observation-only detection: healthy, missing-manifest, missing-history,│
│   history-ahead-of-manifest, epoch-inconsistency, unknown                │
│ • Zero automatic recovery, zero disk writes, and zero worker side-effects│
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.7: Ownership Recovery Diagnostics UI Integration [COMPLETED]  │
│ • Integrated recovery & consistency section into DeviceDiagnosticsModal  │
│ • Visual badges, epoch comparison, event counters, & warning summaries   │
│ • Full pt-PT / en i18n support, zero action buttons, observation-only    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Phase D2.5.8: Ownership Architecture Hardening & Final Audit [COMPLETED] │
│ • Validated end-to-end lifecycle, isolation, & epoch fencing guarantees  │
│ • Comprehensive State Matrix (Device x Ownership x Provenance states)    │
│ • Ready for Phase 0.4.x (Companion Delta Search)                         │
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
