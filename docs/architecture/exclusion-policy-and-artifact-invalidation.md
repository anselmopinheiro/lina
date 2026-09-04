# Lina Architecture — Content Exclusion Policy and Artifact Invalidation

**Status:** Architecture Specification (Approved Rules & Proposed 0.3.x Implementation Contract)  
**Scope:** Vault-wide exclusion rules, Active Producer authority, multi-device synchronization, semantic rule evaluation, policy revision tracking, derived artifact invalidation, and Companion read-only enforcement.

---

## 1. Current Confirmed Behavior

In the current Lina codebase (`v0.2.3` / `v0.2.4-dev`):

1. **Storage Location:** Exclusions are stored directly in `.obsidian/plugins/lina/data.json` under three settings properties:
   - `indexExcludedFolders` (multiline string);
   - `indexExcludedPathContains` (multiline string);
   - `indexExcludedContentContains` (multiline string).
2. **Path & Folder Matching (`src/index/indexExclusions.ts`):**
   - Mandatory internal folders (`.lina/`, `.obsidian/` or configured vault config directory) are hardcoded and checked via lowercase prefix match (`lowerPath.startsWith(...)`).
   - Configured folder exclusions are checked via lowercase prefix match (`lowerPath.startsWith(folder.toLowerCase())`).
   - Configured path terms are tokenized using non-alphanumeric separators (`/[^a-z0-9]+/`). Single-word terms are matched against whole path tokens (`tokens.includes(lowerTerm)`), avoiding substring false positives (e.g. `"pass"` does not match `"compass.md"`). Terms with hyphens or spaces are matched via substring in normalized paths (`normalisedPath.includes(normalisedTerm)`).
3. **Content Term Matching (`src/index/indexExclusions.ts`):**
   - Configured content terms are checked via case-insensitive substring search on note text (`lowerContent.includes(lowerTerm)`). There is currently no tokenization of word boundaries or diacritic (accent) normalization.
4. **Runtime Application Points:**
   - **Text Index Worker (`main.ts`):** Vault file modifications check `isIndexPathExcludedByUserRules(path)`. If excluded, existing entries in `indexedNotes` and `indexedChunks` are purged, and the update is skipped.
   - **Settings Change Reconciliation (`main.ts`):** On the Producer, changing exclusion settings triggers `reconcileIndexExclusionsInRuntime()`, which compares vault markdown files against `indexedNotes` and emits `delete` events for newly excluded files.
   - **Search Filtering (`linaSearchView.ts`, `semanticSearchModal.ts`):** Both search views execute in-memory defensive filtering on chunks and notes at query time (`shouldExcludePath`, `shouldExcludeContent`).
   - **AI Contextual Commands (`linaSearchView.ts`):** Slash commands (`/ask`, `/tags`, `/yaml`), folder analysis, and inbox analysis evaluate exclusion rules before assembling context and before applying modifications.

---

## 2. Confirmed Gaps

1. **Uncoordinated Storage in `data.json`:** Because `data.json` is a shared, multi-device configuration file without role-based access control, a Companion device can edit exclusion fields, potentially causing sync collisions or diverging rules across devices.
2. **Missing Policy Versioning:** The active exclusion policy lacks `schemaVersion`, monotonic `policyRevision`, and deterministic `policyHash`.
3. **Missing Manifest Derivation Tracking:** `.lina/index/manifest.json` tracks `producerDeviceId`, `producerEpoch`, and `generatedAt`, but does not record the exclusion policy revision under which the index was built. A device cannot determine whether a synchronized index reflects the latest exclusion rules.
4. **Companion Delta Search Omission:** In `src/companion/companionDeltaSearch.ts`, `detectLocalDelta` calculates creations and modifications without invoking `shouldExcludePath` or `shouldExcludeContent`. A newly created or edited excluded note can currently appear in ephemeral local delta search.
5. **Partial Artifact Invalidation:** Reconciling the text index removes records from `notes.json` and `chunks.jsonl`. However, on-disk `embeddings.jsonl` retains orphan rows until the next embedding generation batch or complete rebuild occurs.

---

## 3. Approved Product Rules

The following functional rules are formally approved and govern all future implementations:

1. **Strict Data Boundary:** Exclusions are a fundamental data boundary, not a cosmetic UI filter. Excluded notes must not enter the text index, passage chunks, vector embeddings, delta search, or external AI requests.
2. **Active Producer Authority:** Exclusion rules constitute a common vault policy. Only the device holding the role of `Producer` and authorized as the `Active Producer` may modify or publish the exclusion policy.
3. **Companion Read-Only Presentation & Enforcement:** Companions consume and apply the shared policy. The Companion UI must present exclusions in read-only mode with clear notices, and internal services must reject write attempts on non-producer nodes.
4. **Immediate Non-Destructive Protection:** Adding an exclusion must immediately prevent notes from appearing in search results or being sent to AI providers, without modifying or deleting original user markdown notes.
5. **Deterministic Artifact Invalidation:** Modifying the exclusion policy must advance a monotonic policy revision. Derived artifacts generated under earlier revisions must be identified and reconciled before being considered valid.

---

## 4. Proposed 0.3.x Contract

To implement the approved product rules, the following design is planned for Phase 0.3.x:

### 4.1 Dedicated Policy File (`.lina/exclusions.json`)
Exclusion rules are proposed to move from `data.json` into a dedicated, versioned file in `.lina/exclusions.json`:

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

#### Note on Coordination Identifiers:
`producerDeviceId` and `producerEpoch` in this policy are vault-scoped coordination identifiers (identical to the existing model in `.lina/ownership.json`). They are not hardware serials, IP addresses, or secrets. They provide epoch-fencing so that standby or stale producers cannot overwrite an active policy.

### 4.2 Extended Artifact Manifest (`.lina/index/manifest.json`)
The published search index manifest is planned to track the policy revision:

```json
{
  "formatVersion": 2,
  "producerDeviceId": "e9a7c3b2-7b12-4c28-8d4e-123456789abc",
  "producerEpoch": 2,
  "generatedAt": "2026-09-04T12:05:00.000Z",
  "exclusionPolicyRevision": 1,
  "notesCount": 1420,
  "chunksCount": 4250
}
```

### 4.3 Proposed Invalidation Sequence on Producer
1. User updates exclusions in Settings on the Active Producer.
2. Producer increments `policyRevision` ($R \to R+1$), computes `policyHash`, and persists `.lina/exclusions.json` using staged promotion with rollback.
3. In-memory policy cache on Producer updates immediately.
4. Active index and embeddings are marked as `stale-policy-revision`.
5. Reconciliation worker scans indexed notes:
   - Newly excluded notes are removed from `notes.json` and `chunks.jsonl`.
   - Orphan embedding rows are purged from `embeddings.jsonl` and binary cache.
6. Producer republishes `.lina/index/manifest.json` stamped with `exclusionPolicyRevision: R+1`.

### 4.4 Proposed Companion Handling During Sync Skew
- **Policy Newer than Index:** A new exclusion arrived, but updated index artifacts have not yet synced. Companion applies defensive in-memory filtering against the newer policy for text search, delta search, and AI actions. Semantic search is suspended or strictly filtered until matching artifacts arrive.
- **Index Newer than Policy:** Updated index arrived before policy file. Index is safely searched (it already omits excluded notes).
- **Missing Policy:** Fresh vault without policy defaults to mandatory internal exclusions (`.lina/`, `.obsidian/`) and built-in sensitive terms, avoiding exposure while awaiting sync.

---

## 5. Open Technical Decisions

1. **Content Term Matching Semantics:**
   - *Current Behavior:* Substring match (`lowerContent.includes(lowerTerm)`).
   - *Issue:* Substring matching can cause unintended exclusions (e.g. `"chave"` matching `"arquivamento"` if unspaced).
   - *Decision Needed:* Evaluate whether to keep substring matching for backward compatibility, add diacritic normalization (e.g. `"senha"` matching `"sénha"`), or transition to whole-word boundary matching.
2. **Initial Vault Bootstrap:**
   - Decide whether the first Active Producer creates `.lina/exclusions.json` automatically on plugin load if absent, or upon initial index build.
3. **Publication Order Under Sync:**
   - Confirm the exact write order: publish `.lina/exclusions.json` first (fail-closed) vs atomic multi-file promotion alongside updated `.lina/index/manifest.json`.

---

## 6. Future Acceptance Criteria (Phase 0.3.x)

- [ ] `ExclusionPolicyService` provides atomic read, validation, and update methods.
- [ ] Gating verification: write operations throw or reject on non-producer or standby devices.
- [ ] Settings tab on Companion displays exclusion rules as disabled with explanatory notice.
- [ ] `detectLocalDelta` in `src/companion/companionDeltaSearch.ts` strictly filters newly created and modified notes against the active exclusion rules.
- [ ] `.lina/index/manifest.json` includes `exclusionPolicyRevision` matching the policy under which it was generated.
- [ ] Automated regression tests verify that adding an exclusion purges matching entries from text index and embedding layers without modifying vault note files.
