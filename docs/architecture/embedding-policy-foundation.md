# Embedding Policy Foundation (Phase 0.2.2.1)

## Overview

Phase 0.2.2.1 introduces the foundational decision layer for vector embedding updates in the Lina plugin.

Prior to this phase, Lina possessed robust primitives for text indexing, status detection (`embeddingState.ts`), plan generation (`embeddingUpdatePlan.ts`), single-flight workers (`embeddingWorker.ts`), and atomic publication (`embeddingGenerator.ts`). However, the decision logic dictating *when* and *under what conditions* an embedding generation could execute was implicit and tightly coupled.

The Embedding Policy Foundation establishes a clean three-tier separation of concerns:

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
│    • Zero worker / scheduler execution coupling             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Execution (Controlled Execution)                         │
│    • Worker lock coordination, batching, checkpoints        │
│    • Canonical JSONL publication & binary copy handoff      │
└─────────────────────────────────────────────────────────────┘
```

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


