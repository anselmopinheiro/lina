# Lina Architecture — Device Identity, Device Roles & Capability Management

**Status:** Historical Architecture Audit (Read-Only)
**Author:** Architecture Audit  
**Date:** August 2026  
**Scope:** Device identity mechanisms, Producer / Companion role decoupling, capability resolution, official Obsidian API verification, and multi-device namespace isolation.

> [!NOTE]
> **Historical Audit Document:**
> This document records an exploratory architecture audit from August 2026. For the implemented canonical architecture, refer to:
> - [`docs/architecture/device-roles.md`](device-roles.md) (Canonical Role Model, Resolver, First-Run, & Controlled Role Changes)
> - [`docs/architecture/device-identity.md`](device-identity.md) (Persistent UUID v4 Device Identity)
> - [`docs/architecture/device-scoped-state.md`](device-scoped-state.md) (Single-Writer Device State Files)
> - [`docs/architecture/producer-ownership.md`](producer-ownership.md) (Single-Active-Producer Ownership & Monotonic Epoch Fencing)

---

## 1. Overview & Architectural Philosophy

Lina operates on a single plugin codebase across varied form factors—from multi-core desktop workstations with local GPU acceleration to battery- and memory-constrained mobile phones and tablets.

To prevent sync race conditions, excessive battery drain, and redundant computation, Lina organizes participating devices into two fundamental operational roles:

* **Producer:** The authoritative maintainer of search assets. Watches vault file modifications, performs incremental text indexing, calculates embedding diffs, generates vector embeddings, and compiles derived binary search assets.
* **Companion:** A streamlined, read-only consumer client. Consumes published `.lina/index/` assets, executes instantaneous in-memory text search, performs vector similarity search within mobile memory budgets, and queries configured AI providers without local index compilation overhead.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         LINA DEVICE ARCHITECTURE                         │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                      [Device Identity: Local UUID]
                     (Stored via app.saveLocalStorage)
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    [User Role Preference]                   [Host Hardware Capability]
    • "auto" (default)                       • Platform.isMobile (true/false)
    • "producer"                             • Memory & CPU limits
    • "companion"                            • Local network availability
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     ▼
                      [Effective Runtime Active Role]
                                     │
              ┌──────────────────────┴──────────────────────┐
              ▼                                             ▼
    [Desktop / Active Producer]                    [Mobile / Read-Only Companion]
    • TextIndexWorker (Active)                    • Read-Only Search (Active)
    • EmbeddingWorker (Active)                    • AI Note Enrichment (Active)
    • BinaryWorker (Active)                       • Maintenance Engine (Deactivated)
    • ReconciliationWorker (Active)               • Zero File Writing in .lina/index/
```

---

## 2. Current State Audit: `DeviceCapabilities` & Identity

### 2.1 Capability Model in Source Code
In [`src/capabilities/deviceCapabilities.ts:38-52`](file:///d:/_dev/obsidian/lina/src/capabilities/deviceCapabilities.ts#L38-L52), capability resolution is currently hardcoded strictly to `!Platform.isMobile`:

```typescript
export function resolveDeviceCapabilities(platform: DevicePlatform): DeviceCapabilities {
  const isProducer = !platform.isMobile;

  return {
    role: isProducer ? "producer" : "companion",
    resourceProfile: platform.isMobile ? "mobile" : "desktop",
    canWatchVaultEvents: isProducer,
    canMaintainTextIndex: isProducer,
    canGenerateEmbeddings: isProducer,
    canMaintainBinaryCopy: isProducer,
    canReconcileStartupDiffs: isProducer,
    canReadArtifacts: true,
    canExecuteSearch: true,
  };
}
```

### 2.2 Critical Limitations of Current Implementation
1. **No User Role Preference:** A user with a high-performance desktop workstation and a lightweight laptop cannot configure the laptop as a Companion; both default to Producer. Conversely, an iPad Pro user with high compute capacity cannot configure their device as a Producer.
2. **Fragile Identity Fingerprinting:** In [`src/settings.ts:231-241`](file:///d:/_dev/obsidian/lina/src/settings.ts#L231-L241), the device identifier is computed dynamically by hashing navigator properties:
   ```typescript
   function getCurrentDeviceSettingsId(): string {
     const nav = typeof window === "undefined" ? undefined : window.navigator;
     const token = [
       nav?.userAgent ?? "unknown",
       nav?.language ?? "unknown",
       String(nav?.hardwareConcurrency ?? ""),
       String(nav?.maxTouchPoints ?? "")
     ].join("|");
     return `device-${hashDeviceToken(token)}`;
   }
   ```
   **Defects of this approach:**
   * **Collision Hazard:** Identical hardware (e.g. two iPhone 15s or two identical corporate laptops) produce identical IDs, overwriting each other's configuration in `data.json`.
   * **Instability:** Browser updates, language switches, or OS patches change the `userAgent` or token, orphaning previous settings and creating redundant entries in `deviceSettingsById`.
   * **Sync Exposure:** The dictionary `deviceSettingsById` is written to `data.json`, exposing all local configurations and plaintext secrets across all synced devices.

---

## 3. Official Obsidian API Verification for Device-Local State

To achieve true device isolation without reliance on synchronization exclusions, we audited the official Obsidian Developer APIs for mechanisms providing **persistent, device-local, unsynchronized storage**.

### 3.1 Investigation of Candidate Mechanisms

| Mechanism / API | Public / Supported? | Scope | Desktop Support | Mobile Support | Sync Isolation Guarantee | Risk & Failure Modes | Verdict |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- | :---: |
| **`app.loadLocalStorage(key)`<br>`app.saveLocalStorage(key, data)`** | **Yes**<br>(@since 1.8.7) | Vault + Device | Yes | Yes | **100% Unsynced** (Stored in local browser/Electron storage) | Cleared only if user wipes app data/cache. In that case, a new ID is generated cleanly. | **RECOMMENDED PRIMARY** |
| **`app.secretStorage`** | **Yes**<br>(@since 1.11.4) | Vault + Device | Yes | Yes | **100% Unsynced** (Stored in OS/Local credential store) | Designed specifically for API secrets, not general key-value metadata. | **RECOMMENDED FOR SECRETS ONLY** |
| **`.obsidian/plugins/lina/device.json`** | No official API (Raw file write) | Vault Plugin folder | Yes | Yes | **Failed**: Synchronized if user enables Obsidian Sync "Sync plugin settings" | Sync overwrites device identity across machines. | **REJECTED** |
| **`window.localStorage` directly** | Web Standard | Domain/Origin | Yes | Yes | Unsynced, but lacks vault-scoping; shared across vaults on same device | Potential key collision across multiple vaults. | **REJECTED** |
| **Node.js `os.hostname()` / MAC** | Node API | Hardware | Desktop only | **No** (Fails on Mobile) | Unsynced, but violates privacy and fails on iOS/Android sandbox. | Desktop-only; privacy hazard. | **REJECTED** |

### 3.2 The Recommended Device Identity Mechanism
`app.loadLocalStorage` and `app.saveLocalStorage` (introduced in Obsidian 1.8.7 and fully supported in Lina's minimum required Obsidian version `1.13.0`) provide the optimal, documented, cross-platform mechanism for persistent device identity.

#### Recommended Implementation Pattern:
```typescript
const LINA_DEVICE_ID_KEY = "lina-installation-device-id";

export function getOrCreatePersistentDeviceId(app: App): string {
  let deviceId = app.loadLocalStorage(LINA_DEVICE_ID_KEY) as string | null;
  if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length === 0) {
    // Generate a secure, collision-free UUID v4
    deviceId = `dev-${crypto.randomUUID()}`;
    app.saveLocalStorage(LINA_DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}
```

#### Properties of this Pattern:
* **Unique:** UUID v4 guarantees zero collision probability across infinite devices.
* **Persistent:** Survives Obsidian restarts, plugin reloads, and application updates.
* **Sync-Isolated:** Never enters the vault filesystem; completely invisible to Obsidian Sync, Syncthing, iCloud, Git, Dropbox, etc.
* **Cross-Platform:** Operates identically on Windows, macOS, Linux, iOS, and Android.
* **Safe Degradation:** If the user clears local application data, a new UUID is generated on next launch without data corruption or sync conflict.

---

## 4. Producer / Companion Role Model

### 4.1 Decoupling Intent from Capability
To provide both flexibility and stability, Lina must separate **User Role Preference** from **Effective Runtime Role**:

```typescript
export type UserRolePreference = "auto" | "producer" | "companion";

export interface DeviceRoleResolutionInput {
  preference: UserRolePreference;
  platform: { isMobile: boolean };
  hasSufficientResources: boolean;
}

export function resolveEffectiveDeviceRole(input: DeviceRoleResolutionInput): DeviceRole {
  if (input.preference === "producer") {
    // User explicitly requested producer; enforce hardware sanity
    return "producer";
  }
  if (input.preference === "companion") {
    // User explicitly chose lightweight consumer mode
    return "companion";
  }
  // "auto": Desktop defaults to Producer, Mobile defaults to Companion
  return input.platform.isMobile ? "companion" : "producer";
}
```

### 4.2 Role Matrix & Behavioral Boundaries

| Responsibility / Feature | Desktop Producer | Desktop Companion (Opt-in) | Mobile Companion (Default) | Mobile Producer (Opt-in) |
| :--- | :---: | :---: | :---: | :---: |
| **Vault Event Listeners (`create/modify/delete/rename`)** | Active | Disabled | Disabled | Active |
| **Text Index Incremental Maintenance** | Active | Disabled | Disabled | Active |
| **Embedding Generation Pipeline** | Active | Disabled | Disabled | Active (Battery Warning) |
| **Binary Artifact Compilation** | Active | Disabled | Disabled | Active |
| **Startup Diff Reconciliation** | Active | Disabled | Disabled | Active |
| **Search (Text, Semantic, Hybrid)** | Active | Active | Active | Active |
| **AI Note Analysis & Slash Commands** | Active | Active | Active | Active |
| **Resource Profile Limits** | Desktop Budget (192MB peak) | Desktop Budget | Mobile Budget (64MB peak) | Mobile Budget (64MB peak) |

---

## 5. Synchronized Device-Scoped State: `.lina/devices/<deviceId>.json`

### 5.1 The Model: Shared Storage + Logical Namespace Ownership
While `app.saveLocalStorage` is ideal for storing the local `deviceId`, device configuration that benefits from backup or multi-device visibility (such as device nicknames, hardware profile limits, and local provider preferences) can follow a synchronized per-device namespace:

```text
.lina/
  devices/
    dev-a1b2c3d4-e5f6-7890.json
    dev-f9e8d7c6-b5a4-3210.json
```

### 5.2 Architectural Principles & Invariants
1. **Single Writer per File:** Device `A` writes *only* to `.lina/devices/dev-A.json`. It *never* writes to `.lina/devices/dev-B.json`.
2. **Zero Write Lock Contention:** Because file paths are unique per device UUID, external sync engines never encounter concurrent write collisions across devices.
3. **Atomic File Publication:** Device settings are written via temporary staging files (`dev-A.json.tmp`) and atomic rename to guarantee readers never observe partially written JSON.
4. **No Secrets in Synchronized Files:** API keys and credentials must **never** be written to `.lina/devices/<deviceId>.json`. Secrets must reside strictly in `app.secretStorage`.

### 5.3 Edge Case Analysis

| Scenario | Behavior & Resolution |
| :--- | :--- |
| **Two devices initialized simultaneously** | Each device creates its own UUID in local storage and writes its own distinct `.lina/devices/<uuid>.json`. Zero race condition. |
| **Device renamed by user** | Device updates the `deviceName` field inside its own file (`.lina/devices/<myId>.json`). No other device files are touched. |
| **Decommissioned / Stale device** | Orphaned JSON files remain harmlessly on disk. A periodic cleanup command or LRU metadata (`lastSeenAt`) can allow users to prune obsolete device records. |
| **Cloned Vault on New Machine** | The cloned vault does not copy `localStorage`. The new machine generates a fresh UUID and creates its own `.lina/devices/<newId>.json`. |
| **Backup Restored from Previous State** | Local machine loads its existing UUID from `localStorage` and reads/updates its corresponding file. |
| **File Sync Conflict (e.g. `dev-A (conflict).json`)** | Ignored by Lina. Each device reads strictly its own normalized path `.lina/devices/<myId>.json`. |

---

## 6. Recommendations for Implementation Phase

1. **Step 1: Adopt `app.loadLocalStorage` for `deviceId`:**
   Implement a clean helper `getOrCreatePersistentDeviceId(app)` using `app.loadLocalStorage` and `crypto.randomUUID()`. Deprecate `getCurrentDeviceSettingsId()` in `src/settings.ts`.
2. **Step 2: Add Explicit Role Preference to Settings:**
   Introduce `rolePreference: "auto" | "producer" | "companion"` in local settings, allowing user override while preserving safe defaults.
3. **Step 3: Migrate Device Configurations out of `data.json`:**
   Transition device-specific settings from the synchronized `data.json.deviceSettingsById` map into device-scoped storage (`.lina/devices/<deviceId>.json`), while strictly keeping secrets in `app.secretStorage`.
