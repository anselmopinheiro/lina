# Lina Architecture — Device-Scoped State Foundation

**Status:** Implemented (Phase B, Phase D1, & Phase D1.1 Neutral Role)
**Scope:** Device-scoped state persistence at `.lina/devices/<deviceId>.json`, schema definition, ownership partitioning, synchronization conflict elimination, neutral unassigned startup role, and user-defined device naming.

---

## 1. Purpose & Motivation

In multi-device Obsidian environments (e.g. using Obsidian Sync, Syncthing, iCloud, Nextcloud, Git, or Dropbox), standard plugin settings (`data.json`) are synchronized across all participating devices.

When device-specific state (such as device nicknames, local hardware budgets, or local operational metadata) is stored inside `data.json`, concurrent edits on different devices result in **whole-file write collisions and silent overwrites**.

### The Phase B Solution
Phase B establishes a clean architectural separation between:
1. **Shared Configuration:** Stored in `.obsidian/plugins/lina/data.json` and synchronized globally across the vault.
2. **Device-Scoped State:** Stored in dedicated, device-isolated files at `.lina/devices/<deviceId>.json`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     LINA STORAGE OWNERSHIP PARTITIONING                  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    [Shared Vault Configuration]             [Device-Scoped State]
    • Stored in data.json                    • Stored in .lina/devices/<deviceId>.json
    • Global user preferences                • Unique per device UUID (Phase A)
    • Languages, Exclusions, Weights         • Optional device name, timestamps, role
    • Multi-reader, multi-writer             • Strictly Single-Writer per file
```

---

## 2. Ownership & Storage Model

### 2.1 Relationship with Phase A Identity
Each device is identified by its persistent UUID generated in Phase A via [`src/device/deviceIdentity.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceIdentity.ts).

The device-scoped state file is stored at:
```text
.lina/
└── devices/
    ├── c9bf9e57-1685-4c89-bafb-ff5af830be8a.json
    └── 550e8400-e29b-41d4-a716-446655440000.json
```

### 2.2 Core Invariants

> [!IMPORTANT]
> **Fundamental Synchronization Invariant:**  
> *Synchronization may transport device state across devices, but it does not change ownership of that state.*

1. **Strict Single-Writer:** Each device writes *only* to `.lina/devices/<its-own-deviceId>.json`. It never mutates state files belonging to other device IDs.
2. **Zero Lock Contention:** Because file paths are partitioned by unique device UUIDs, external synchronization engines never encounter concurrent write collisions across devices.
3. **Atomic Persistence:** Writes use temporary staging files (`<id>.json.tmp-<suffix>`) and atomic rename sequences to guarantee readers never observe partially written JSON.

---

## 3. Device State Schema

Implemented in [`src/device/deviceState.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceState.ts):

```typescript
export interface DeviceState {
  readonly schemaVersion: 1 | 2;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deviceName?: string;
  readonly role?: DeviceRole;
}
```

### Schema Properties
* **`schemaVersion` (`1 | 2`):** Schema version integer for forward/backward compatibility validation (version 2 supports optional `role` and `deviceName`).
* **`deviceId` (`string`):** The authoritative UUID v4 matching the local persistent identity. Never renamed or changed.
* **`createdAt` (`string`):** ISO 8601 creation timestamp.
* **`updatedAt` (`string`):** ISO 8601 last update timestamp.
* **`deviceName` (`string`, optional):** Optional human-readable nickname for this installation. Strictly user-defined; Lina never infers, guesses, or manufactures a device name from hardware, OS, or platform.
* **`role` (`DeviceRole`, optional):** Operational role (`"producer"` | `"companion"`). Unassigned by default on fresh installations until explicitly selected by the user.

---

## 4. Field Classification & Ownership Decisions

| Category | Storage Target | Status | Fields & Justification |
| :--- | :--- | :--- | :--- |
| **Shared Configuration** | `data.json` | **Implemented** | • `interfaceLanguage`, `embeddingDefaultLanguage`<br>• `embeddingsEnabled`, `hybridSearchTextWeight`, `hybridSearchSemanticWeight`<br>• `yamlSuggestionsEnabled`, `yamlAllowedProperties`, `yamlIncludeTags`<br>• `indexExcludedFolders`, `indexExcludedPathContains`, `indexExcludedContentContains`<br>• `inboxFolderPath`, `maxInboxNotesToAnalyze`<br>*Justification:* Represents global user intent that should be identical across all devices in the vault. |
| **Device-Scoped State** | `.lina/devices/<deviceId>.json` | **Implemented** | • `schemaVersion`<br>• `deviceId`<br>• `createdAt`, `updatedAt`<br>• `deviceName` (optional)<br>• `role` (optional)<br>*Justification:* Describes this specific installation and must not cause write collisions during sync. |
| **Credentials & Secrets** | `app.secretStorage` | **Implemented** | • `analysisApiKey`, `embeddingsApiKey`<br>*Justification:* API keys are stored in native local secure storage (Phase C) and never written to files. |
| **Operational Roles & Epochs** | Future Phases | *Future* | • Active producer ownership and epoch tokens<br>*Justification:* Requires Single-Active-Producer synchronization coordination in later phases. |

---

## 5. Persistence Service & Lifecycle Integration

The storage layer is encapsulated in [`src/device/deviceState.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceState.ts):

* **`getDeviceStatePath(deviceId: string): string`:** Generates normalized canonical path `.lina/devices/<deviceId>.json`.
* **`isDeviceState(value: unknown): value is DeviceState`:** Validates schema version, UUID formatting, and timestamps.
* **`createDefaultDeviceState(deviceId: string, deviceName?: string, role?: DeviceRole): DeviceState`:** Builds a fresh valid state instance with initial timestamps and unassigned optional fields unless explicitly provided.
* **`loadDeviceState(adapter: DeviceStateDataAdapter, deviceId: string): Promise<DeviceState | null>`:** Safely reads and validates the state file, returning `null` on missing or corrupted files.
* **`saveDeviceState(adapter: DeviceStateDataAdapter, state: DeviceState): Promise<void>`:** Atomically saves the state file using temporary staging and rename.
* **`getOrCreateDeviceState(adapter: DeviceStateDataAdapter, deviceId: string, deviceName?: string, role?: DeviceRole): Promise<DeviceState>`:** Reads existing state or atomically generates and persists default unassigned state on first access.

### 5.1 Runtime Startup Lifecycle Integration
During plugin startup (`LinaPlugin.onload()` -> `loadDataFromDisk()`):
1. Loads shared `data.json`.
2. Resolves persistent `deviceId` via `getOrCreatePersistentDeviceId(app)`.
3. Migrates legacy credentials to native `SecretStorage`.
4. Initializes or loads the device state file at `.lina/devices/<deviceId>.json` via `getOrCreateDeviceState(this.app.vault.adapter, persistentDeviceId)`.
5. If the file is missing, creates a clean state with `schemaVersion: 2` and no automatic role or inferred device name.
6. If the file exists, preserves existing stored roles (`"producer"` / `"companion"`) and device names without overwriting.
7. Restores index data and continues plugin startup.

---

## 6. Relationship with Future Architecture

Phase B, D1, & D1.1 establish the device-level namespace required for:
1. **Producer / Companion Configuration:** Devices independently record local resource limits and explicit role preferences in their own `<deviceId>.json` without modifying `data.json`.
2. **Synchronization Safety:** When vaults are synchronized across multiple computers, each machine's state file syncs harmlessly as a read-only peer record to other devices.
3. **Producer Coordination:** Enables standby devices to discover active producer metadata without distributed lock contention.
