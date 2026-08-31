# Lina Architecture — Persistent Device Identity Foundation

**Status:** Implemented (Phase A)  
**Scope:** Isolated, persistent, cross-platform device identity (`deviceId`) backed by official Obsidian APIs.

---

## 1. Overview & Problem Statement

Prior to Phase A, Lina generated device identifiers dynamically by hashing browser and hardware attributes via `window.navigator` (`userAgent|language|hardwareConcurrency|maxTouchPoints`) in `src/settings.ts`.

### Deficiencies of the Fingerprint Approach:
1. **Collision Risk:** Identical hardware models (e.g. two identical MacBook models or two standard iPhones running the same OS) generated the exact same hash `device-xxxx`. When both devices accessed a synchronized vault, they overwrote each other's configuration in `data.json.deviceSettingsById`.
2. **Instability Across Updates:** Browser minor updates, OS patches, or user language switches altered `navigator.userAgent` or language tokens, causing Lina to generate a new hash and permanently orphaning the user's previous device settings.
3. **Synchronized State Exposure:** Because device identities were ephemeral, per-device configurations had to be keyed into a shared dictionary in `data.json`, creating unnecessary write contention during vault synchronization.

---

## 2. Architectural Decision

Lina adopts a dedicated, isolated **Persistent Device Identity** layer implemented in [`src/device/deviceIdentity.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceIdentity.ts):

* **Identity Type:** Cryptographically secure random UUID v4 string (via `crypto.randomUUID()`).
* **Authoritative Persistence:** Backed exclusively by Obsidian's official `app.loadLocalStorage()` and `app.saveLocalStorage()` APIs.
* **Storage Location:** Stored in the local webview/Electron storage domain, strictly outside the vault filesystem.
* **Zero Synchronization Exposure:** Because `localStorage` is tied to the local application runtime, it is **never synchronized** by Obsidian Sync, Syncthing, iCloud, Nextcloud, Git, or Dropbox.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DEVICE IDENTITY LIFECYCLE                        │
└──────────────────────────────────────────────────────────────────────────┘

     First Startup / Storage Empty:
     ┌───────────────────┐
     │  No Stored ID     │
     └─────────┬─────────┘
               │
               ▼
     ┌───────────────────┐
     │ Generate UUID v4  │ (crypto.randomUUID())
     └─────────┬─────────┘
               │
               ▼
     ┌───────────────────┐
     │ Save Local Storage│ (app.saveLocalStorage("lina_device_id", uuid))
     └─────────┬─────────┘
               │
               ▼
     ┌───────────────────┐
     │ Authoritative ID  │
     └───────────────────┘

     Subsequent Startups:
     ┌───────────────────┐
     │ Load Local Storage│ (app.loadLocalStorage("lina_device_id"))
     └─────────┬─────────┘
               │
               ▼
     ┌───────────────────┐
     │ Validate UUID     │ (isValidDeviceId(stored))
     └─────────┬─────────┘
               │
               ▼
     ┌───────────────────┐
     │ Reuse Stored ID   │ (Zero regeneration, 100% stable)
     └───────────────────┘
```

---

## 3. Official Obsidian APIs Used

| API | Version Introduced | Scope | Synchronization Guarantee |
| :--- | :---: | :--- | :--- |
| **`app.loadLocalStorage(key: string): any`** | Obsidian 1.8.7 | Vault-scoped local storage on host device | **100% Unsynchronized** |
| **`app.saveLocalStorage(key: string, data: any): void`** | Obsidian 1.8.7 | Vault-scoped local storage on host device | **100% Unsynchronized** |

Both APIs are part of the public Obsidian Developer API and are fully supported across all platforms (Windows, macOS, Linux, iOS, Android) and satisfy Lina's minimum required version (`minAppVersion: 1.13.0`).

---

## 4. Service Implementation Details

The device identity service is encapsulated in [`src/device/deviceIdentity.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceIdentity.ts):

* **`LINA_DEVICE_ID_STORAGE_KEY`:** Constant key `"lina_device_id"` used in `localStorage`.
* **`DeviceIdentityStorage`:** Interface decoupling the storage boundary to enable unit testing without a full Obsidian runtime:
  ```typescript
  export interface DeviceIdentityStorage {
    loadLocalStorage(key: string): unknown;
    saveLocalStorage(key: string, data: unknown | null): void;
  }
  ```
* **`isValidDeviceId(value: unknown): boolean`:** Validates that an identifier matches canonical UUID v4 format.
* **`generateDeviceId(): string`:** Securely creates a random UUID string using `crypto.randomUUID()`.
* **`getOrCreatePersistentDeviceId(storage: DeviceIdentityStorage): string`:** Atomically retrieves the stored UUID or generates, persists, and returns a new one.

---

## 5. Migration Strategy & Backwards Compatibility

1. **Authoritative Precedence:** The persistent UUID from `getOrCreatePersistentDeviceId(app)` is the single authoritative source of truth for device identity.
2. **Non-Destructive Configuration Migration:** On initial startup with Phase A, if `this.settings.deviceSettingsById` contains settings under the old fingerprint (from `getLegacyFingerprintDeviceId()`), those settings are copied over to the new UUID key in `deviceSettingsById[newUuid]`. This preserves existing user configurations (e.g. customized model names, endpoints, timeouts) seamlessly.
3. **Deprecation of Fingerprinting:** `getLegacyFingerprintDeviceId()` is retained solely as a migration helper. The old fingerprint is never saved as the active device identity.

---

## 6. Relationship with Future Synchronization Architecture

Phase A establishes the foundational layer of Lina's multi-device architecture:

```
┌────────────────────────────────────────────────────────┐
│ Phase A: Persistent Device Identity (THIS PHASE)       │
│ • Stable, unsynced UUID v4 via app.saveLocalStorage    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Future: Device Capabilities & Role Resolution          │
│ • User preference vs Runtime platform capability       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Future: Granular Sync & Single-Producer Coordination   │
│ • Device-scoped namespaces (.lina/devices/<id>.json)   │
│ • Single-active-producer epoch & generation tracking   │
└────────────────────────────────────────────────────────┘
```

Phase A deliberately does **not** introduce Producer/Companion role selection, active producer ownership, epoch tokens, or SecretStorage migration.
