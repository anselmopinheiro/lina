# Lina Roadmap — 0.2.4 and Beyond

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
   - *Device-Local Secrets:* API keys stored in Obsidian's OS-level `app.secretStorage` (never written to `data.json` or sync channels).
   - *Shared Configuration:* General non-sensitive settings in `.obsidian/plugins/lina/data.json`.
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
- **Architecture Consistency Audit:** Verified clean storage boundaries across shared configuration, device-scoped state, OS secrets, and runtime memory.

*Detailed historical change logs are recorded in [CHANGELOG.md](../CHANGELOG.md).*

---

## 4. Next Release — 0.2.4

> [!NOTE]
> **Release Status:** Technical implementation and test suite validation completed locally on the working tree. Pending final commit and release publication.

### Fixed
- **Mobile Device State & Role Persistence:** Resolved systematic `Destination file already exists!` failure on Obsidian Mobile when updating device-scoped state (`.lina/devices/<deviceId>.json`) and ownership authority (`.lina/ownership.json`).
- **Staged Promotion with Rollback:** Implemented a multi-step persistence sequence (`write temporary` → `move target to backup` → `promote temporary to target` → `remove backup`, with automatic rollback on error) to ensure consistent writes across desktop and mobile filesystem abstraction layers.
- **Adapter Contract Test Coverage:** Extended `FakeAdapter` with strict mobile mode (`strictMobileRenameMode`) to reproduce mobile filesystem constraints in automated tests, reproducing observed Android behavior.

---

## 5. Beyond 0.2.4

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

### 0.3.x — Producer State, Exclusion Policy and Artifact Resilience

**Goal:** Establish formal multi-device contracts for Producer state, content exclusion governance, and vector embedding compatibility before expanding delta search or AI actions.

#### 1. Content Exclusion Policy & Invalidation Contract (Proposed)
- [ ] **Canonical Exclusion Policy Proposal:** Propose moving folder and term exclusions from multi-writer `data.json` into a dedicated, versioned `.lina/exclusions.json` managed exclusively by the Active Producer.
- [ ] **Producer Authority & Companion Read-Only Gating:** Enforce that only the Active Producer can modify exclusions. Render exclusions as read-only on Companion with explanatory notices; reject write attempts at service level.
- [ ] **Policy Revision Tracking Proposal:** Plan monotonic `policyRevision` and deterministic `policyHash` in `.lina/exclusions.json`.
- [ ] **Artifact Invalidation Sequence:** Extend `.lina/index/manifest.json` with `exclusionPolicyRevision`. When exclusions become more restrictive:
  - Text index immediately purges newly excluded notes.
  - Orphan embedding vectors are purged from `embeddings.jsonl` and binary cache.
  - Manifest is republished with updated revision; outdated companion artifacts are flagged as stale.
- [ ] **Companion Search Defense:** Ensure Companion text, delta, and semantic searches defensively filter notes against the active policy at query time.
- *Detailed specification:* [Exclusion Policy and Artifact Invalidation](architecture/exclusion-policy-and-artifact-invalidation.md).

#### 2. Embedding Compatibility & Provenance Contract (Proposed)
- [ ] **Vector Contract Specification:** Formalize vector specifications in `.lina/index/manifest.json` (`provider`, `model`, `dimensions`, `prefixMode`).
- [ ] **Companion Contract Inheritance:** Propose locking Companion settings for Embedding Provider and Model to the inherited Producer contract, preventing incompatible configuration.
- [ ] **Local Endpoint & Secret Configuration Options:** Evaluate options for Companion local connection overrides (such as LAN endpoint configuration for local Ollama) and local credential entry in `app.secretStorage`.
- [ ] **Explicit Degradation & Text Fallback:** If the inherited embedding provider is unreachable on Companion:
  - Semantic search is explicitly suspended with an informative status message.
  - Local text search remains available whenever a usable index or local search state exists.
  - Zero silent fallback to incompatible models.
- [ ] **AI Analysis Independence:** Maintain full independence of AI Note Analysis (`/ask`, `/tags`, `/yaml`) from the vector embedding model.
- *Detailed specification:* [Embedding Compatibility and Provenance](architecture/embedding-compatibility-and-provenance.md).

#### 3. Producer State & Synchronization Resilience (Proposed)
- [ ] **Producer Heartbeat & State Artifact:** Plan `.lina/producer-state.json` recording active producer identity, last successful text index timestamp, last embedding update timestamp, and maintenance status.
- [ ] **Freshness Evaluation:** Define deterministic artifact freshness tiers (`fresh`, `aging`, `stale`) based on vault modification delta.
- [ ] **Sync Conflict Mitigation:** Handle partial file deliveries and external sync conflict files defensively without crashing readers.

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