# Lina Architecture — Secrets, Credentials & Obsidian Storage

**Status:** Technical Architecture Audit (Read-Only)  
**Author:** Architecture Audit  
**Date:** August 2026  
**Scope:** Current credential storage audit, official Obsidian `SecretStorage` specification, Desktop/Mobile behavior, migration strategy, and secure persistence boundaries.

---

## 1. Current State Audit: Credential Persistence

### 1.1 Existing Storage Model
In the current implementation, API keys and provider credentials are saved directly as unencrypted strings inside `.obsidian/plugins/lina/data.json`:

1. **Per-Device Credential Map:**
   * `data.json` -> `.settings.deviceSettingsById[deviceId].analysisApiKey`
   * `data.json` -> `.settings.deviceSettingsById[deviceId].embeddingsApiKey`
   * `data.json` -> `.settings.deviceSettingsById[deviceId].aiProfileApiKeys`
2. **Global Legacy Fields:**
   * `data.json` -> `.settings.aiApiKey`
   * `data.json` -> `.settings.embeddingApiKey`

### 1.2 Recent Hardening (Phase 9M-C / 9N-C4A)
Phase 9M-C and Phase 9N-C4A significantly improved the in-memory handling and UI presentation of credentials via [`src/settings/pureCredentialModel.ts`](file:///d:/_dev/obsidian/lina/src/settings/pureCredentialModel.ts) and [`src/settings/credentialRuntimeBridge.ts`](file:///d:/_dev/obsidian/lina/src/settings/credentialRuntimeBridge.ts):
* **No Pre-filling:** Credential input fields always start empty.
* **No Secrets in Memory Models:** UI descriptors, diagnostic snapshots, and logs never contain secret values; they receive only presence booleans (`analysisDevice: true/false`).
* **Explicit Action:** Saving and clearing credentials require explicit user actions.
* **Isolated Runtime Bridge:** The raw secret is only accessed at the moment of request execution via `resolveCredential()`.

### 1.3 The Remaining Vulnerability: Storage Exposure
Despite memory-layer hardening, the underlying storage boundary ([`credentialRuntimeBridge.ts:93-107`](file:///d:/_dev/obsidian/lina/src/settings/credentialRuntimeBridge.ts#L93-L107)) still writes the plaintext string into `data.json`:

```typescript
// Current storage write in credentialRuntimeBridge.ts
function cloneWithCredential(
  settings: CredentialRuntimeSettingsSnapshot,
  ref: CredentialRef,
  value: string | undefined,
): CredentialRuntimeSettingsSnapshot {
  const devices = { ...(settings.deviceSettingsById ?? {}) };
  const device = { ...(devices[ref.deviceId] ?? {}) };
  const key = ref.domain === "analysis" ? "analysisApiKey" : "embeddingsApiKey";
  if (value) {
    device[key] = value;
  } else {
    delete device[key];
  }
  devices[ref.deviceId] = device;
  return { ...settings, deviceSettingsById: devices };
}
```

**Critical Risk:** Because `data.json` is synchronized by Obsidian Sync, Syncthing, iCloud, Nextcloud, and Git, the user's private API keys (e.g. OpenRouter, Mistral, OpenAI) are broadcast across all synchronized devices in plaintext.

---

## 2. Official Obsidian `SecretStorage` API

Obsidian introduced the official `SecretStorage` API in **Obsidian 1.11.4** to provide a secure, device-local key-value store for sensitive data.

### 2.1 API Specification
Accessible via `app.secretStorage`, the API exposes three core methods:

```typescript
export class SecretStorage extends Events {
  /**
   * Sets a secret in the storage.
   * @param id Lowercase alphanumeric ID with optional dashes (e.g. "lina-analysis-key")
   * @param secret The secret value to store
   * @throws Error if ID is invalid
   * @since 1.11.4
   */
  setSecret(id: string, secret: string): void;

  /**
   * Gets a secret from storage
   * @param id The secret ID
   * @returns The secret value or null if not found
   * @since 1.11.4
   */
  getSecret(id: string): string | null;

  /**
   * Lists all secrets in storage
   * @returns Array of secret IDs
   * @since 1.11.4
   */
  listSecrets(): string[];
}
```

### 2.2 Storage & Synchronization Characteristics

| Property | `SecretStorage` Behavior |
| :--- | :--- |
| **Physical Storage** | Stored in local OS/Electron/Webview secure storage, completely isolated from the vault filesystem. |
| **Vault Scope** | Scoped to the current vault on the local device. |
| **Synchronization** | **NEVER synchronized.** Obsidian Sync, Syncthing, iCloud, and Git cannot see or sync secrets stored via `SecretStorage`. |
| **Desktop Support** | Supported on Windows, macOS, and Linux (Obsidian $\ge 1.11.4$). |
| **Mobile Support** | Supported on iOS and Android (Obsidian $\ge 1.11.4$). |
| **Lina Compatibility** | Lina's `manifest.json` specifies `"minAppVersion": "1.13.0"`, guaranteeing 100% availability across all installations. |

---

## 3. Storage Boundary Partitioning

To ensure security without sacrificing synchronization convenience, settings are strictly partitioned:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   STORAGE PARTITIONING FOR SECRETS                                     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  ┌──────────────────────────────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │   PERMITTED IN SYNCHRONIZED SETTINGS (data.json)     │  │    PROHIBITED IN SYNCHRONIZED SETTINGS     │  │
│  ├──────────────────────────────────────────────────────┤  ├────────────────────────────────────────┤  │
│  │ • Provider ID ("ollama", "mistral", "openrouter")    │  │ • Raw API Key strings                  │  │
│  │ • Model Name ("mistral-small-latest", "gemma4:e2b")  │  │ • Bearer authentication tokens         │  │
│  │ • Endpoint Base URL ("https://openrouter.ai/api/v1") │  │ • User passwords / Client secrets      │  │
│  │ • Secret Reference Key ("lina-analysis-key")         │  │ • Private headers                      │  │
│  │ • Request Timeout & Batch Size parameters            │  │                                        │  │
│  │ • Output Language & Exclusion rules                  │  │                                        │  │
│  └──────────────────────────────────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                                                        │
│                                              ▼                                                         │
│                                ┌───────────────────────────┐                                           │
│                                │   app.secretStorage ONLY  │                                           │
│                                └───────────────────────────┘                                           │
│                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Migration Architecture & Fallback Protocol

To transition seamlessly from legacy `data.json` plaintext storage to `SecretStorage` without breaking existing installations or disrupting users:

### 4.1 Safe Secret Resolution (Read Path)
When resolving credentials for connection tests or AI queries, the runtime bridge follows a prioritized fallback chain:

```mermaid
flowchart TD
    Start([Execute Provider Request]) --> Step1{Check SecretStorage<br/>app.secretStorage.getSecret}
    Step1 -- Found --> Done([Use Secret in Request])
    Step1 -- Null / Empty --> Step2{Check Device Setting in data.json<br/>deviceSettingsById[id].apiKey}
    Step2 -- Found --> Step2Migrate[Use Secret + Queue Lazy Migration to SecretStorage] --> Done
    Step2 -- Missing --> Step3{Check Legacy Global Setting<br/>settings.aiApiKey}
    Step3 -- Found --> Step3Migrate[Use Secret + Queue Lazy Migration to SecretStorage] --> Done
    Step3 -- Missing --> Absent([No Credential Available])
```

### 4.2 Safe Credential Mutation (Write Path)
When the user enters an API key in the settings tab and clicks **Save**:
1. Write the secret into `app.secretStorage`:
   ```typescript
   app.secretStorage.setSecret("lina-analysis-api-key", enteredKey.trim());
   ```
2. **Purge** plaintext keys from `data.json`:
   ```typescript
   delete activeSettings.deviceSettingsById?.[deviceId]?.analysisApiKey;
   delete activeSettings.aiApiKey;
   await this.saveDataToDisk();
   ```
3. Update presence state in `pureCredentialModel` (`available: true`).

### 4.3 Safe Credential Clear (Destructive Path)
When the user clicks **Clear** and confirms in the confirmation modal:
1. Clear the secret from `app.secretStorage`:
   ```typescript
   app.secretStorage.setSecret("lina-analysis-api-key", "");
   ```
2. Ensure any legacy keys in `data.json` are purged:
   ```typescript
   delete activeSettings.deviceSettingsById?.[deviceId]?.analysisApiKey;
   delete activeSettings.aiApiKey;
   await this.saveDataToDisk();
   ```
3. Update presence state in `pureCredentialModel` (`available: false`).

---

## 5. Security & Mobile Considerations

1. **Mobile Isolation:** Because `SecretStorage` does not sync, users configure their API key once per device. This is the correct security posture for mobile devices, which may be lost, shared, or operate in untrusted environments.
2. **Vault Migration & Cloning:** When a vault is moved or copied to a new machine without local OS keychain access, `SecretStorage` remains empty. The user simply re-enters their key once on the new machine. No keys are ever left behind in vault files or cloud backups.
3. **Secret Identifiers:** Secret IDs in `SecretStorage` should be standardized across Lina:
   * Analysis API Key: `"lina-analysis-api-key"`
   * Embeddings API Key: `"lina-embeddings-api-key"`

---

## 6. Official References
* [Obsidian Developer Documentation — SecretStorage](https://docs.obsidian.md/Reference/TypeScript+API/SecretStorage)
* [Obsidian Developer Documentation — App.secretStorage](https://docs.obsidian.md/Reference/TypeScript+API/App/secretStorage)
* [Obsidian API Type Definitions (`obsidian.d.ts:458, 5635-5663`)](file:///d:/_dev/obsidian/lina/node_modules/obsidian/obsidian.d.ts#L458)
