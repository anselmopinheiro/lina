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

Lina settings are structured around a central root hub that frames **8 native Obsidian subpages**, plus a dedicated support footer:

```text
› Geral / General (Native Page)
  ├── Plugin identity, build information, language, and multilingual guidance
  └── Current device role, role actions, and friendly local device name

› Pesquisa / Search (Native Page)
  ├── Semantic search enablement, published/inherited vector identity, and local connectivity
  └── Embedding timeout, language hint, and hybrid result weighting

› 🤖 Assistente de IA e Análise / AI Assistant & Analysis (Native Page)
  ├── Provider, model, Base URL, secure API credentials, timeout, and connection test
  └── Inbox, YAML properties, and tag suggestion behaviour

› Produtor / Producer (Native Page — conditional)
  ├── Embedding update policy, batch size, exclusion rules, and text-index maintenance
  └── Binary maintenance/create/remove actions subject to existing ownership guards

› Companion (Native Page — conditional)
  └── Received exclusion-policy context; vector identity and connectivity remain in Pesquisa / Search

› Sincronização / Synchronization (Native Page)
  └── Provider-neutral local verification preference

› Diagnóstico / Diagnostics (Native Page)
  └── Current device identity, binary warning/status, verification, and binary-read preference

› Avançado / Advanced (Native Page)
  └── Debug and future rare technical parameters without a functional home

Support & Contact (Root Hub Footer)
├── Support & feedback form link
└── Email support contact with one-click copy button
```

### Domain Separation & Page Responsibilities

1. **General:** Provides plugin information, language selection, current device role and identity, and the existing role actions.
2. **Search:** Contains semantic search controls, embedding provider/model identity, local connectivity, timeout, language hint, and hybrid balance tuning. On Companion, published provider/model identity remains read-only.
3. **AI Assistant & Analysis:** Keeps analysis provider, model, endpoint, credential, timeout and connection test together with Inbox and slash-command tuning (`/ask`, `/tags`, `/yaml`).
4. **Producer:** Is conditional on the Producer role and contains generation, exclusion, index-maintenance, and binary publication controls under existing ownership guards.
5. **Companion:** Is conditional on the Companion role and presents received-policy context without duplicating Producer controls.
6. **Synchronization:** Contains the provider-neutral local verification preference.
7. **Diagnostics:** Contains device identity, binary warning/status, non-destructive verification, and binary read preference.
8. **Advanced:** Contains debug and future rare technical parameters that have no clearer functional location.
9. **Root Hub Footer (Support & Contact):** Provides direct access to the feedback form and email contact with a one-click copy button.

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
