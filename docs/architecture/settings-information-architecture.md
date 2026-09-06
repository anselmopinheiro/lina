# Settings & UX Information Architecture

## Context & Objectives

As Lina entered the Release Stabilization phase (0.3.x), the capabilities of the plugin (Desktop Producer + Mobile Companion model, embedding update lifecycle, provider policy, scheduler, backoff protection, SecretStorage boundaries) matured significantly.

The objective of **Native Settings Pages Architecture** (`LINA-UX-IMPL-004`), following the earlier grouping foundation, is to structure the complete 50-setting catalog using Obsidian's official native pages navigation (`SettingDefinitionPage`), organized around a clean root hub. This eliminates vertical pseudo-accordions, reduces scroll depth, maximizes mobile ergonomics, preserves native Settings Search, and enforces unambiguous domain separation without altering underlying storage keys or runtime semantics.

### Core UX Principles

> **Show users what they need to operate Lina. Hide technical complexity until it is required.**
>
> **Configuration should be grouped by user intent and domain coherence, not by technical implementation.**
>
> **Native subpage navigation provides focused, high-clarity views while retaining 100% of capabilities.**

---

## Native Settings Pages Architecture (`SettingDefinitionPage`)

Lina settings are structured around a central root hub that frames **5 native Obsidian subpages**, flanked by an uncollapsed general header and a dedicated support footer:

```text
General / Interface (Root Hub Header)
├── Plugin identity & build version
└── Interface language selector & multilingual guidance

› 📱/🟢 Dispositivo e Produtor / Device & Producer (Native Page)
  ├── Current device role badge, first-run chooser, active producer transfer, role switching
  └── Friendly local device name

› 🤖 Assistente de IA e Análise / AI Assistant & Analysis (Native Page)
  ├── Complete provider setup: provider, model, base URL endpoint, API credentials
  ├── Connection test action & instant diagnostic feedback
  └── Analysis tuning: timeout, inbox folder, YAML allowed properties, tag suggestions count

› 🔍 Pesquisa Semântica e Embeddings / Semantic Search & Embeddings (Native Page)
  ├── Complete semantic setup: enable toggle, provider, model, base URL, API credentials
  ├── Embedding update policy (manual vs automatic-local-only) & connection test
  └── Semantic tuning: batch size, timeout, language hint, hybrid search balance weights

› 🛡️ Privacidade e Regras de Exclusão / Privacy & Exclusion Rules (Native Page)
  ├── Excluded folders & configuration notice
  └── Sensitive path pattern exclusions & content exclusion keyword terms

› ⚙️ Diagnóstico e Manutenção / Diagnostics & Advanced Maintenance (Native Page)
  ├── Automatic index maintenance on file changes & startup re-indexing
  ├── Startup sync verification check & debug update logging
  └── Search acceleration storage preference (prefer-binary vs jsonl), maintenance toggle,
      status inspector, and cache actions (check, create/update, remove)

Support & Contact (Root Hub Footer)
├── Support & feedback form link
└── Email support contact with one-click copy button
```

### Domain Separation & Page Responsibilities

1. **Root Hub Header (General / Interface):** Resides directly on the main settings page. Provides plugin version, compile-time build indicators, and immediate language selection (`pt-PT` / `en`).
2. **Page 1 (`device-producer` — Device & Producer):** Focused strictly on device identity, assigned role, active producer ownership transitions, and device naming.
3. **Page 2 (`ai-assistant` — AI Assistant & Analysis):** Isolates configuration, credentials (`SecretStorage`), connection tests, and workspace tuning for note analysis and slash commands (`/ask`, `/tags`, `/yaml`).
4. **Page 3 (`semantic-search` — Semantic Search & Embeddings):** Contains semantic search controls, embedding provider/model selection, update policy, connection test, and hybrid balance tuning.
5. **Page 4 (`privacy-exclusions` — Privacy & Exclusion Rules):** Dedicated to folder, path, and content keyword exclusions, with read-only gating enforced on Companion devices.
6. **Page 5 (`diagnostics-maintenance` — Diagnostics & Advanced Maintenance):** Encapsulates background sync checks, debug logging, and heavy binary acceleration cache operations.
7. **Root Hub Footer (Support & Contact):** Resides directly on the main settings page. Provides direct access to the feedback form and email contact with a one-click copy button.

### UX & Architectural Rationale
- **Subpage Navigation:** Replaced pseudo-accordions with native Obsidian `SettingDefinitionPage` elements, eliminating deep vertical scrolling and DOM clutter.
- **Mobile Usability:** On mobile devices, clicking a domain opens a dedicated, distraction-free page with Obsidian's standard native back button, providing an optimal handheld experience.
- **Search Preservation:** Native Obsidian Settings Search (`searchQuery`) indexes definitions across all subpages, allowing users to jump directly to any setting.
- **Zero Settings Deleted:** Preserves all 50 canonical setting definitions with identical data keys and runtime behaviors.

---

## Multi-Device Role Behavior & Embedding Inheritance

Lina strictly adapts settings according to the active device role:

### 1. Active Producer
- Holds full administrative authority over shared vault artifacts.
- Defines the embedding provider and model, publishing the canonical `VectorContractV1` in `.lina/index/manifest.json`.
- Can rebuild, update, and maintain text indices, vector embeddings, and binary acceleration caches.
- Manages vault-wide exclusion rules in `.lina/exclusions.json`.

### 2. Companion (Desktop / Mobile)
- Operates as a lightweight consumer with zero background compilation.
- **Contract Inheritance:** Does not configure or select embedding provider or model. Values are inherited directly from the published `VectorContractV1` and displayed as read-only/disabled.
- **Local Connectivity:** Configures device-local endpoints (e.g. LAN Ollama Base URL) and local credentials in `app.secretStorage`.
- **Graceful Search Degradation:** If the published `VectorContract` is missing or the provider is unreachable, semantic search is safely suspended with an informative message, and hybrid search automatically degrades to fast local text search.
- **Zero Silent Fallback:** Lina strictly prohibits silent fallback to legacy or conflicting provider/model values in `data.json`.
- **Exclusion Gating:** Exclusion rules (`.lina/exclusions.json`) are displayed in read-only mode with clear governance notices.

### 3. Standby Producer
- Configured desktop operating in safe standby mode without publication authority.
- Maintains its own local configuration and credentials.
- Strictly prohibited from publishing or overwriting canonical vault artifacts without an active lease in `.lina/ownership.json`.
- Can be promoted to Active Producer via the explicit ownership transfer flow.

---

## Upgrade Hardening, Schema Versioning & Precedence

Lina guarantees robust, non-destructive upgrades across versions:

### 1. Settings Schema Versioning (`settingsSchemaVersion: 1`)
- Settings stored in `.obsidian/plugins/lina/data.json` are explicitly versioned with `settingsSchemaVersion: 1`.
- Unversioned legacy files (`schemaVersion: 0`) are detected and migrated monotonically to version 1.

### 2. Startup Migrations Lifecycle
Migrations execute sequentially and idempotently during startup (`loadDataFromDisk()`):

```text
load
→ migrate
→ validate
→ persist-if-changed
→ runtime
```

- **No Settings Tab Dependency:** Migrations execute on startup, completely eliminating any reliance on opening the Settings tab.
- **Strict Idempotency:** Executing migrations multiple times produces `changed: false` with zero state drift.
- **Future Schema Protection:** If `settingsSchemaVersion > 1` is detected, Lina logs a technical warning, preserves the data in memory without modification or destructive downgrade, and aborts writing `data.json` at startup.
- **Zero-Write Startup Discipline:** Fresh installations and clean restarts perform zero disk writes to `data.json`.

### 3. Canonical Precedence Matrix
`data.json` stores user preferences but is **not the canonical authority** for multi-device state. Lina enforces the following strict precedence across all runtimes:

```text
Device role:
.lina/devices/<deviceId>.json > platform fallback > legacy data.json

Active Producer:
.lina/ownership.json > sem fallback local autoritativo

Embedding identity no Companion:
VectorContract canónico > sem fallback local

Exclusions:
.lina/exclusions.json > legacy data.json apenas como migration source

Credentials:
SecretStorage > plaintext legacy apenas como migration source

Freshness:
.lina/producer-state.json / manifests > local stale metadata
```

---

## Synchronization Boundaries & Best Practices

- **`.lina/` (Shared Canonical Vault Data):** Contains canonical search indices, vector embeddings, exclusion policies (`.lina/exclusions.json`), and ownership manifests (`.lina/ownership.json`). These files are designed to be synchronized across participating devices.
- **`.obsidian/plugins/lina/data.json` (Device-Local Plugin Installation):** Contains device-local preferences and cache preferences. **Syncing `data.json` across devices is not recommended** to avoid multi-device write collisions.
- **Credentials:** Stored strictly in local `app.secretStorage` (OS keychain/credential store) and never written to files or sync channels.
- **Provider Neutrality:** Operates reliably across Obsidian Sync, Syncthing, iCloud, Git, or manual file transfer without depending on specific sync provider APIs.
