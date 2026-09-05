# Lina Architecture — Content Exclusion Policy and Artifact Invalidation

**Status:** Implemented Architecture Specification (0.3.x)
**Scope:** Vault-wide exclusion rules, Active Producer authority, multi-device synchronization, semantic rule evaluation, policy revision tracking, derived artifact invalidation, and Companion read-only enforcement.

---

## 1. Implemented Architecture & Behavioral Contract

In Lina 0.3.x:

1. **Dedicated Canonical Policy File (`.lina/exclusions.json`):**
   Exclusions are governed by a versioned, single-writer policy file (`ExclusionPolicyV1`):
   ```json
   {
     "schemaVersion": 1,
     "policyRevision": 1,
     "policyHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
     "producerDeviceId": "e9a7c3b2-7b12-4c28-8d4e-123456789abc",
     "producerEpoch": 2,
     "updatedAt": "2026-09-04T12:00:00.000Z",
     "rules": {
       "excludedFolders": [
         "03_Pessoal/"
       ],
       "excludedPathContains": [
         "senha",
         "password",
         "token",
         "secret"
       ],
       "excludedContentContains": []
     }
   }
   ```
2. **Active Producer Authority & Companion Gating:**
   - Only the device holding active ownership authority (`.lina/ownership.json`) can edit or publish `.lina/exclusions.json`.
   - Standby Producers and Companion devices view exclusions in read-only mode with clear informative notices; write attempts are rejected at the service boundary.
3. **Legacy Migration & Resilience:**
   - On first load, legacy exclusions in `data.json` are automatically migrated into `.lina/exclusions.json` on the Active Producer.
   - Behavior states:
     - `loaded`: canonical policy is active.
     - `missing`: safe temporary fallback to legacy rules until canonical policy is initialized.
     - `invalid`: corrupt policy file fails closed; authority is **never** returned to legacy `data.json`.
4. **Artifact Manifest Provenance (`.lina/index/manifest.json`):**
   - The index manifest is stamped with `exclusionPolicyRevision` and `exclusionPolicyHash`.
   - Readers evaluate provenance states: `compatible`, `mismatch`, or `unknown`.
5. **Companion Query-Time Defensive Filtering:**
   - Companion devices defensively evaluate the active exclusion policy at query time across **Text Search**, **Semantic Search**, **Hybrid Search**, and **Local Delta Search**.
   - If an index was generated under an older or mismatching revision, newly excluded notes are still filtered out in memory before results or AI prompts are assembled.
6. **Safe Note Purging:**
   - When exclusions are updated on the Active Producer, newly excluded notes are purged from `notes.json`, `chunks.jsonl`, and `embeddings.jsonl` without modifying or deleting original vault markdown notes.

---

## 2. Approved Product Rules

The following functional rules govern all exclusion implementations:

1. **Strict Data Boundary:** Exclusions are a fundamental data boundary, not a cosmetic UI filter. Excluded notes must not enter the text index, passage chunks, vector embeddings, delta search, or external AI requests.
2. **Active Producer Authority:** Exclusion rules constitute a common vault policy. Only the device holding the role of `Producer` and authorized as the `Active Producer` may modify or publish the exclusion policy.
3. **Companion Read-Only Presentation & Enforcement:** Companions consume and apply the shared policy. The Companion UI presents exclusions in read-only mode with clear notices, and internal services reject write attempts on non-producer nodes.
4. **Immediate Non-Destructive Protection:** Adding an exclusion immediately prevents notes from appearing in search results or being sent to AI providers, without modifying or deleting original user markdown notes.
5. **Deterministic Artifact Invalidation:** Modifying the exclusion policy advances a monotonic policy revision. Derived artifacts generated under earlier revisions are identified and reconciled before being considered valid.

---

## 3. Verified Acceptance Criteria (Phase 0.3.x)

- [x] `ExclusionPolicyService` provides atomic read, validation, and update methods with staged promotion and rollback.
- [x] Gating verification: write operations throw or reject on non-producer or standby devices.
- [x] Settings tab on Companion displays exclusion rules as disabled with explanatory notice.
- [x] `detectLocalDelta` in `src/companion/companionDeltaSearch.ts` strictly filters newly created and modified notes against active exclusion rules.
- [x] `.lina/index/manifest.json` includes `exclusionPolicyRevision` and `exclusionPolicyHash` matching the policy under which it was generated.
- [x] Automated regression tests verify that adding an exclusion purges matching entries from text index and embedding layers without modifying vault note files.
