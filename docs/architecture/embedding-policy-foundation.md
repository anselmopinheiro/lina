# Embedding Policy Foundation & Confirmation Architecture (Phases 0.2.2.1 – 0.2.2.3)

## Overview

Lina 0.2.2 establishes a safe, transparent, and user-controlled architecture for vector embedding updates.

Prior to these phases, Lina possessed robust primitives for text indexing, status detection (`embeddingState.ts`), plan generation (`embeddingUpdatePlan.ts`), single-flight workers (`embeddingWorker.ts`), and atomic publication (`embeddingGenerator.ts`). However, the decision logic dictating *when* and *under what conditions* embedding generation could execute was implicit.

The embedding management architecture establishes a clean, decoupled five-tier pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Status Detection (Pure Observation)                      │
│    • Determines missing, stale, and obsolete counts         │
│    • Pure read-only; zero generation side-effects           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Policy Engine (Decision Layer - Phase 0.2.2.1)           │
│    • Combines State + Provider Capabilities + Policy + Role │
│    • Emits structured EmbeddingPolicyDecision               │
│    • Policy Decides: allowed vs requires confirmation       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Status Explanation (Transparency Layer - Phase 0.2.2.2)  │
│    • Translates state & policy into human-readable UI info  │
│    • Explanation Informs: search impact & API cost notice   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Confirmation Flow (Authorization Layer - Phase 0.2.2.3)  │
│    • User modal requests explicit authorization             │
│    • Confirmation Authorizes: zero silent external API calls│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Execution Pipeline (Single-Flight Execution)             │
│    • MaintenanceEngine & EmbeddingWorker single-flight lock │
│    • Existing Pipeline Executes: publication & checkpoints  │
└─────────────────────────────────────────────────────────────┘
```

**Architectural Responsibilities:**
- **Policy Decides:** Determines whether the operation is permissible under current policy (`evaluateEmbeddingUpdatePolicy`).
- **Explanation Informs:** Transforms metrics and policy into human-readable understanding (`explainEmbeddingStatus`).
- **Confirmation Authorizes:** Explicit user confirmation dialog intercepts manual actions before execution (`EmbeddingUpdateConfirmationModal`).
- **Existing Pipeline Executes:** Existing single-flight worker executes generation without duplicated pipelines (`MaintenanceEngine.requestEmbeddingGeneration`).

---

## Core Architectural Invariants

1. **"Never silently consume external API resources."**
   - External API providers (e.g. Mistral, OpenRouter) incur per-token financial costs. Automatic execution for external providers is blocked by default.
2. **"Companion devices never generate shared embeddings."**
   - Mobile Companion devices operate exclusively as read-only artifact consumers. All embedding update attempts on a Companion are strictly disallowed (`companion-device-not-allowed`).
3. **Purity & Isolation:**
   - Provider capabilities define technical properties without business or UI logic.
   - The policy engine is a pure, deterministic function with zero I/O, zero network requests, and zero worker state mutations.

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

## Integration Boundaries

In accordance with the conservative step-by-step roadmap:
- **Phase 0.2.2.1** defines the data models, capability resolver, decision engine, and unit test suite.
- **Phase 0.2.2.2** introduces the presentation-oriented Status Explanation Layer (`src/maintenance/embeddingStatusExplanation.ts`) and i18n support.
- Integration with the maintenance scheduler and background worker dispatch occurs in **Phase 0.2.2.3**.
- Integration with Companion verification occurs in **Phase 0.2.2.4**.

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
