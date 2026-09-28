# LINA-03 — Architecture consistency audit

**Audit type:** final architectural analysis  
**Version:** Lina 0.3.0  
**Date:** 2026-09-27

## 1. Current state and architecture

The audited commit is `95821e2` on `master`; the only uncommitted file at the
start was the preceding embedding-state audit report. The active architecture
uses a Producer-publishes / Companion-consumes model with explicit ownership
fencing, canonical manifests, device-scoped configuration, and private
operational work paths.

```text
local application: device ID, local settings, endpoints, preferences, secrets
vault .lina/index: published text/vector/binary artifacts and Vector Contract
vault .lina/producer: checkpoints, staging, rollback backups
vault .lina/*.json: ownership, exclusion policy, producer telemetry, device state
```

## 2. Source-of-truth matrix

| Information | Source of truth | Writer | Reader | Synchronizes |
| --- | --- | --- | --- | --- |
| Local UI/provider preferences, endpoint, batch/timeout/read preference | local plugin `data.json` / `deviceSettingsById` | local device | local runtime/settings | No |
| Device UUID | `app.loadLocalStorage` | local application | local application | No |
| Credentials | `app.secretStorage` | local device | provider bridges | Never |
| Device role/name | `.lina/devices/<deviceId>.json` | that device only | role resolution/diagnostics | Yes |
| Active Producer authority and epoch | `.lina/ownership.json` | authorized transfer/role workflow | all writer gates | Yes |
| Ownership transition history | `.lina/ownership-history/` | ownership workflow | diagnostics/recovery | Yes |
| Exclusion policy | `.lina/exclusions.json` | Active Producer | all consumers | Yes |
| Published text/vector contract and artifact facts | `.lina/index/manifest.json` | Active Producer after validation | Producer, Companion, search | Yes |
| Published notes/chunks/JSONL/binary files | exact canonical `.lina/index/` paths | Active Producer | Producer and Companion | Yes |
| Checkpoints, candidates, backups | `.lina/producer/` | Active Producer | recovery/local diagnostics | No; requires sync exclusion |
| Publication/freshness telemetry | `.lina/producer-state.json` | Active Producer | diagnostics/status | Yes; observational only |
| Rebuild/reuse/incompatibility decision | pure planner/state calculations | derived from authoritative inputs | Producer status/workflow | No |

## 3. Consistency findings

### Confirmed coherent

- `data.json` is demoted from shared authority: it supplies only local intent.
  Companion provider/model inheritance comes from the published Vector Contract
  and has no silent local fallback.
- `ownership.json`, not producer state or local role preference, authorizes
  shared writes. Producer state contains timestamps/publication telemetry and
  does not grant authority.
- `.lina/index/` writers now keep text, JSONL embedding, and binary candidates
  and backups in `.lina/producer/`; readers use exact canonical filenames.
- Companion is gated out of Producer maintenance, contract creation, and
  canonical writes. It consumes canonical artifacts and can degrade safely to
  text search when publication is incomplete/unavailable.
- Settings reflects the architecture: Companion embedding provider/model are
  read-only, credentials stay outside UI state, and destructive binary actions
  retain confirmation. Diagnostics reads the Producer-private checkpoint path.

### Findings / risks

1. **External sync configuration remains a prerequisite.** `.lina/producer/`
   and `.obsidian/plugins/lina/data.json` remain inside a vault in common
   installations. Their non-synchronization is documented but cannot be
   enforced by plugin code; every synchronization tool must exclude them.
2. **Documentation wording diverges.** `docs/roadmap.md` calls `data.json`
   “Shared Configuration”, while README/manual and runtime authority rules
   describe it as device-local. The latter is the correct current contract.
3. **Legacy-residue policy is intentionally conservative.** Old index-local
   checkpoint/backup/temp files are not deleted automatically. This avoids data
   loss but requires a future explicit detection/cleanup UX.
4. **Test fixtures retain old checkpoint paths in a few binary-controller and
   binary-storage isolation tests.** They act as sentinels proving the binary
   path does not touch unrelated legacy data; they are not current production
   writer paths. Their naming should be clarified in future test maintenance.

## 4. Producer, Companion, and UI impact

**Producer:** only the device fenced by ownership may publish. Its local
configuration chooses a future generation; the manifest commits the resulting
contract. Interrupted work remains private and recoverable.

**Companion:** needs only the published manifest/contract and canonical
artifacts, plus its own endpoint/credentials. It never determines the contract
or interprets Producer checkpoints as published state.

**UI:** settings presents local intent and role-gated controls; diagnostics
reports published artifacts, provenance/freshness, and private checkpoint
progress without granting operational authority to those views.

## 5. Documentation and migration impact

README and the manual accurately describe the core Producer/Companion and
storage boundary. The roadmap should replace “Shared Configuration” for
`data.json` with “device-local non-sensitive configuration” in a future
documentation-only correction. A future migration phase should offer explicit
inspection and user-confirmed cleanup of legacy operational residues; it must
not delete them automatically or alter schemas.

## 6. Recommendations and next steps

1. Keep the present sources of truth; do not add a generic embedding-state
   file or a parallel authority.
2. Correct the roadmap terminology for `data.json`.
3. Specify an explicit legacy-artifact inspection/cleanup workflow.
4. Evaluate physical device-local runtime storage in a separate phase if
   external sync exclusions prove insufficient; do not mix that decision with
   schema or contract changes.

## 7. Conclusion

**Each information type in Lina 0.3.0 has one operational source of truth, and
Producer, Companion, and publication boundaries are coherent. The remaining
condition is operational: sync filters must exclude local settings and the
Producer-private workspace until a future physical local-storage boundary is
adopted.**
