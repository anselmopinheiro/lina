# Lina Architecture — OpenRouter Embedding Capability Verification

> [!NOTE]
> **Historical Pre-Implementation Audit (Resolved in Phase 2.2D):**
> This document records the architectural state and capability audit conducted *prior* to Phase 2.2D. The embedding gap identified below was subsequently resolved in **Phase 2.2D** by implementing dedicated OpenRouter embedding support ([`src/ai/openRouterProvider.ts`](file:///d:/_dev/obsidian/lina/src/ai/openRouterProvider.ts)), adding domain-filtered settings dropdowns, and establishing `openai/text-embedding-3-small` as the default embedding model. OpenRouter now supports manual embedding generation.

**Status:** Historical Capability Audit (Resolved in Phase 2.2D)  
**Role:** Senior Software Architect  
**Scope:** Historical source-code capability verification for OpenRouter in Lina 0.2 (chat/analysis vs. embeddings), settings wiring, provider resolution, runtime execution pipeline, tests, Phase 2.3 scope impact, and documentation reconciliation.

---

## A. Executive Verdict

```text
OPENROUTER DOES NOT SUPPORT EMBEDDINGS
(OPENROUTER EMBEDDING SUPPORT IS PARTIAL / UNWIRED IN SETTINGS UI ONLY)
```

### Summary of Verdict
1. **Runtime Execution:** OpenRouter **does not support embedding generation** in Lina. There is zero embedding client code, zero endpoint URL builders, zero request/response transformers, zero model catalog entries, and zero execution tests for OpenRouter embeddings in the repository.
2. **Runtime Guard:** Invoking the embedding pipeline with `provider: "openrouter"` (or testing the embedding connection in settings) immediately fails with `unsupported-provider` (`"Provider de embeddings \"openrouter\" ainda não implementado nesta versão."`).
3. **Settings UI Discrepancy:** The string `"openrouter"` appears in the settings dropdown for `embeddings-provider` solely because the settings system uses a single unified type union `PureLocalProviderId = "ollama" | "mistral" | "openrouter"` across both `analysis` and `embedding` domains. It is an unwired UI selection option with no backend capability.
4. **Chat / Analysis AI:** OpenRouter is intended as a Chat / Analysis AI provider, though runtime chat execution currently also returns not-implemented.

---

## B. Evidence

### 1. Embedding Provider Factory & Dispatch
* **File:** [`src/ai/embeddingProvider.ts`](file:///d:/_dev/obsidian/lina/src/ai/embeddingProvider.ts#L25-L61)
* **Symbol:** `generateProviderEmbeddings(request: ProviderEmbeddingBatchRequest)`
* **Proof:** The embedding dispatch function contains explicit branches for `"mistral"` and `"ollama"` only:
  ```typescript
  if (provider === "mistral") {
    return await generateMistralEmbeddings(...);
  }

  if (provider === "ollama") {
    return await generateOllamaEmbeddings(...);
  }

  return operationError(
    "unsupported-provider",
    `Provider de embeddings "${request.provider}" ainda não implementado nesta versão.`,
    { provider: request.provider, requestCount: 0 }
  );
  ```
  Passing `"openrouter"` directly hits the fallback and returns `unsupported-provider`.

### 2. Absence of OpenRouter Provider Implementation
* **Directory:** [`src/ai/`](file:///d:/_dev/obsidian/lina/src/ai/)
* **Files Present:**
  - `ollamaProvider.ts` (implements `generateOllamaEmbeddings`, `generateOllamaEmbedding`, `generateOllamaText`)
  - `mistralProvider.ts` (implements `generateMistralEmbeddings`, `generateMistralText`)
  - `embeddingProvider.ts` (dispatcher for Ollama & Mistral)
  - `types.ts`, `embeddingTypes.ts`, `providerDefaults.ts`, `modelCatalog.ts`
* **Proof:** There is **no `openrouterProvider.ts`** or equivalent module in the entire repository. No HTTP requests to OpenRouter embedding endpoints (`https://openrouter.ai/api/v1/embeddings`) exist in the codebase.

### 3. Model Catalog & Provider Capabilities
* **File:** [`src/ai/modelCatalog.ts`](file:///d:/_dev/obsidian/lina/src/ai/modelCatalog.ts#L1-L24) & [`src/ai/modelCatalog.json`](file:///d:/_dev/obsidian/lina/src/ai/modelCatalog.json)
* **Symbol:** `export type ModelProviderId = "ollama" | "mistral";`
* **Proof:** The model catalog definition explicitly restricts supported model providers to `"ollama" | "mistral"`. OpenRouter is excluded from `ModelProviderId` and has no catalog entries for either chat or embeddings.

### 4. Embedding Model Defaults
* **File:** [`src/ai/providerDefaults.ts`](file:///d:/_dev/obsidian/lina/src/ai/providerDefaults.ts#L15-L18)
* **Symbol:** `EMBEDDING_MODEL_DEFAULTS`
* **Proof:**
  ```typescript
  const EMBEDDING_MODEL_DEFAULTS: Record<string, string> = {
    ollama: "nomic-embed-text-v2-moe",
    mistral: "mistral-embed",
  };
  ```
  OpenRouter has no default embedding model defined. `getEmbeddingProviderDefaults("openrouter")` returns `{ baseUrl: "https://openrouter.ai/api/v1", model: "" }`.

### 5. Settings Connection Testing
* **File:** [`src/settings.ts`](file:///d:/_dev/obsidian/lina/src/settings.ts#L797-L816)
* **Symbol:** `testEmbeddings: async (input) => { ... }`
* **Proof:** The test action invokes `generateProviderEmbedding({ provider: input.provider, ... })`. When configured to OpenRouter, `generateProviderEmbeddings` returns `unsupported-provider`, resulting in `{ outcome: "failed", messageKey: "embedding-test-failed" }`.

### 6. Settings Model & UI Dropdown Leakage
* **File:** [`src/settings/pureLocalSettingsModel.ts`](file:///d:/_dev/obsidian/lina/src/settings/pureLocalSettingsModel.ts#L51-L70)
* **Symbol:** `export type PureLocalProviderId = "ollama" | "mistral" | "openrouter";`
* **Proof:** `PURE_LOCAL_SETTING_METADATA` defines both `analysisProvider` and `embeddingsProvider` with `kind: "provider"`. The helper `getPureLocalProviderOptions()` returns all items in `PURE_LOCAL_PROVIDERS` (`ollama`, `mistral`, `openrouter`) without filtering by domain (`analysis` vs `embedding`). As a result, the Settings UI renders "OpenRouter" in the Embeddings Provider dropdown even though no embedding runtime exists.

### 7. Test Suite Reality
* **Search:** Full repository search for OpenRouter embedding execution tests.
* **Proof:**
  - `tests/index/embeddingProviderValidation.test.ts`: **0 references** to OpenRouter (tests Ollama and Mistral only).
  - `tests/index/embeddingBatching.test.ts`: **0 references** to OpenRouter (tests Mistral and Ollama batching).
  - All test references to `openrouter` across `tests/settings/*.test.ts` test only UI string persistence, text input rendering, and credential storage in settings adapters.
  - `tests/maintenance/embeddingScheduler.test.ts` (line 218) contains a test `it("keeps OpenRouter work manual-only")` which merely verifies that `canDispatchAutomatically: false` prevents automatic scheduling.

---

## C. Runtime Path

```text
Lina Settings (UI)
   │
   ├─► User selects "Embeddings Provider = OpenRouter"
   │   (Option visible due to shared PureLocalProviderId in settings adapter)
   │
   ▼
main.ts (getEffectiveEmbeddingConfig)
   │
   ├─► provider = "openrouter"
   ├─► baseUrl = "https://openrouter.ai/api/v1"
   ├─► model = "" (or custom text input)
   │
   ▼
MaintenanceEngine / EmbeddingWorker
   │
   ▼
Index Embedding Generator (generateEmbeddingsForChunks)
   │
   ▼
src/ai/embeddingProvider.ts (generateProviderEmbeddings)
   │
   ├─► provider === "mistral"   ──► generateMistralEmbeddings()  [REAL API CLIENT]
   ├─► provider === "ollama"    ──► generateOllamaEmbeddings()   [REAL API CLIENT]
   └─► provider === "openrouter"──► ❌ operationError("unsupported-provider")
                                       [NO CLIENT / NO ADAPTER / HALTS GENERATION]
```

---

## D. Chat vs Embeddings Matrix

| Provider | Type | Chat / Analysis AI | Vector Embeddings | Automatic Maintenance |
| :--- | :--- | :---: | :---: | :---: |
| **Ollama** | Local | ✅ Supported (`generateOllamaText`) | ✅ Supported (`generateOllamaEmbeddings`) | ✅ **Active** (Desktop Producer) |
| **Mistral** | Remote API | ✅ Supported (`generateMistralText`) | ✅ Supported (`generateMistralEmbeddings`) | ❌ **Manual Only** (Phase 2.2) |
| **OpenRouter** | Remote API | ⚠️ UI Configured (Runtime returns not-implemented) | ❌ **Not Supported** (No client / `unsupported-provider`) | ❌ **N/A** (Cannot generate vectors) |

---

## E. Phase 2.3 Impact & Scope Recommendation

### Architectural Conflict in Previous Documentation
In previous documentation drafts, Phase 2.3 and Phase 2.4 were described as:
- *“Phase 2.3: Remote provider cost safeguards, pre-flight estimation, per-run batch caps (e.g., 50 chunks), and circuit breakers for Mistral and OpenRouter.”*
- *“Phase 2.4: Opt-in automatic maintenance for remote providers (Mistral, OpenRouter) with user confirmation.”*

### Recommendation for Phase 2.3
1. **Scope Phase 2.3 Strictly to Mistral:**
   - **Mistral** is the only remote provider that has an embedding API client (`mistralProvider.ts`), batching implementation, model catalog entries (`mistral-embed`), and verified embedding generation tests.
   - Phase 2.3 (remote cost guards, per-run batch caps, circuit breakers) must be implemented and tested **exclusively for Mistral**.
2. **Do Not Include OpenRouter in Embedding Safeguards:**
   - Building cost guards or batch caps for OpenRouter embeddings is impossible because OpenRouter cannot generate embeddings in Lina.
   - Any attempt to test OpenRouter embedding safeguards would immediately fail at the provider dispatcher with `unsupported-provider`.
3. **Future Options for OpenRouter:**
   - If OpenRouter embeddings are desired in a future version (e.g., Lina 0.3+), it will require first implementing an `openrouterProvider.ts` embedding client, defining endpoint builders, adding response parsers, and writing unit tests.
   - Until then, OpenRouter must be documented as an **Analysis-only provider** with zero embedding capability.

---

## F. Documentation Corrections Needed (For Future Documentation Task)

The following active English documentation files contain statements that group OpenRouter with Mistral for embeddings or automatic embedding maintenance and should be reconciled in a subsequent documentation update:

1. **`README.md`**:
   - The provider table row for OpenRouter has `Embeddings: ❌` but lists `Maintenance Mode: Manual only (API charges apply)`. It should state `Maintenance Mode: N/A (Chat/Analysis only)`.
   - Note under table groups `Remote AI Providers (Mistral, OpenRouter)` under automatic embedding maintenance discussions.
2. **`docs/manual.md`**:
   - Module 5.1 states: *“Remote Providers (Mistral, OpenRouter): Embeddings for remote providers remain strictly manual-only to prevent unexpected third-party API billing.”* OpenRouter should be removed from embedding maintenance descriptions.
   - Current Alpha Limitations states: *“remote API providers (Mistral, OpenRouter) remain manual-only.”* Should clarify that Mistral is the manual remote embedding provider and OpenRouter is analysis-only.
3. **`docs/roadmap.md` & `docs/Lina-0.2.x-Roadmap.md`**:
   - Phase 2.3 description mentions: *“circuit breakers for Mistral and OpenRouter”*. Should be corrected to *“for remote providers (Mistral)”*.
   - Phase 2.4 description mentions: *“automatic maintenance for remote providers (Mistral, OpenRouter)”*. Should be corrected to *“for remote providers (Mistral)”*.
4. **`docs/architecture/lina-0.2-automatic-maintenance-analysis.md`**:
   - Repeatedly references `Remote Providers (Mistral, OpenRouter)` in Section 1, Section 5, Section 7, and Section 12 for embedding cost policies and batch caps. Should clarify that Mistral is the sole remote embedding provider.
5. **`docs/architecture/maintenance-engine.md`, `device-capabilities.md`, and `embedding-worker.md`**:
   - References stating *“Mistral and OpenRouter remain strictly manual-only for embeddings”* should clarify that Mistral is manual-only and OpenRouter does not support embeddings.
6. **`CHANGELOG.md`**:
   - Unreleased summary states: *“Remote AI providers (Mistral, OpenRouter) remain strictly manual-only;”*. Should clarify that Mistral is manual-only for embeddings, while OpenRouter is not an embedding provider.

---

## G. Conclusion

The source code is unambiguous: **OpenRouter does not support vector embeddings in Lina**. The appearance of OpenRouter in the embeddings provider settings dropdown is an artifact of a shared TypeScript type union (`PureLocalProviderId`). Phase 2.3 must focus solely on **Mistral** for remote embedding safeguards.
