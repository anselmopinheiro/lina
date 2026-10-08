# ANDROID-BINARY-CACHE-SUPPORT-AUDIT-001

## Diagnostic & Technical Audit: Android Companion Binary Cache "não suportada" Issue

### 1. Executive Summary

This document presents the root cause analysis and technical audit for why Lina on Android Companion reports:
`Estado da cópia: não suportada` (Copy state: unsupported) when checking published binary embedding caches (`vectors.bin` / `.lina/index/embeddings.vectors.f32`), resulting in semantic search being marked unavailable and hybrid search falling back to textual-only mode.

---

### 2. Root Cause Analysis (ROOT CAUSE)

**Root Cause Classification:** `G. Outro motivo concreto (Paradoxo de Validação Canónica no Companion)`

**Detailed Mechanism:**
1. When the user executes **"Verificar cache rápida"** (Check fast cache) on Android Companion, `BinaryEmbeddingCopyController.check(true)` runs `checkInternal()`.
2. `checkInternal()` verifies that the binary publication files (`embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`) exist and are readable using Obsidian's `adapter.readBinary(...)`.
3. `checkInternal()` reads `.lina/index/manifest.json` (`readCanonicalManifest()`) to obtain `canonical.publicationId`.
4. `checkInternal()` calls `readCanonicalPairState(canonical)` (in [`src/index/embeddingBinaryCopyController.ts:274-280`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryCopyController.ts#L274-L280)) to verify that the derived binary cache is consistent with the canonical JSONL index (`.lina/index/embeddings.jsonl`).
5. **The Paradox**:
   `readCanonicalPairState` evaluates `evaluateEmbeddingBridgeRead(stat.size, getDeviceCapabilities().resourceProfile)` on `.lina/index/embeddings.jsonl`.
   On Android Companion (`resourceProfile === "mobile"`), `MOBILE_BRIDGE_READ_GUARD.maxFileBytes` in [`src/index/embeddingResourceGuard.ts:21`](file:///d:/_dev/obsidian/lina/src/index/embeddingResourceGuard.ts#L21) is **12 MB**.
   When `embeddings.jsonl` is larger than 12 MB (which is precisely when the binary cache is required!), `evaluateEmbeddingBridgeRead` returns `{ allowed: false, code: "mobile-bridge-read-limit-exceeded" }`.
   Consequently, `readCanonicalPairState` returns `"resource-limit-exceeded"`.
6. **The Result**:
   In [`src/index/embeddingBinaryCopyController.ts:68`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryCopyController.ts#L68):
   ```ts
   if (pairState === "resource-limit-exceeded") return { status: "unsupported", reason: "Não foi possível validar o par canónico dentro do limite de recursos." };
   ```
   `checkInternal()` translates `"resource-limit-exceeded"` into `{ status: "unsupported" }`.
   The settings tab renders `status: "unsupported"` as:
   `Estado da cópia: não suportada`.

7. **Search Fallback Cascade**:
   In [`src/search/runtimeEmbeddingIndex.ts`](file:///d:/_dev/obsidian/lina/src/search/runtimeEmbeddingIndex.ts#L484-L565), if `BinaryEmbeddingCopyController` or binary verification flags the cache as unsupported/invalid, `RuntimeEmbeddingIndex` attempts fallback to loading `embeddings.jsonl`. Since `embeddings.jsonl` exceeds the 12 MB bridge guard, loading fails with `fallbackReason = "no-safe-source"`.
   In [`src/search/hybridSearch.ts:85`](file:///d:/_dev/obsidian/lina/src/search/hybridSearch.ts#L85), `fallbackReason === "no-safe-source"` triggers `reasonCode: "binary-required"`, producing the user-facing message:
   `"Os embeddings publicados são demasiado grandes para carregar em JSONL com segurança. É necessária uma cópia binária válida."`
   Semantic search becomes unavailable and hybrid search falls back to textual-only mode.

---

### 3. Unsupported Condition (UNSUPPORTED CONDITION)

The condition producing `UNSUPPORTED` is strictly:
```ts
pairState === "resource-limit-exceeded"
```
in `BinaryEmbeddingCopyController.checkInternal()`, triggered when `evaluateEmbeddingBridgeRead(stat.size, "mobile")` returns `allowed: false` for `.lina/index/embeddings.jsonl`.

---

### 4. Platform Detection Audit (PLATFORM DETECTION)

- `getDeviceCapabilities()` ([`src/capabilities/deviceCapabilities.ts:35-49`](file:///d:/_dev/obsidian/lina/src/capabilities/deviceCapabilities.ts#L35-L49)) sets:
  - `role`: `"companion"` for mobile (`Platform.isMobile`).
  - `resourceProfile`: `"mobile"`.
  - `canMaintainBinaryCopy`: `false` (prevents mobile from writing/publishing binary copies).
  - `canReadArtifacts`: `true` (authorizes mobile to read published artifacts).
  - `canExecuteSearch`: `true`.
- **Verdict**: Capability detection correctly authorizes mobile to read published artifacts. Mobile is NOT blocked by explicit platform guards from reading binary files.

---

### 5. Desktop vs Mobile Binary Reader (DESKTOP / MOBILE READER)

- **Desktop Reader**: Uses `readBinaryEmbeddingStorage` ([`src/index/embeddingBinaryStorage.ts:425`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts#L425)) with `DESKTOP_EMBEDDING_BINARY_RESOURCE_LIMITS` (64MB max vectors, 96MB total).
- **Mobile Reader**: Uses the same `readBinaryEmbeddingStorage` function with `MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS` (16MB max vectors, 24MB total).
- **API Surface**: Both desktop and mobile use Obsidian's `adapter.readBinary(...)` which returns `Promise<ArrayBuffer>`, along with Web standard `DataView.getFloat32(...)`, `Uint8Array`, `TextEncoder`, and `window.crypto.subtle.digest("SHA-256")`.
- **Verdict**: `AVAILABLE_OBSIDIAN_API = SUPPORTED_BY_EXISTING_API`. The binary reader uses standard APIs fully available on Obsidian Mobile.

---

### 6. Memory Constraints & JSONL Exemption (MEMORY CONSTRAINTS)

- Mobile JSONL Bridge Read Limit: **12 MB** (`MOBILE_BRIDGE_READ_GUARD.maxFileBytes`).
- Mobile Binary Limits: **16 MB** vector bytes, **8 MB** metadata bytes, **24 MB** total file bytes, **64 MB** estimated peak memory (`MOBILE_EMBEDDING_BINARY_RESOURCE_LIMITS`).
- **Core Principle**: The binary cache exists specifically to avoid reading `embeddings.jsonl` into JS string memory. Requiring `embeddings.jsonl` to be bridge-readable on mobile in order to validate `vectors.bin` creates a circular dependency that breaks binary cache usage on mobile whenever `embeddings.jsonl` > 12 MB.
- **Answer to Question 8**: When the binary cache is valid on Android Companion, `embeddings.jsonl` DOES NOT need to be loaded for semantic search.

---

### 7. Recommended Solution (RECOMMENDED FIX)

**Fix Strategy**:
Decouple binary copy validation on Companion devices (or when `embeddings.jsonl` cannot be bridge-read due to size limits) from reading the entire `embeddings.jsonl` file.

1. **In `BinaryEmbeddingCopyController.checkInternal()` and `readCanonicalPairState()`**:
   When `stat.size` of `embeddings.jsonl` exceeds the bridge read limit (`evaluateEmbeddingBridgeRead` returns `allowed: false` / `"resource-limit-exceeded"`), `readCanonicalPairState` should NOT return `"resource-limit-exceeded"` as an immediate failure for checking binary copy validity.
   Instead, when `embeddings.jsonl` cannot be bridge-read:
   - Verify that `canonical.publicationId` from `.lina/index/manifest.json` (which is small and always readable) matches `runtime.sourceIdentity.publicationId` in `embeddings.binary.manifest.json`.
   - Verify that record count, dimensions, provider, model, input version, prefix mode, vector digest, and metadata digest match.
   - If `sourcePublicationId` matches `canonical.publicationId` and binary integrity is proven, return `pairState = "consistent"`.

2. **In `BinaryEmbeddingCopyController.runWrite()`**:
   Creating/updating a binary copy is a Producer responsibility (`canMaintainBinaryCopy: false` on mobile). Mobile Companion only reads.

3. **In `RuntimeEmbeddingIndex.load()`**:
   `RuntimeEmbeddingIndex.load()` already contains logic to skip `embeddings.jsonl` reading when `evaluateEmbeddingBridgeRead(source.canonicalSize, profile).allowed` is false. Once `BinaryEmbeddingCopyController.check()` reports `valid` instead of `unsupported`, status reports and search availability will correctly recognize the binary copy as valid.

---

### 8. Implementation Risk Assessment (RISK)

- **Risk Level**: Very Low.
- **Scope**: Internal validation logic in `BinaryEmbeddingCopyController`.
- **Invariants Preserved**:
  - No changes to published binary file format (`vectors.bin` / `embeddings.binary.manifest.json`).
  - No generation of embeddings on Companion / mobile.
  - No changes to memory resource limits (OOM protections remain intact).
  - No changes to ownership, CURRENT, or SQLite.
  - Zero desktop regressions (desktop continues full canonical pair inspection when within resource limits).

---

### 9. Summary Table

| Parameter | Audit Result |
| :--- | :--- |
| **ROOT CAUSE** | `readCanonicalPairState` fails when `embeddings.jsonl` > 12MB on mobile, returning `resource-limit-exceeded` which `checkInternal` maps to `UNSUPPORTED`. |
| **UNSUPPORTED CONDITION** | `pairState === "resource-limit-exceeded"` in `BinaryEmbeddingCopyController.checkInternal()`. |
| **MOBILE API AVAILABLE?** | `SUPPORTED_BY_EXISTING_API` (Obsidian `adapter.readBinary`, `window.crypto.subtle`, `DataView`). |
| **RECOMMENDED FIX** | Allow companion binary validation to verify `publicationId` match against `manifest.json` without forcing `embeddings.jsonl` bridge read when `embeddings.jsonl` exceeds mobile bridge limit. |
| **RISK** | Very Low (zero schema/format/memory limit changes, companion remains read-only). |
