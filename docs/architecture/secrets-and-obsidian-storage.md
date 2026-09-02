# Lina Architecture — Secret Storage Migration

**Status:** Implemented (Phase C)  
**Scope:** Integration with Obsidian's official `app.secretStorage` API, elimination of plaintext API keys from `data.json`, and non-destructive migration for existing users.

---

## 1. Problem Statement & Motivation

Prior to Phase C, Lina persisted API keys in plaintext within `.obsidian/plugins/lina/data.json` (under `deviceSettingsById`, `aiApiKey`, and `embeddingApiKey`).

### Security Deficiencies of Plaintext Storage:
1. **Sync Cloud Exposure:** When users synchronize their vault using Obsidian Sync, Syncthing, iCloud, Nextcloud, Dropbox, or Git, plaintext API keys are uploaded to third-party servers and shared across all devices.
2. **Git Leakage:** Users who version-control their vault risk accidentally committing live API keys to public or private remote repositories.
3. **Cross-Device Misalignment:** Storing keys in shared configuration forces all devices to share keys or complicates per-device overriding in a single synchronized JSON document.

---

## 2. Architectural Decision & Security Boundary

Lina migrates all credential handling to Obsidian's official **SecretStorage API** (`app.secretStorage`), encapsulated within [`src/device/secretStorage.ts`](file:///d:/_dev/obsidian/lina/src/device/secretStorage.ts):

* **Local & Unsynchronized:** `SecretStorage` values are stored on the host device's local application storage and are **never synchronized** across vault sync channels.
* **Credentials Excluded from Filesystem:** API keys and tokens are **never written** to `data.json`, `.lina/devices/`, or any other vault file.
* **Separation of Configuration & Secrets:**
  - Provider configurations (provider name, model, endpoint URL, batch size, timeout) remain in `data.json`.
  - Credentials (API keys, authentication tokens) live exclusively in `app.secretStorage`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       SECURITY & STORAGE BOUNDARY                        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
     [Shared Configuration]                     [Secret Storage]
     • Stored in data.json                      • Stored in app.secretStorage
     • Provider: "mistral" / "openrouter"       • Key: "lina-analysis-api-key"
     • Model: "mistral-small-latest"            • Key: "lina-embeddings-api-key"
     • Base URL: "https://api.mistral.ai/v1"    • Plaintext never written to vault
     • Synchronized across devices              • 100% Device-Local & Unsynchronized
```

---

## 3. Standard Secret Keys

Lina reserves the following canonical Secret IDs in `app.secretStorage`:

| Key Constant | Secret ID | Domain | Purpose |
| :--- | :--- | :--- | :--- |
| `LINA_SECRET_KEYS.analysisApiKey` | `"lina-analysis-api-key"` | Analysis (Chat / Assist) | API key for Mistral, OpenRouter, or other remote text providers |
| `LINA_SECRET_KEYS.embeddingsApiKey` | `"lina-embeddings-api-key"` | Embeddings | API key for Mistral, OpenRouter, or other remote embedding providers |

*Note on Mistral Fallback:* If a dedicated embeddings key is not configured, Mistral embeddings gracefully fall back to reading `lina-analysis-api-key`.

---

## 4. Migration Strategy & Sequence

On plugin startup during `loadDataFromDisk()`, Lina runs an automatic migration via `migrateLegacyCredentials`:

```
┌────────────────────────────────────────────────────────┐
│ 1. Detect Legacy Keys in data.json                     │
│    (deviceSettingsById, aiApiKey, embeddingApiKey)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Check app.secretStorage for Existing Secret        │
│    (Never overwrite existing authoritative secrets)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Copy Legacy Key into app.secretStorage              │
│    (app.secretStorage.setSecret(id, legacyKey))        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. Verify Secret Persistence                           │
│    (app.secretStorage.getSecret(id) === legacyKey)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. Purge Plaintext from settings & Save data.json      │
│    (delete dev.analysisApiKey, dev.embeddingsApiKey)   │
└────────────────────────────────────────────────────────┘
```

### Safety Guarantees:
1. **Zero Overwrite:** If a secret already exists in `SecretStorage`, legacy values in `data.json` are ignored and cleaned up without overwriting the authoritative secret.
2. **Verification Before Deletion:** Plaintext fields are purged from `settings` only after `getSecret` confirms successful storage.
3. **Provider Preservation:** Model names, URLs, timeouts, and preferences are untouched during migration.

---

## 5. Implementation Layer & Components

* **[`src/device/secretStorage.ts`](file:///d:/_dev/obsidian/lina/src/device/secretStorage.ts):** Core SecretStorage service, validation, safe accessors, and migration engine.
* **[`src/settings/credentialRuntimeBridge.ts`](file:///d:/_dev/obsidian/lina/src/settings/credentialRuntimeBridge.ts):** Injects `secretStorage` into the declarative settings UI bridge, handling `save`, `clear`, `resolveCredential`, and availability indicators.
* **[`src/settings.ts`](file:///d:/_dev/obsidian/lina/src/settings.ts):** Passes `this.app.secretStorage` into settings context and credential bridges.
* **[`main.ts`](file:///d:/_dev/obsidian/lina/main.ts):** Runs startup migration and reads runtime embedding keys from `SecretStorage`.

---

## 6. Behavior for Missing Credentials & Providers

* **Ollama:** `requiresApiKey: false` — No secret is required or requested. Availability is always satisfied.
* **Mistral / OpenRouter:** `requiresApiKey: true` — If no secret is configured in `SecretStorage` (and no legacy key remains), connection tests report `analysis-api-key-missing` / `embeddings-api-key-missing` and runtime requests fail gracefully with an explanatory message.
* **Secret Removal:** When a user clicks "Clear" in settings, the secret is deleted from `SecretStorage` and settings are saved.

---

## 7. Pre-0.2.3 Secret Boundary Enforcement

Following the **Architecture Consistency Audit (0.2.3.1)**, the credential boundary was hardened against legacy write paths:

1. **Legacy Setter Protection:**
   - Functions `setLocalAnalysisApiKey()` and `setLocalEmbeddingsApiKey()` in `src/settings.ts` check `activeSecretStorage`.
   - When `SecretStorage` is present, credentials write exclusively to `app.secretStorage` and **never** call `setLocalVal()` or mutate `deviceSettingsById`.
   - Any prior plaintext keys lingering in `deviceSettingsById[deviceId]` or root settings are automatically purged and persisted without credentials.
2. **Backward-Compatible Deprecation:**
   - Fields `aiApiKey`, `embeddingApiKey`, `analysisApiKey`, `embeddingsApiKey`, and `aiProfileApiKeys` are marked `@deprecated` in `LinaDeviceSettings` and `LinaSettings`.
   - Vaults retaining historical JSON structures remain readable, but all setter paths strictly enforce `SecretStorage` persistence.
3. **Comprehensive Root & Cross-Device Migration:**
   - `migrateLegacyCredentials` inspects root fields (`analysisApiKey`, `embeddingsApiKey`, `aiApiKey`, `embeddingApiKey`) as well as all device entries in `deviceSettingsById`.
   - Any discovered credentials are confirmed in `SecretStorage` and completely scrubbed from `data.json`.
4. **Zero-Sync Secret Guarantee:**
   - `app.secretStorage` resides strictly in local platform storage outside the vault directory.
   - Synchronized files (`data.json`, `.lina/ownership.json`, `.lina/devices/*.json`, `.lina/index/*`) never contain API keys.
   - Mobile Companion devices operating in read-only mode receive zero secrets across synchronization channels.
