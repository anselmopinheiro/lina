# Lina Architecture — Device Role Model Foundation

**Status:** Implemented (Phase D1 & Phase D1.1 Neutral Role)
**Scope:** Definition of the `DeviceRole` model, separation of identity, capabilities, and roles, persistence within device-scoped state (`.lina/devices/<deviceId>.json`), and neutral unassigned initial role.

---

## 1. Overview & Separation of Concerns

Lina separates device identity, platform capabilities, user-selected roles, and future artifact ownership into distinct architectural tiers:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     LINA DEVICE ARCHITECTURE TIERS                       │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. Device Identity (Phase A — Implemented)                               │
│    • Answers: "Who is this installation?"                                │
│    • Persistent UUID v4 stored in app.loadLocalStorage                   │
│    • Stable, platform-independent, 100% unsynchronized                   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. Device Capabilities (Implemented)                                     │
│    • Answers: "What can this installation technically do?"               │
│    • Evaluated from runtime platform & hardware bounds                   │
│    • canMaintainTextIndex, canGenerateEmbeddings, resourceProfile        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. Device Role (Phase D1 & D1.1 — Implemented)                           │
│    • Answers: "How should Lina use this installation?"                   │
│    • Operational role: "producer" | "companion" (optional, unselected)   │
│    • Persisted per-device in .lina/devices/<deviceId>.json               │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. Producer Ownership & Provenance (Phases D2.1 – D2.3.1 — Implemented)   │
│    • Answers: "Which installation is authorized to publish artifacts?"   │
│    • Single active producer manifest with epoch fencing (.lina/ownership)│
│    • Worker ownership gating, immutable provenance, & validation audit   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Terminology & Concept Separation

### A. Identity (*Who is this installation?*)
* Encapsulated by `deviceId` (UUID v4) generated in Phase A.
* Does not dictate what the device can do or how it is used.

### B. Capabilities (*What can this installation technically do?*)
* Encapsulated by `DeviceCapabilities` in [`src/capabilities/deviceCapabilities.ts`](file:///d:/_dev/obsidian/lina/src/capabilities/deviceCapabilities.ts).
* Represents immutable technical constraints imposed by host hardware, OS environment, and memory budgets.

### C. Role (*How should Lina use this installation?*)
* Encapsulated by `DeviceRole` in [`src/device/deviceRole.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceRole.ts).
* Represents the user-configured operational intent for this installation.
* **Separation Principle:** Role and Capability must never be conflated.
  - A device configured as `role = "producer"` may still have `canGenerateEmbeddings = false` if local embedding requirements are not met.
  - A desktop workstation with full capabilities can be explicitly configured as `role = "companion"` to act as a lightweight consumer in a multi-machine setup.
  - Lina never automatically persists a role based on platform type (`isMobile`). Newly initialized devices start with an unassigned role until the user chooses.

---

## 3. Implemented Device Roles

The `DeviceRole` type defines two operational roles:

```typescript
export type DeviceRole = "producer" | "companion";
```

### 1. Producer (`"producer"`)
* **Intent:** Designated to actively maintain shared vault search assets (text index, canonical vector embeddings, compiled binary copies).

### 2. Companion (`"companion"`)
* **Intent:** Operates as a consumer of synchronized search assets (performing fast local searches, AI note analysis, and contextual commands without running local index compilation loops).

### 3. Unassigned (Omitted `role`)
* **Intent:** A newly created device state does not possess an explicit role until chosen by the user.

---

## 4. Storage & Persistence Model

The device role is stored inside the device's isolated, single-writer state file established in Phase B:

* **File Location:** `.lina/devices/<deviceId>.json`
* **Schema Version:** `2`

```json
{
  "schemaVersion": 2,
  "deviceId": "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
  "createdAt": "2026-08-31T21:00:00.000Z",
  "updatedAt": "2026-08-31T21:00:00.000Z"
}
```

When named and configured:

```json
{
  "schemaVersion": 2,
  "deviceId": "c9bf9e57-1685-4c89-bafb-ff5af830be8a",
  "deviceName": "Mac Studio",
  "role": "producer",
  "createdAt": "2026-08-31T21:00:00.000Z",
  "updatedAt": "2026-08-31T21:00:00.000Z"
}
```

### Storage Invariants:
1. **No Shared Settings Pollutions:** The role is **never stored in `data.json`**, ensuring multi-device vaults do not overwrite each other's role assignments during synchronization.
2. **Backward Compatibility:** `loadDeviceState` seamlessly reads legacy `schemaVersion: 1` files as well as `schemaVersion: 2` files with or without `role` and `deviceName`.
3. **Atomic Updates:** Role updates via `updateDeviceRole()` use temporary staging files and atomic rename sequences.

### 4.1 Runtime Startup Integration
During plugin startup (`LinaPlugin.onload()` -> `loadDataFromDisk()`):
- The plugin resolves the persistent `deviceId` via `getOrCreatePersistentDeviceId(app)` and calls `getOrCreateDeviceState(this.app.vault.adapter, persistentDeviceId)`.
- If a device state file exists at `.lina/devices/<deviceId>.json`, it is loaded as-is, preserving existing user-configured roles (`"producer"` / `"companion"`) and device names.
- If missing, a default state file is atomically created with `schemaVersion: 2`, initial timestamps, and no automatic role or inferred device name.

---

## 5. Relationship with Subsequent Architecture

Phase D1 & D1.1 prepared the foundation for subsequent ownership and coordination layers:
1. **Single-Active-Producer Ownership (Phases D2.1 & D2.2 — Implemented):** Capable producer devices evaluate `.lina/ownership.json` epoch tokens before modifying `.lina/index/*`, preventing split-brain conflicts and sync collisions. See [`docs/architecture/producer-ownership.md`](file:///d:/_dev/obsidian/lina/docs/architecture/producer-ownership.md).
2. **Artifact Provenance & Validation (Phases D2.3 & D2.3.1 — Implemented):** Shared artifacts carry immutable provenance metadata (`producerDeviceId`, `producerEpoch`, `generatedAt`) and are validated non-destructively against active vault ownership.
3. **Companion Delta Search (Future Phase):** Companion devices will utilize their explicit role to maintain ephemeral local search deltas for recent unindexed note edits without modifying canonical shared artifacts.
