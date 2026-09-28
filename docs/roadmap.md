# Lina Roadmap — 0.3.0 and Beyond

## 1. Vision and Principles

Lina is a privacy-first, local-first intelligence and search layer for Obsidian. It provides fast keyword search out of the box, with optional semantic search and AI-assisted note enrichment designed to keep the user in complete control.

### Core Principles:
- **Protect User Vault Content:** Lina never modifies notes silently. AI suggestions require explicit preview and confirmation before writing to disk.
- **Local-First & Data Boundary Integrity:** Keyword indexing and local text search run on-device. External AI providers are contacted only upon explicit user request. Excluded folders and terms act as strict pre-ingestion boundaries.
- **Predictable, Transparent Operation:** Status, impact, and third-party API credit costs are clearly explained before operations that call external services or process large batches are dispatched.
- **Single Plugin, Clear Device Boundaries:** Desktop workstations act as primary *Producers* building shared search assets, while mobile devices operate as lightweight, battery-efficient *Companions*.

---

## 2. Current Architecture

Lina coordinates multi-device vaults across Desktop and Mobile through four architectural pillars:

1. **Role & Capability Model:**
   - **Desktop Producer:** Maintains text indices (`notes.json`, `chunks.jsonl`), plans embedding updates, computes vector batches, compiles memory-mapped binary vector caches (`embeddings.vectors.f32`), and reconciles vault diffs.
   - **Mobile Companion:** Lightweight consumer. Consumes synchronized index files, executes local text search, runs hybrid vector search using synchronized vectors, and performs ephemeral in-memory delta searches without modifying vault index files.
2. **Single-Active-Producer Ownership:**
   - Coordinated through `.lina/ownership.json` and Monotonic Epoch Fencing ($E \to E + 1$).
   - Multiple desktops can be configured as Producers; exactly one machine is the **Active Producer** authorized to publish, while others operate safely as **Standby Producers**. Safe manual transfer and active demotion are implemented.
   - Audit history is recorded in `.lina/ownership-history/`.
3. **Partitioned Storage Tiers:**
   - *Device Identity:* Device-local UUID in `app.loadLocalStorage`.
   - *Device-Scoped State:* Isolated single-writer state in `.lina/devices/<deviceId>.json`.
   - *Active Ownership Authority:* Synchronized single-active authority in `.lina/ownership.json`.
   - *Producer-Owned Search Artifacts:* Canonical published files in `.lina/index/*`.
   - *Producer Operational Area:* Checkpoints, staging candidates, rollback backups, and other operational data in `.lina/producer/*`. They are not intended for synchronization and never consumed by Companion, but remain in the vault today and depend on correct external sync exclusions.
   - *Published-directory invariant:* Text, JSONL embedding, and derived binary transactions keep candidates and backups outside `.lina/index/`; the published directory contains final artifacts only.
   - *Device-Local Secrets:* API keys stored in Obsidian's OS-level `app.secretStorage` (never written to `data.json` or sync channels).
   - *Local Device Configuration:* General non-sensitive, device-local settings in `.obsidian/plugins/lina/data.json`; it is not shared configuration or a multi-device authority.
4. **Decoupled AI Engines:**
   - **Vector Embeddings Provider:** Powers semantic search (Ollama, Mistral, OpenRouter).
   - **AI Note Analysis Provider:** Powers `/ask`, `/tags`, `/yaml`, and contextual commands. Configured independently of the vector provider.

Detailed architectural references:
- [Sync Foundations & Storage Partitioning](architecture/sync-foundations.md)
- [Active Producer Ownership](architecture/producer-ownership.md)
- [Device Identity and Roles](architecture/device-identity-and-roles.md)
- [Embedding Policy & Lifecycle](architecture/embedding-policy-foundation.md)
- [Companion Delta Search Foundation](architecture/companion-delta-search-foundation.md)

---

## 3. Released Foundation — 0.2.2 to 0.2.3

### 0.2.2 — Release Stabilization & Embedding Update Lifecycle
- **Embedding Policy & Gating:** Implemented pure policy decision engine separating local compute from remote API cost profiles, preventing silent background API billing.
- **Status Transparency & Confirmation Flow:** Provided human-readable explanations of semantic search impact and API costs, backed by an explicit confirmation modal for manual triggers.
- **Configurable Maintenance & Scheduler:** Added user settings for embedding update mode (`manual` vs `automatic-local-only`), with background scheduling gated exclusively to local providers on Desktop Producer.
- **Exponential Backoff Resilience:** Added automatic cooldown progression (scaling from 1m up to 15m) on provider outages while preserving pending dirty work state.
- **Companion Consumer Verification:** Audited and verified that Companion devices do not run background maintenance or modify shared index files.
- **Secret Boundary Protection:** Purged legacy plaintext API keys from `data.json` and migrated credentials strictly to `app.secretStorage`.

### 0.2.3 — Device Roles, Ownership & Settings Intent Alignment
- **First-Run Role Chooser & Migration:** Established an explicit unconfigured state (`⚪ Unconfigured Device`) with platform-aware recommendations, alongside a migration flow for legacy installations (`🟡 Temporary role`).
- **Platform-Aware Role Labels:** Introduced clear visual role indicators: `Desktop Producer`, `Desktop Companion`, and `Mobile Companion`.
- **Multi-Desktop Ownership Transfer & Demotion:** Enabled Standby Producers to request publication authority safely ($E \to E + 1$), and Active Producers to demote to Companion while safely relinquishing authority and shutting down background workers.
- **Settings Reorganization by User Intent:** Restructured settings into three functional tiers (**Basic Settings**, **Advanced Settings**, and **Diagnostics & Maintenance**) preserving all 49 existing settings items without breaking changes or migrations.
- **Architecture Consistency Audit:** Verified clean storage boundaries across local device configuration, device-scoped state, OS secrets, and runtime memory.

*Detailed historical change logs are recorded in [CHANGELOG.md](../CHANGELOG.md).*

---

## 4. Released Hotfix — 0.2.4

> [!NOTE]
> **Release Status:** Released on 4 September 2026.
>
> [GitHub Release](https://github.com/anselmopinheiro/lina/releases/tag/0.2.4)

### Fixed
- **Mobile Device State & Role Persistence:** Resolved systematic `Destination file already exists!` failure on Obsidian Mobile when updating device-scoped state (`.lina/devices/<deviceId>.json`) and ownership authority (`.lina/ownership.json`).
- **Staged Promotion with Rollback:** Implemented a multi-step persistence sequence (`write temporary` → `move target to backup` → `promote temporary to target` → `remove backup`, with automatic rollback on error) to ensure consistent writes across desktop and mobile filesystem abstraction layers.
- **Adapter Contract Test Coverage:** Extended `FakeAdapter` with strict mobile mode (`strictMobileRenameMode`) to reproduce mobile filesystem constraints in automated tests, reproducing observed Android behavior.

---

## 5. Beyond 0.2.4

Following the release of hotfix 0.2.4, the next strategic phase is **0.3.x — Producer State, Exclusion Policy and Artifact Resilience**.

The strategic roadmap proceeds through the following cohesive phases:

```
0.3.x: Producer State, Exclusion Policy & Artifact Resilience
                     │
                     ▼
0.4.x: Companion Delta Search & Unified Search Integration
                     │
                     ▼
0.5.x: First Run Experience & Guided Onboarding
                     │
                     ▼
0.6.x: Search Experience & Provenance
                     │
                     ▼
0.7.x: Contextual AI Actions & Inline Commands
                     │
                     ▼
0.8.x: Privacy Controls & Intelligent Note Commands
                     │
                     ▼
0.9.x: Intelligent Note Formatting & Structures
                     │
                     ▼
1.0.x: Architecture Review & Beta Readiness
```

---

### 0.3.x — Producer State, Exclusion Policy and Artifact Resilience (Completed)

**Goal:** Establish formal multi-device contracts for Producer state, content exclusion governance, vector embedding compatibility, and artifact generation integrity across devices.

#### 1. Content Exclusion Policy & Defensive Invalidation Contract
- [x] **Canonical Exclusion Policy:** Transitioned folder, path, and content exclusions from multi-writer `data.json` into a dedicated, versioned `.lina/exclusions.json` (`schemaVersion: 1`) managed exclusively by the Active Producer.
- [x] **Producer Authority & Companion Read-Only Gating:** Enforced that only the Active Producer can modify the exclusion policy. Companion and Standby devices view exclusions in read-only mode with explanatory notices, with write attempts rejected at the service boundary.
- [x] **Policy Revision Tracking & Provenance:** Implemented monotonic `policyRevision` and deterministic SHA-256 `policyHash` in `.lina/exclusions.json`. Text index manifests stamp `exclusionPolicyRevision` and `exclusionPolicyHash` for provenance verification (`compatible`, `mismatch`, `unknown`).
- [x] **Legacy Migration & Resilience:** Automatic migration of legacy exclusions from `data.json` on first load. If `.lina/exclusions.json` is missing, a safe temporary fallback to legacy rules applies; if the policy file exists but is invalid, authority is never returned to legacy settings.
- [x] **Companion Query-Time Defensive Filtering:** Companion devices defensively filter notes and chunks at query time across text, semantic, hybrid, and local delta search against the active policy, protecting data boundaries even during sync skew or partial file arrival.
- [x] **Artifact Invalidation:** When exclusions become more restrictive, newly excluded notes are purged from the text index and orphan embedding rows are purged without modifying original vault markdown files.
- *Detailed specification:* [Exclusion Policy and Artifact Invalidation](architecture/exclusion-policy-and-artifact-invalidation.md).

#### 2. Vector Contract Formalization & Companion Inheritance
- [x] **Vector Contract Specification:** Formalized canonical `VectorContractV1` recorded in `.lina/index/manifest.json` (`provider`, `model`, `dimensions`, `metric: "cosine"`, `prefixMode`, `inputVersion`) with a deterministic `contractId`.
- [x] **Companion Contract Inheritance & Enforced Locking:** Companion devices automatically inherit embedding provider and model configuration from the Producer's published `VectorContractV1` manifest, preventing vector space mismatches. In Settings, embedding provider and model dropdowns are locked in read-only/disabled state. If the published contract is missing or unreachable, semantic search is gracefully suspended with informative UI notices, hybrid search degrades to fast local text search, and zero silent fallback to legacy models in `data.json` is permitted.
- [x] **Local Connection & Secret Independence:** Companion devices maintain device-local endpoint configuration (e.g. LAN Ollama Base URL) and device-local credentials in `app.secretStorage`. AI Note Analysis configuration (`/ask`, `/tags`, `/yaml`) remains strictly decoupled from the vector embedding model.
- [x] **Explicit Degradation & Text Fallback:** If the inherited embedding provider is unreachable or unconfigured on Companion:
  - Semantic search is gracefully suspended with an informative status message.
  - Hybrid search automatically degrades to fast local text search.
  - Zero silent fallback to incompatible embedding models.
- *Detailed specification:* [Embedding Compatibility and Provenance](architecture/embedding-compatibility-and-provenance.md).

#### 3. Producer State, Freshness & Generation Integrity
- [x] **Producer State Artifact:** Implemented `.lina/producer-state.json` (`ProducerStateV1`) recording active producer device ID, last successful text publication timestamp, last embedding publication timestamp, text generation ID, and maintenance status. (Producer state provides observational freshness and does not grant publication authority).
- [x] **Multi-Dimensional Freshness Evaluation:** Defined deterministic freshness tiers (`fresh` < 24h, `aging` 24–48h, `stale` > 48h, `unknown`) evaluated separately across text index, embeddings, and producer state.
- [x] **Cryptographic Generation Digests & Sync Resilience:** Stamped text index manifests with `generationId`, `notesDigest` (`sha256:...`), and `chunksDigest` (`sha256:...`). Publication employs transactional `manifest-last` promotion.
- [x] **Sync Conflict Mitigation & Reader Integrity:** Readers strictly load exact canonical filenames (`manifest.json`, `notes.json`, `chunks.jsonl`), ignore external sync conflict copies (e.g. `*.sync-conflict-*`), and detect partial sync or digest mismatches without crashing. Backward compatibility with legacy 0.2.4 manifests is preserved.
- [x] **Sidebar UX Simplification & Streamlined Information Architecture:** Streamlined the Lina sidebar search view with a compact search mode dropdown selector (`Text`, `Hybrid`, `Semantic`), consolidated secondary AI and note analysis actions into a dedicated actions dropdown, removed redundant visual branding header, implemented a discrete "silent-success" status indicator with single-alert degradation notices, and relocated comprehensive telemetry and Producer-only maintenance to `DeviceDiagnosticsModal`.
- [x] **Intent-Based Settings Pages:** Reorganized the native `SettingDefinitionPage` interface into General, Search, AI, conditional Producer/Companion, Synchronization, Diagnostics, and a reduced Advanced page. AI concentrates analysis and its endpoint, timeout and connection test, Inbox and YAML/tag controls; Search concentrates text/semantic configuration and embedding connectivity; Diagnostics concentrates binary status, verification and read preference; Advanced retains only debug and future rare technical parameters without a functional home. All existing definitions, storage keys, ownership guards, and native Settings Search indexing are retained while reducing mobile scroll density.
- [x] **Settings Schema Versioning & Upgrade Hardening:** Introduced explicit `settingsSchemaVersion: 1` in `data.json`. Migrations now run sequentially and idempotently during startup (`load → migrate → validate → persist-if-changed → runtime`) without requiring manual settings tab interaction. Enforces future schema version protection (`settingsSchemaVersion > 1` prevents destructive overwrite or downgrade), startup persistence discipline (zero writes on clean start), and canonical precedence matrix across device roles, ownership leases, exclusion policies, and credentials.
- [x] **Legacy Settings Authority Demotion & Canonical Boundary Consolidation:** Demoted the operational authority of `data.json`, consolidating shared contracts into `.lina/` (`exclusions.json`, `devices/<deviceId>.json`, `manifest.json`) and secrets into `app.secretStorage`. Blocked new writes to deprecated fields while maintaining backward-compatible fallback for legacy vaults without `.lina/`. Solidified Producer-defines / Companion-consumes embedding boundaries with zero silent fallback.
- [x] **Producer Settings Boundary & Contract Separation:** Defined and enforced the three-tier operational boundary separating Producer local generation settings (`data.json`), published vector contracts (`.lina/index/manifest.json`), and observational state telemetry (`.lina/producer-state.json`). Prohibited silent contract mutations and enforced full rebuild upon model divergence, preventing vector space corruption.
- [ ] **DeviceLocalStore Evaluation:** Evaluate a future cross-platform `DeviceLocalStore` for private Producer operational state, large caches, checkpoints, staging, and backups outside the vault. This is not implemented; no migration from `.lina/producer/` is authorized until Desktop and Android storage, recovery, quota, and permission behaviour are validated.

---

### 0.3.1 — Producer Operational Storage Stability Update (Completed)

**Goal:** Fix Producer storage bootstrap and checkpoint directory creation, ensuring reliable embedding generation on newly initialized and migrated vaults.

- [x] **Idempotent Producer Workspace Initialization:** Guarantee recursive, idempotent creation of all required `.lina/producer/*` operational directories (`staging`, `checkpoints`, `backups`, and binary subpaths) prior to any file writes.
- [x] **Safe Checkpoint Directory Creation:** Prevent `ENOENT` failures when promoting staging checkpoints to `.lina/producer/checkpoints/` by ensuring parent directory presence across all operational codepaths and preventive initialization during text index saves.
- [x] **Operational Regression Coverage:** Extended automated test coverage across initial creation, re-creation following directory deletion, and real filesystem scenarios.

---

### 0.3.2 — UX refinement (Backlog)

- [ ] **Android Settings Improvements:** Review navigation, density, and touch ergonomics in interactive Android validation.
- [ ] **Visual Settings Refinement:** Apply small visual and copy adjustments identified during release feedback without changing settings boundaries or storage contracts.
- [ ] **Targeted UX Adjustments:** Address small, evidence-based usability issues after the 0.3.0 stabilization release.

---

### 0.4.x — Companion Delta Search and Unified Search Integration

**Goal:** Enable Companion devices to find recent notes created or edited before the Producer synchronizes updated artifacts, combining canonical Producer artifacts with a temporary Companion overlay.

- [ ] **Exclusion-Compliant Local Delta Search:** Update `detectLocalDelta` in `src/companion/companionDeltaSearch.ts` to strictly enforce path and content exclusion rules.
- [ ] **Unified Search Engine Integration:** Connect ephemeral local delta search into `LinaSearchView` with seamless result fusion.
- [ ] **Temporary Companion Embedding Cache (Approved Decision):**
  - Persistent, device-local temporary embedding cache for notes created or edited on Companion.
  - Excluded from vault synchronization; never published as canonical artifacts and never written to shared index files.
  - Deterministic cache reconciliation: temporary entries are pruned only after complete equivalent canonical chunk and vector coverage is validated under a compatible exclusion policy. Time-based deletion is strictly prohibited.
  - Exact storage API and physical mechanism (leading candidate: host IndexedDB) to be confirmed during implementation audit.
- [ ] **Controlled User Experience for Mobile Generation:**
  - Display clear status notices when embeddings are missing or outdated on mobile.
  - Provide an explicit **"Generate Missing Embeddings"** action when connectivity to the inherited provider is functional.
  - Include transparent pre-execution disclosures (chunk count, estimated API credit costs, battery consumption notice).

---

### 0.5.x — First Run Experience

**Goal:** Reduce initial friction and guide new users through setup across desktop and mobile.

- [ ] Guided onboarding walkthrough explaining the Producer and Companion model.
- [ ] Step-by-step assistant for initial index creation.
- [ ] Intuitive AI provider setup assistant with connection testing feedback.
- [ ] Polished empty states across sidebar views.

---

### 0.6.x — Search Experience and Provenance

**Goal:** Enhance daily search productivity and transparency.

- [ ] One-click search clearing and folder-scoped search filters.
- [ ] Richer excerpt context around matched query terms.
- [ ] Search result provenance display (showing generating provider, model, timestamp, and producing device).

---

### 0.7.x — Contextual AI Actions

**Goal:** Deliver in-note AI assistance while strictly preserving user control.

- [ ] Contextual slash commands: Summarize, Explain, Improve Writing, Correct, Rewrite, Key Takeaways, Translate.
- [ ] Strict pre-execution data boundary checks against the active Exclusion Policy.
- [ ] Side-by-side diff preview before applying AI suggestions to notes.

---

### 0.8.x — Privacy Controls and Intelligent Commands

**Goal:** Give users granular in-note privacy boundaries and structured assistance.

- [ ] In-note protected content markers (searchable locally, excluded from external AI prompts).
- [ ] `/contact` structured assistant for contact and meeting records.
- [ ] Privacy audit view summarizing data boundaries and external network access history.

---

### 0.9.x — Intelligent Note Formatting

**Goal:** Assist in structuring notes while preserving original content.

- [ ] Formatting templates for meeting notes, academic literature reviews, and Zettelkasten cards.
- [ ] Fully reversible, non-destructive transformations.

---

### 1.0.x — Architecture Review and Beta Readiness

**Goal:** Comprehensive hardening for public beta release.

- [ ] Security, privacy, and data-integrity audit.
- [ ] Cross-platform performance verification (Desktop, iOS, Android).
- [ ] Full release pipeline, automated regression suite, and community documentation audit.

---

## 6. Backlog and Future Exploration

The following capabilities represent product explorations in the backlog pending core foundation stabilization:

- **Similar Note Comparison UX:**
  - *Value:* Compare two similar notes side-by-side to identify subtle differences, determine which document contains the most recent or authoritative information, and reduce the risk of accidentally editing obsolete notes.
  - *Principle:* Pure observation and diffing; original notes are strictly preserved.
- **PDF, Images and OCR:**
  - Optical character recognition and text extraction for non-markdown attachments.
  - Semantic vector search over extracted document passages.
- **Future Mobile Autonomy Exploration:**
  - Conceptual study of potential autonomous maintenance on mobile devices, subject to platform constraints and battery considerations.
- **Tooling & Build Determinism:**
  - Normalizing build metadata for byte-reproducible plugin releases.
  - Development dependency tracking: assess advisory on transitively imported `fast-uri` (imported via `eslint-plugin-obsidianmd` in `devDependencies`, with no evidence of runtime bundle impact in `main.js`).

---

## 7. Roadmap Policy

- **Living Document:** This roadmap reflects strategic direction and is continuously aligned with real codebase capabilities and architectural decisions.
- **Prioritization:** Data safety, privacy boundaries, and user control take precedence over feature velocity.
- **Version Numbering:** Semantic versioning ($MAJOR.MINOR.PATCH$) is maintained. Phase numbers indicate architectural milestones and may encompass multiple patch releases.
