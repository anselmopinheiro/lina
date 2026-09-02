# Embedding Update Lifecycle Architecture (Lina 0.2.2)

## Overview

Lina 0.2.2 establishes a safe, transparent, resilient, and user-controlled architecture for vector embedding updates across Desktop Producer and Mobile Companion devices.

Prior to these phases, Lina possessed robust primitives for text indexing, status detection (`embeddingState.ts`), plan generation (`embeddingUpdatePlan.ts`), single-flight workers (`embeddingWorker.ts`), and atomic publication (`embeddingGenerator.ts`). However, the decision logic dictating *when*, *why*, and *under what conditions* embedding generation could execute was implicit.

The completed **Embedding Update Lifecycle (Phases 0.2.2.1 – 0.2.2.6)** establishes a clean, decoupled end-to-end pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Status Detection (Pure Observation)                      │
│    • Determines missing, stale, and obsolete chunk counts   │
│    • Pure read-only; zero generation side-effects           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Provider Capability Analysis (Phase 0.2.2.1)             │
│    • Technical classification: isLocal, hasExternalCost     │
│    • Differentiates local compute from remote API charges   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Policy Engine (Decision Layer - Phase 0.2.2.1)           │
│    • Combines State + Capabilities + User Policy + Role     │
│    • Evaluates allowed vs requiresConfirmation              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Status Explanation (Transparency Layer - Phase 0.2.2.2)  │
│    • Translates state & policy into human-readable UI info  │
│    • Explanation Informs: semantic search impact & costs    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. User Confirmation Flow (Authorization - Phase 0.2.2.3)   │
│    • User modal requests explicit authorization             │
│    • Displays pending counts, credit notices & search notes │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Embedding Update Settings (User Config - Phase 0.2.2.4)  │
│    • Configures embeddingUpdateMode (manual / auto-local)   │
│    • Pure declarative configuration; zero side-effects      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Scheduler Integration (Background Gating - Phase 0.2.2.5)│
│    • 30s quiet debounce / 300s max delay on Producer        │
│    • Gated strictly by policy: local-provider-auto-approved │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Backoff Protection (Resilience Engine - Phase 0.2.2.6)   │
│    • Exponential cooldown (1m, 2m, 4m, 8m, 15m cap)         │
│    • Suppresses retry loops on provider failure             │
│    • Immediate reset on success or manual user preemption   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. Execution Pipeline (Single-Flight Execution)             │
│    • MaintenanceEngine & EmbeddingWorker single-flight lock │
│    • Existing Pipeline Executes: publication & checkpoints  │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Responsibilities

- **Detection Observes:** Pure read-only status and diff detection (`getEmbeddingStatus`, `createEmbeddingUpdatePlan`).
- **Capability Classifies:** Defines intrinsic provider cost and transport attributes (`getEmbeddingProviderCapability`).
- **Policy Decides:** Pure, deterministic evaluation determining whether execution is permitted or requires confirmation (`evaluateEmbeddingUpdatePolicy`).
- **Explanation Informs:** Transforms metrics and policy into human-readable understanding (`explainEmbeddingStatus`).
- **Confirmation Authorizes:** Explicit user confirmation dialog intercepts manual actions before execution (`EmbeddingUpdateConfirmationModal`).
- **Settings Configures:** Pure declarative preferences (`EmbeddingUpdateSettings`) without direct execution.
- **Scheduler Debounces & Gates:** Time-windowed background scheduler (`EmbeddingScheduler`) checking policy prior to dispatch.
- **Backoff Protects:** Pure exponential cooldown engine (`EmbeddingBackoffPolicy`) suppressing rapid retry loops on provider outages while preserving dirty state.
- **Pipeline Executes:** Existing single-flight `MaintenanceEngine` / `EmbeddingWorker` executes generation, checkpointing, and canonical publication without duplicated engines.

---

## Core Architectural Invariants & Safety Guarantees

1. **Zero Silent External API Billing:**
   - External API providers (e.g. Mistral, OpenRouter) incur per-token financial costs. Automatic background execution for external providers is strictly blocked (`external-provider-blocked`). Updates for external providers always require explicit user confirmation.
2. **Strict Companion Read-Only Protection:**
   - Mobile Companion devices operate exclusively as read-only artifact consumers. All embedding generation requests on Companion devices are rejected fail-fast (`companion-device-not-allowed`). Schedulers never run on Companion devices.
3. **Purity & Isolation:**
   - Provider capabilities define technical properties without business or UI logic.
   - The policy engine and backoff policy are pure, deterministic functions with zero I/O, zero network requests, and zero disk mutations.
4. **No Pipeline Duplication:**
   - All approved requests delegate exclusively to the single-flight `MaintenanceEngine` / `EmbeddingWorker` pipeline. Zero secondary execution loops or ad-hoc background processes exist.
5. **Preemption Integrity:**
   - Manual user actions immediately preempt background scheduler delays and clear active backoff cooldowns without waiting for timers.

---

## Data Models & Interfaces

### Provider Capabilities (`src/ai/providerCapabilities.ts`)

Defines the intrinsic technical characteristics of an embedding provider:

```ts
export interface EmbeddingProviderCapability {
  readonly providerId: string;
  readonly isLocal: boolean;
  readonly hasExternalCost: boolean;
  readonly requiresApiKey: boolean;
}
```

Standard provider profiles:
- **`ollama`**: `isLocal: true`, `hasExternalCost: false`, `requiresApiKey: false`
- **`mistral`**: `isLocal: false`, `hasExternalCost: true`, `requiresApiKey: true`
- **`openrouter`**: `isLocal: false`, `hasExternalCost: true`, `requiresApiKey: true`
- **Custom / Unknown**: Defaults conservatively to `isLocal: false`, `hasExternalCost: true`, `requiresApiKey: true`

---

### Policy Engine (`src/maintenance/embeddingPolicyEngine.ts`)

#### User Policies

```ts
export type EmbeddingUpdatePolicy =
  | "manual"
  | "automatic-local-only";
```

#### Decision Output

```ts
export type EmbeddingPolicyDecisionReason =
  | "manual-confirmation-required"
  | "local-provider-auto-approved"
  | "external-provider-blocked"
  | "companion-device-not-allowed"
  | "no-update-required";

export interface EmbeddingPolicyDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
  readonly reason: EmbeddingPolicyDecisionReason;
}
```

---

## Decision Matrix

The evaluation function `evaluateEmbeddingUpdatePolicy()` executes in strict priority order:

| Priority | Condition | `allowed` | `requiresConfirmation` | Reason |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `deviceRole === "companion"` | `false` | `false` | `companion-device-not-allowed` |
| **2** | `!hasPendingWork` | `false` | `false` | `no-update-required` |
| **3** | Local Provider (`isLocal && !hasExternalCost`) + `policy === "automatic-local-only"` | `true` | `false` | `local-provider-auto-approved` |
| **4** | External Provider (`!isLocal \|\| hasExternalCost`) + `policy === "automatic-local-only"` | `false` | `true` | `external-provider-blocked` |
| **5** | Manual Policy (`policy === "manual"`) | `false` | `true` | `manual-confirmation-required` |

---

---

## Lifecycle Milestones & Deliverables

The embedding update lifecycle was built and verified incrementally across six focused phases:
- **Phase 0.2.2.1:** Provider Capabilities model & pure Embedding Policy Engine.
- **Phase 0.2.2.2:** Status Explanation Layer with real-world semantic search impact assessments and API credit notices in `pt-PT` and `en`.
- **Phase 0.2.2.3:** User Confirmation Flow (`EmbeddingUpdateConfirmationModal`) intercepting manual triggers with fail-fast Companion rejection.
- **Phase 0.2.2.4:** Architectural Workflow Audit (zero bypass paths) & declarative `EmbeddingUpdateSettings` (`manual` vs `automatic-local-only`).
- **Phase 0.2.2.5:** Scheduler Integration connecting `EmbeddingScheduler` background dispatch to policy decisions.
- **Phase 0.2.2.6:** Backoff Protection (`EmbeddingBackoffPolicy`) providing exponential cooldown (1m–15m) on provider failures.

---

## Status Explanation Layer (Phase 0.2.2.2)

Phase 0.2.2.2 introduces `src/maintenance/embeddingStatusExplanation.ts` to transform raw technical metrics and policy decisions into structured, human-readable status explanations:

```
┌─────────────────────────────────────────────────────────────┐
│ Technical Inputs (Pure Data)                                │
│  • Embedding State (missingCount, staleCount, totalChunks)  │
│  • Provider Capability (isLocal, hasExternalCost)           │
│  • Policy Decision (allowed, requiresConfirmation, reason)  │
│  • Device Role (producer / companion)                       │
│  • Localized UiStrings (pt-PT / en)                         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ explainEmbeddingStatus() (Pure Presentation Function)       │
│                                                             │
│ Produces:                                                   │
│  • Human title and summary                                  │
│  • Detailed counts and impact explanations                  │
│  • Semantic search impact: "complete"|"partial"|"unavail"   │
│  • Clear API credit cost awareness (mayConsumeCredits)      │
│  • Recommended user action: "update"|"review-policy"|"none" │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ EmbeddingStatusExplanation (Structured User Presentation)    │
└─────────────────────────────────────────────────────────────┘
```

### Explanation Model (`src/maintenance/embeddingStatusExplanation.ts`)

```ts
export interface EmbeddingStatusExplanation {
  readonly status:
    | "ready"
    | "needs-update"
    | "up-to-date"
    | "blocked"
    | "unknown";
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly semanticSearchImpact:
    | "complete"
    | "partial"
    | "unavailable";
  readonly providerDescription?: string;
  readonly mayConsumeCredits: boolean;
  readonly recommendedAction?:
    | "update"
    | "review-policy"
    | "none";
}
```

### Scenario Explanations

1. **Up-to-date State (`no-update-required`):**
   - Informs that all notes have valid semantic representations and search is complete (`semanticSearchImpact: "complete"`).
2. **Missing Embeddings:**
   - Explains that new/unindexed notes lack semantic representations. If `validCount === 0`, marks `semanticSearchImpact: "unavailable"`; otherwise `"partial"`.
3. **Outdated Embeddings (Stale):**
   - Clarifies that recent edits will not be reflected in semantic search results until refreshed.
4. **External Provider API Cost Disclosure:**
   - Explicitly flags `mayConsumeCredits: true` and warns the user that generation may consume third-party API credits.
5. **Local Provider:**
   - Explicitly confirms `mayConsumeCredits: false` and notes local model execution without remote costs.
6. **Companion Restrictions:**
   - Clarifies that embedding generation only runs on a Desktop Producer device and Companion devices consume synchronized vectors.

---

## Architectural Guarantees & Invariants

The Status Explanation Layer strictly adheres to the following guarantees:
- **Zero Generation Side Effects:** No embeddings are generated, and no worker processes (`EmbeddingWorker`, `TextIndexWorker`) are started.
- **Zero Scheduler Mutations:** `EmbeddingScheduler` timing and automatic dispatch behavior remain unchanged.
- **Zero Network/Provider Calls:** No external API requests (Ollama, Mistral, OpenRouter) or secret token evaluations are performed.
- **Strict Separation of Concerns:** The explanation layer is a pure presentation transformer that interprets existing state without making execution decisions or modifying manifests.

---

## Embedding Update Confirmation Flow (Phase 0.2.2.3)

Phase 0.2.2.3 introduces the user confirmation layer (`src/maintenance/embeddingUpdateConfirmation.ts` and `src/maintenance/embeddingUpdateConfirmationModal.ts`) to intercept manual generation triggers (command palette and sidebar actions) and require explicit user authorization before execution.

```
User Action (Command Palette or Sidebar Diagnostic Action)
                         |
                         v
          ┌──────────────────────────────┐
          │ Companion Role Check         │
          │ (Fail-fast: Producer only)   │
          └──────────────┬───────────────┘
                         │ (Producer)
                         v
          ┌──────────────────────────────┐
          │ Policy & Preview Evaluation  │
          │  • Policy decision           │
          │  • Provider capability       │
          │  • Scope of work (counts)    │
          └──────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
 [No work required]              [Requires Confirmation]
         │                               │
  Show notice: Up-to-date                v
                          ┌──────────────────────────────┐
                          │ Confirmation Modal (UI Only) │
                          │  • Provider & model identity │
                          │  • Pending work counts       │
                          │  • API credit cost callout   │
                          │  • Search impact note        │
                          └──────────────┬───────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │                               │
                    [Cancelled]                     [Confirmed]
                         │                               │
                   Abort silently                        v
                                          ┌──────────────────────────────┐
                                          │ Existing Generation Pipeline │
                                          │ (requestEmbeddingIndexGen)   │
                                          └──────────────────────────────┘
```

### Confirmation Model (`src/maintenance/embeddingUpdateConfirmation.ts`)

```ts
export interface EmbeddingUpdateConfirmationRequest {
  readonly providerId: string;
  readonly modelName?: string;
  readonly isLocal: boolean;
  readonly hasExternalCost: boolean;
  readonly missingCount: number;
  readonly staleCount: number;
  readonly obsoleteCount: number;
  readonly totalToGenerate: number;
  readonly totalChunks: number;
  readonly semanticSearchImpact: SemanticSearchImpact;
  readonly requiresConfirmation: boolean;
  readonly costWarningMessage?: string;
  readonly isFullRebuild: boolean;
}
```

### Confirmation Invariants & Guarantees

1. **Explicit External API Cost Disclosure:** External providers (Mistral, OpenRouter, cloud APIs) display a prominent warning callout detailing potential billing impact.
2. **Local Provider Reassurance:** Local providers (Ollama) display an explicit notice confirming zero external billing impact.
3. **Fail-Fast Companion Defense:** Companion devices immediately abort without mounting modals or contacting providers.
4. **Zero Generation Duplication:** The modal only resolves a boolean choice; execution strictly delegates to the existing single-flight `MaintenanceEngine` / `EmbeddingWorker` pipeline.

---

## Workflow Integration Audit (Phase 0.2.2.4)

Phase 0.2.2.4 validates that all entry points and execution paths in the codebase strictly adhere to the five-tier policy and confirmation architecture:

| Workflow / Entry Point | Trigger | Gating & Authorization | Execution Mechanism | Compliance |
| :--- | :--- | :--- | :--- | :---: |
| **Command Palette** | `gerar-embeddings-locais` | `confirmAndRequestEmbeddingGeneration` + `EmbeddingUpdateConfirmationModal` | Delegated to `MaintenanceEngine` / `EmbeddingWorker` | **Compliant** |
| **Sidebar Action Buttons** | `generate`, `update`, `rebuild` | `confirmAndRequestEmbeddingGeneration` + `EmbeddingUpdateConfirmationModal` | Delegated to `MaintenanceEngine` / `EmbeddingWorker` | **Compliant** |
| **Automatic Maintenance** | `EmbeddingScheduler` | Gated by `supportsAutomaticEmbeddingMaintenance` (Ollama only) + `canScheduleEmbeddings` | Single-flight `MaintenanceEngine.requestEmbeddingGeneration("automatic")` | **Compliant** |
| **Mobile Companion** | All manual/automatic triggers | Multi-layer fail-fast rejection (`canGenerateEmbeddings`, `role === "companion"`) | Zero provider calls, zero worker execution | **Compliant** |
| **External Cloud APIs** | Mistral, OpenRouter | Mandatory user confirmation via modal; automatic background scheduling blocked | Only executed upon explicit user confirmation | **Compliant** |

### Audit Summary & Invariants Verified:
- **Zero Bypass Paths:** Every manual embedding generation trigger passes through policy evaluation and confirmation preview.
- **Zero Silent External API Billing:** External providers cannot be invoked automatically by schedulers or background jobs.
- **Strict Companion Protection:** Mobile Companion nodes operate exclusively in read-only mode and reject all generation requests.
- **Single-Flight Lock Integrity:** `IndexWriteCoordinator` and `MaintenanceEngine` preserve single-flight mutex coordination without duplicate pipelines.

---

## Embedding Update Settings (Phase 0.2.2.4 Part 2)

Phase 0.2.2.4 introduces the user preference configuration layer for embedding updates:

```ts
export type EmbeddingUpdateMode =
  | "manual"
  | "automatic-local-only";

export interface EmbeddingUpdateSettings {
  readonly mode: EmbeddingUpdateMode;
}

export const DEFAULT_EMBEDDING_UPDATE_SETTINGS: Readonly<EmbeddingUpdateSettings> = {
  mode: "manual",
};
```

### Key Architectural Invariants
1. **Settings Layer Does Not Execute Generation:**
   - Modifying `embeddingUpdateMode` writes pure configuration to settings via runtime adapters.
   - Zero worker invocations, zero provider calls, and zero scheduler starts are triggered.
2. **Conservative Default:**
   - Defaults to `"manual"` (ask before generating embeddings).
3. **Policy Feeds from User Preference:**
   - `main.ts` feeds `settings.embeddingUpdateMode` directly into `evaluateEmbeddingUpdatePolicy`.
4. **Strict Companion & External Safeguards:**
   - Companion devices remain strictly read-only (`companion-device-not-allowed`) regardless of mode.
   - External providers (Mistral, OpenRouter) always require explicit confirmation even under `"automatic-local-only"`.

---

## Scheduler Integration (Phase 0.2.2.5)

Phase 0.2.2.5 connects the background `EmbeddingScheduler` to the policy engine and user settings:

```
Vault Note Modification
          │
          ▼
Text Index Update & Canonical Publication
          │
          ▼
LinaPlugin.markEmbeddingWorkStatusDirty("text-index-published")
          │
          ▼
MaintenanceEngine.markEmbeddingSchedulerDirty()
          │
          ▼
EmbeddingScheduler: 30s Quiet Debounce / 300s Max Delay
          │
          ▼ [Timer Expires]
EmbeddingScheduler.reachReady()
          │
          ▼
EmbeddingScheduler.dispatchIfEligible()
  ├── 1. canScheduleEmbeddings()  -> Producer + Authorized Ownership Gate
  ├── 2. canDispatchAutomatically() [POLICY ENGINE INTEGRATION]
  │        ├─ Reads settings.embeddingUpdateMode
  │        ├─ Evaluates providerCapability (local vs external)
  │        ├─ Evaluates deviceRole ("producer" vs "companion")
  │        └─ Returns true ONLY for local-provider-auto-approved
  ├── 3. hasEmbeddingWork()        -> Fresh canonical update plan check (diff > 0)
  │
  ▼ [Eligible]
dispatchAutomatic()
  │
  ▼
MaintenanceEngine.requestEmbeddingGeneration("automatic")
  │
  ▼
EmbeddingWorker.requestGeneration() -> Single-Flight Mutex Execution
```

### Safety Guarantees & Runtime Invariants
1. **Zero Silent External API Billing:** External providers (Mistral, OpenRouter) unconditionally evaluate to `external-provider-blocked` and are blocked from background scheduling.
2. **Strict Companion Read-Only Enforcement:** Companion nodes never start scheduler jobs or execute generation (`companion-device-not-allowed`).
3. **Manual Mode Safeguard:** When `embeddingUpdateMode === "manual"`, automatic dispatch is blocked; pending work remains dirty until confirmed explicitly by the user.
4. **Single-Flight Lock Integrity:** `automaticDispatchInFlight` + `EmbeddingWorker` mutex lock guarantee zero duplicate or conflicting generation jobs.
5. **Preemption Integrity:** Any manual action clears active scheduler debounce timers immediately via `preemptEmbeddingSchedulerForManual()`.

---

## Backoff Protection (Phase 0.2.2.6)

Phase 0.2.2.6 introduces a pure, transient resilience layer to protect against repeated background maintenance failures:

```ts
export interface EmbeddingBackoffConfig {
  readonly initialCooldownMs?: number; // Default: 60,000 ms (1m)
  readonly backoffMultiplier?: number;  // Default: 2.0
  readonly maxCooldownMs?: number;      // Default: 900,000 ms (15m)
}

export interface EmbeddingBackoffState {
  readonly consecutiveFailures: number;
  readonly lastFailureTimestamp: number | null;
  readonly cooldownUntil: number | null;
}
```

### Cooldown Progression
When automatic embedding maintenance fails (e.g. local Ollama server stopped, connection timeout, port closed), an exponential backoff cooldown is computed:

$$\text{cooldownMs} = \min(\text{initialCooldownMs} \times 2^{(\text{consecutiveFailures} - 1)}, \text{maxCooldownMs})$$

- 1st failure: 1 minute (60s)
- 2nd failure: 2 minutes (120s)
- 3rd failure: 4 minutes (240s)
- 4th failure: 8 minutes (480s)
- 5+ failures: 15 minutes (900s max cap)

### Resilience Guarantees & Reset Rules
1. **Suppression Without Work Loss:** During an active cooldown, automatic background dispatch is suppressed while the work state remains safely marked as `"dirty"`.
2. **Immediate Reset on Success or Manual Action:**
   - Any successful generation (`completion.success === true`) clears failure counts and active cooldowns.
   - Any manual trigger (`preemptForManual()`) clears backoff state immediately, allowing user-directed recovery without waiting for cooldown timers.
   - `markClean()` resets backoff state.
3. **Pure In-Memory Runtime State:** State lives entirely in memory within `EmbeddingScheduler`, avoiding disk thrashing and resetting cleanly on plugin reload.
4. **Zero External API Exposure:** External providers remain strictly manual, ensuring zero automated retries or unintended credit consumption.
