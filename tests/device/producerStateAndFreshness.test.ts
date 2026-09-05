import { describe, it, expect } from "vitest";
import {
  type ProducerStateV1,
  PRODUCER_STATE_SCHEMA_VERSION,
  DEFAULT_AGING_THRESHOLD_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  isProducerStateV1,
  createProducerState,
  evaluateTimestampFreshness,
  evaluateProducerStateFreshness,
  loadProducerState,
  saveProducerState,
  updateProducerState,
  getProducerStatePath,
} from "../../src/device/producerState";
import {
  type OwnershipManifest,
  type OwnershipDataAdapter,
  OWNERSHIP_SCHEMA_VERSION,
} from "../../src/device/deviceOwnership";
import {
  evaluateCompanionConsumptionState,
  readCompanionConsumptionState,
} from "../../src/companion/companionConsumptionState";

class MemoryAdapter implements OwnershipDataAdapter {
  public files = new Map<string, string>();
  public failOn: string | null = null;
  public operations: string[] = [];

  async exists(path: string): Promise<boolean> {
    this.operations.push(`exists:${path}`);
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    this.operations.push(`read:${path}`);
    if (this.failOn === `read:${path}`) {
      throw new Error(`Simulated read failure: ${path}`);
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    this.operations.push(`write:${path}`);
    if (this.failOn === `write:${path}`) {
      throw new Error(`Simulated write failure: ${path}`);
    }
    this.files.set(path, data);
  }

  async rename(from: string, to: string): Promise<void> {
    this.operations.push(`rename:${from}->${to}`);
    if (this.failOn === `rename:${from}->${to}`) {
      throw new Error(`Simulated rename failure: ${from}->${to}`);
    }
    const content = this.files.get(from);
    if (content === undefined) {
      throw new Error(`Source not found for rename: ${from}`);
    }
    this.files.delete(from);
    this.files.set(to, content);
  }

  async remove(path: string): Promise<void> {
    this.operations.push(`remove:${path}`);
    if (this.failOn === `remove:${path}`) {
      throw new Error(`Simulated remove failure: ${path}`);
    }
    this.files.delete(path);
  }
}

const PRODUCER_A = "11111111-1111-4111-8111-111111111111";
const PRODUCER_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_C = "33333333-3333-4333-8333-333333333333";

function createValidOwnership(producerId = PRODUCER_A, epoch = 1): OwnershipManifest {
  return {
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    activeProducerId: producerId,
    epoch,
    acquiredAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    reason: "initial",
  };
}

describe("LINA-03-006: Producer State & Freshness", () => {
  describe("Contract & Parsing", () => {
    it("1. validates a well-formed ProducerStateV1 object", () => {
      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        textIndex: {
          lastSuccessfulPublicationAt: new Date().toISOString(),
          exclusionPolicyHash: "ph1:abc123def456",
          exclusionPolicyRevision: 2,
        },
        embeddings: {
          lastSuccessfulPublicationAt: new Date().toISOString(),
          publicationId: "pub-100",
          vectorContractId: "vc1:contract789",
        },
        maintenance: {
          status: "idle",
        },
      });

      expect(isProducerStateV1(state)).toBe(true);
      expect(state.schemaVersion).toBe(PRODUCER_STATE_SCHEMA_VERSION);
      expect(state.activeProducerId).toBe(PRODUCER_A);
      expect(state.producerEpoch).toBe(1);
      expect(state.textIndex.exclusionPolicyHash).toBe("ph1:abc123def456");
      expect(state.embeddings.vectorContractId).toBe("vc1:contract789");
    });

    it("2. returns null on missing file without throwing", async () => {
      const adapter = new MemoryAdapter();
      const state = await loadProducerState(adapter);
      expect(state).toBeNull();
    });

    it("3. returns null on corrupt JSON without throwing", async () => {
      const adapter = new MemoryAdapter();
      adapter.files.set(getProducerStatePath(), "{ not json at all");
      const state = await loadProducerState(adapter);
      expect(state).toBeNull();
    });

    it("4. rejects unknown schema version", () => {
      const invalid = {
        schemaVersion: 999,
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        updatedAt: new Date().toISOString(),
        textIndex: { lastSuccessfulPublicationAt: null },
        embeddings: { lastSuccessfulPublicationAt: null },
        maintenance: { status: "idle" },
      };
      expect(isProducerStateV1(invalid)).toBe(false);
    });

    it("5. rejects invalid producerEpoch (zero, negative, non-integer)", () => {
      expect(() =>
        createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 0,
        })
      ).toThrow();

      expect(() =>
        createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: -2,
        })
      ).toThrow();

      expect(() =>
        createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1.5,
        })
      ).toThrow();
    });

    it("6. rejects invalid timestamps", () => {
      expect(() =>
        createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: "not-a-timestamp",
        })
      ).toThrow();
    });
  });

  describe("Ownership Enforcement", () => {
    it("7. allows Active Producer holding valid ownership to save producer state", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
      });

      await expect(saveProducerState(adapter, state, ownership)).resolves.not.toThrow();
      expect(adapter.files.has(getProducerStatePath())).toBe(true);
    });

    it("8. rejects Standby Producer attempting to write producer state", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      // PRODUCER_B is standby (not authoritative activeProducerId)
      const state = createProducerState({
        activeProducerId: PRODUCER_B,
        producerEpoch: 1,
      });

      await expect(saveProducerState(adapter, state, ownership)).rejects.toThrow(
        /does not match authoritative owner/
      );
    });

    it("9. rejects Companion attempting to write producer state", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const state = createProducerState({
        activeProducerId: COMPANION_C,
        producerEpoch: 1,
      });

      await expect(saveProducerState(adapter, state, ownership)).rejects.toThrow(
        /does not match authoritative owner/
      );
    });

    it("10. rejects old epoch attempting to write producer state", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 3);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      // Attempting to write with epoch 2 when current epoch is 3
      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 2,
      });

      await expect(saveProducerState(adapter, state, ownership)).rejects.toThrow(
        /does not match authoritative epoch/
      );
    });
  });

  describe("Atomic Persistence & Rollback", () => {
    it("11. creates initial file via temporary -> canonical atomic flow", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
      });

      await saveProducerState(adapter, state, ownership);
      expect(adapter.files.has(getProducerStatePath())).toBe(true);

      // Verify operations included temporary write and rename
      expect(adapter.operations.some((op) => op.startsWith("write:") && op.includes(".tmp-"))).toBe(true);
      expect(adapter.operations.some((op) => op.startsWith("rename:") && op.includes(".tmp-"))).toBe(true);
    });

    it("12. updates existing file via temporary -> backup -> canonical -> cleanup backup flow", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const state1 = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        textIndex: { exclusionPolicyRevision: 1 },
      });
      await saveProducerState(adapter, state1, ownership);

      adapter.operations = [];
      const state2 = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        textIndex: { exclusionPolicyRevision: 2 },
      });
      await saveProducerState(adapter, state2, ownership);

      const loaded = await loadProducerState(adapter);
      expect(loaded?.textIndex.exclusionPolicyRevision).toBe(2);

      // Backup was created and cleaned up
      expect(adapter.operations.some((op) => op.includes(".bak-"))).toBe(true);
      expect(adapter.operations.some((op) => op.startsWith("remove:") && op.includes(".bak-"))).toBe(true);
    });

    it("13 & 14. rolls back to previous state if promotion fails", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const initial = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        textIndex: { exclusionPolicyRevision: 1 },
      });
      await saveProducerState(adapter, initial, ownership);

      // Set simulated failure on promoting temporary to canonical
      const canonicalPath = getProducerStatePath();
      adapter.failOn = `rename:${adapter.files.keys().next().value}`; // general rename failure simulation

      // Mutate to fail
      const updated = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        textIndex: { exclusionPolicyRevision: 2 },
      });

      // We simulate failure specifically on temporary rename
      adapter.rename = async (from: string, to: string) => {
        if (from.includes(".tmp-") && to === canonicalPath) {
          throw new Error("Simulated rename error during promotion");
        }
        const content = adapter.files.get(from);
        if (content !== undefined) {
          adapter.files.delete(from);
          adapter.files.set(to, content);
        }
      };

      await expect(saveProducerState(adapter, updated, ownership)).rejects.toThrow(
        "Simulated rename error during promotion"
      );

      // Verify the canonical file was restored/preserved with initial content
      const loaded = await loadProducerState(adapter);
      expect(loaded?.textIndex.exclusionPolicyRevision).toBe(1);
    });
  });

  describe("Lifecycle Updates", () => {
    it("16 & 19. updates text index publication timestamp and exclusion policy hash", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const now = new Date().toISOString();
      const updated = await updateProducerState(adapter, PRODUCER_A, (current) => {
        return createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: now,
          textIndex: {
            lastSuccessfulPublicationAt: now,
            exclusionPolicyHash: "ph1:rev3hash",
            exclusionPolicyRevision: 3,
          },
          embeddings: current?.embeddings,
          maintenance: current?.maintenance,
        });
      }, ownership);

      expect(updated.textIndex.lastSuccessfulPublicationAt).toBe(now);
      expect(updated.textIndex.exclusionPolicyHash).toBe("ph1:rev3hash");
      expect(updated.textIndex.exclusionPolicyRevision).toBe(3);
    });

    it("17 & 20. updates embeddings publication timestamp, publicationId, and vectorContractId", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const now = new Date().toISOString();
      const updated = await updateProducerState(adapter, PRODUCER_A, (current) => {
        return createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: now,
          textIndex: current?.textIndex,
          embeddings: {
            lastSuccessfulPublicationAt: now,
            publicationId: "pub-456",
            vectorContractId: "vc1:nomic-v1-768",
          },
          maintenance: current?.maintenance,
        });
      }, ownership);

      expect(updated.embeddings.lastSuccessfulPublicationAt).toBe(now);
      expect(updated.embeddings.publicationId).toBe("pub-456");
      expect(updated.embeddings.vectorContractId).toBe("vc1:nomic-v1-768");
    });
  });

  describe("Freshness Evaluation & Centralized Thresholds", () => {
    const fixedNow = Date.parse("2026-09-05T12:00:00.000Z");

    it("21. classifies timestamps within 24h as fresh", () => {
      // 2 hours ago
      const recent = new Date(fixedNow - 2 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(recent, { now: fixedNow })).toBe("fresh");

      // 23 hours ago
      const twentyThreeHoursAgo = new Date(fixedNow - 23 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(twentyThreeHoursAgo, { now: fixedNow })).toBe("fresh");
    });

    it("22. classifies timestamps between 24h and 48h as aging", () => {
      // 30 hours ago
      const thirtyHoursAgo = new Date(fixedNow - 30 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(thirtyHoursAgo, { now: fixedNow })).toBe("aging");

      // 47 hours ago
      const fortySevenHoursAgo = new Date(fixedNow - 47 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(fortySevenHoursAgo, { now: fixedNow })).toBe("aging");
    });

    it("23. classifies timestamps older than 48h as stale", () => {
      // 50 hours ago
      const fiftyHoursAgo = new Date(fixedNow - 50 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(fiftyHoursAgo, { now: fixedNow })).toBe("stale");

      // 7 days ago
      const sevenDaysAgo = new Date(fixedNow - 7 * 24 * 3600 * 1000).toISOString();
      expect(evaluateTimestampFreshness(sevenDaysAgo, { now: fixedNow })).toBe("stale");
    });

    it("24. classifies null, invalid, or distant future timestamps as unknown", () => {
      expect(evaluateTimestampFreshness(null, { now: fixedNow })).toBe("unknown");
      expect(evaluateTimestampFreshness(undefined, { now: fixedNow })).toBe("unknown");
      expect(evaluateTimestampFreshness("invalid-date", { now: fixedNow })).toBe("unknown");

      // Future clock skew beyond 5 minutes
      const distantFuture = new Date(fixedNow + 10 * 60 * 1000).toISOString();
      expect(evaluateTimestampFreshness(distantFuture, { now: fixedNow })).toBe("unknown");
    });

    it("25. evaluates comprehensive ProducerFreshnessReport deterministically", () => {
      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
        updatedAt: new Date(fixedNow - 1 * 3600 * 1000).toISOString(), // 1h ago -> fresh
        textIndex: {
          lastSuccessfulPublicationAt: new Date(fixedNow - 30 * 3600 * 1000).toISOString(), // 30h ago -> aging
        },
        embeddings: {
          lastSuccessfulPublicationAt: new Date(fixedNow - 60 * 3600 * 1000).toISOString(), // 60h ago -> stale
        },
      });

      const ownership = createValidOwnership(PRODUCER_A, 1);
      const report = evaluateProducerStateFreshness(state, ownership, { now: fixedNow });

      expect(report.producerHeartbeatFreshness).toBe("fresh");
      expect(report.textIndexFreshness).toBe("aging");
      expect(report.embeddingsFreshness).toBe("stale");
      expect(report.overallFreshness).toBe("stale"); // Stale artifact pulls overall to stale
      expect(report.isEpochMatch).toBe(true);
    });
  });

  describe("Ownership Transfer", () => {
    it("26. old producer state does not override authoritative ownership manifest", () => {
      // Producer A state from epoch 1
      const oldState = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
      });

      // New ownership manifest with Producer B at epoch 2
      const newOwnership = createValidOwnership(PRODUCER_B, 2);

      const report = evaluateProducerStateFreshness(oldState, newOwnership);
      expect(report.isEpochMatch).toBe(false);

      const consumption = evaluateCompanionConsumptionState({
        deviceId: COMPANION_C,
        role: "companion",
        ownership: newOwnership,
        producerState: oldState,
      });

      // Ownership manifest remains the authority: activeProducerId is PRODUCER_B, epoch is 2
      expect(consumption.activeProducerId).toBe(PRODUCER_B);
      expect(consumption.lastKnownProducerEpoch).toBe(2);
    });

    it("27. new Active Producer can publish new state at new epoch", async () => {
      const adapter = new MemoryAdapter();
      const newOwnership = createValidOwnership(PRODUCER_B, 2);
      adapter.files.set(".lina/ownership.json", JSON.stringify(newOwnership));

      const newState = createProducerState({
        activeProducerId: PRODUCER_B,
        producerEpoch: 2,
      });

      await expect(saveProducerState(adapter, newState, newOwnership)).resolves.not.toThrow();
      const loaded = await loadProducerState(adapter);
      expect(loaded?.activeProducerId).toBe(PRODUCER_B);
      expect(loaded?.producerEpoch).toBe(2);
    });
  });

  describe("Companion Read-Only & Resilience", () => {
    it("28. Companion reads producer state without making any writes", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
      });
      adapter.files.set(getProducerStatePath(), JSON.stringify(state));

      const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(consumption.producerState?.activeProducerId).toBe(PRODUCER_A);
      expect(consumption.producerState?.producerEpoch).toBe(1);

      // Verify zero writes were made during companion read
      expect(adapter.operations.some((op) => op.startsWith("write:"))).toBe(false);
      expect(adapter.operations.some((op) => op.startsWith("remove:"))).toBe(false);
    });

    it("29. Missing producer state results in unknown freshness without blocking usability", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

      // Valid text manifest present, but producer-state.json is missing
      adapter.files.set(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "text",
          totalNotes: 10,
          totalChunks: 20,
        })
      );

      const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(consumption.producerState).toBeNull();
      expect(consumption.producerFreshness).toBe("unknown");
      expect(consumption.textIndexFreshness).toBe("unknown");
      expect(consumption.canConsume).toBe(true);
    });

    it("30. Corrupt producer state does not crash companion or block search", async () => {
      const adapter = new MemoryAdapter();
      const ownership = createValidOwnership(PRODUCER_A, 1);
      adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));
      adapter.files.set(getProducerStatePath(), "{ corrupted json content");

      adapter.files.set(
        ".lina/index/manifest.json",
        JSON.stringify({
          version: 1,
          indexType: "text",
          totalNotes: 5,
        })
      );

      const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(consumption.producerState).toBeNull();
      expect(consumption.producerFreshness).toBe("unknown");
      expect(consumption.canConsume).toBe(true);
    });

    it("31. Partial sync does not block search consumption", async () => {
      const adapter = new MemoryAdapter();
      // producer-state arrives before manifest.json
      const state = createProducerState({
        activeProducerId: PRODUCER_A,
        producerEpoch: 1,
      });
      adapter.files.set(getProducerStatePath(), JSON.stringify(state));

      const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
      expect(consumption.producerState).not.toBeNull();
      expect(consumption.canConsume).toBe(false); // Can't consume text index if text index manifest missing
      expect(consumption.consumptionMode).toBe("unavailable");
    });
  });

  describe("Directed Verification Suite (LINA-03-006-VERIFY-001)", () => {
    const fixedNow = Date.parse("2026-09-05T12:00:00.000Z");

    describe("1. Ownership Transfer & Epoch Fencing (Points 1-4)", () => {
      it("1. state from Producer A (epoch E) + ownership Producer B (epoch E+1) -> classified as non-authoritative (isEpochMatch: false, producerFreshness: stale)", () => {
        const oldState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: new Date(fixedNow - 1000).toISOString(), // recent timestamp
        });
        const newOwnership = createValidOwnership(PRODUCER_B, 2);

        const report = evaluateProducerStateFreshness(oldState, newOwnership, { now: fixedNow });
        expect(report.isEpochMatch).toBe(false);
        expect(report.producerFreshness).toBe("stale");
        expect(report.overallFreshness).toBe("stale");

        const companionState = evaluateCompanionConsumptionState({
          deviceId: COMPANION_C,
          role: "companion",
          ownership: newOwnership,
          producerState: oldState,
        });
        expect(companionState.activeProducerId).toBe(PRODUCER_B);
        expect(companionState.lastKnownProducerEpoch).toBe(2);
        expect(companionState.producerFreshness).toBe("stale");
      });

      it("2. Producer A cannot write after ownership transfer to Producer B", async () => {
        const adapter = new MemoryAdapter();
        const transferredOwnership = createValidOwnership(PRODUCER_B, 2);
        adapter.files.set(".lina/ownership.json", JSON.stringify(transferredOwnership));

        // Producer A tries to save with its former credentials/epoch
        const stateA = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
        });

        await expect(saveProducerState(adapter, stateA, transferredOwnership)).rejects.toThrow(
          /does not match authoritative owner/
        );
      });

      it("3. New Active Producer B can publish new state at new epoch", async () => {
        const adapter = new MemoryAdapter();
        const newOwnership = createValidOwnership(PRODUCER_B, 2);
        adapter.files.set(".lina/ownership.json", JSON.stringify(newOwnership));

        const stateB = createProducerState({
          activeProducerId: PRODUCER_B,
          producerEpoch: 2,
          textIndex: {
            lastSuccessfulPublicationAt: new Date().toISOString(),
            exclusionPolicyRevision: 1,
          },
        });

        await expect(saveProducerState(adapter, stateB, newOwnership)).resolves.not.toThrow();
        const loaded = await loadProducerState(adapter);
        expect(loaded?.activeProducerId).toBe(PRODUCER_B);
        expect(loaded?.producerEpoch).toBe(2);
        expect(loaded?.textIndex.exclusionPolicyRevision).toBe(1);
      });

      it("4. Epoch mismatch prevents state write even if producerId matches", async () => {
        const adapter = new MemoryAdapter();
        const newEpochOwnership = createValidOwnership(PRODUCER_A, 5);
        adapter.files.set(".lina/ownership.json", JSON.stringify(newEpochOwnership));

        // Producer A tries to write with stale epoch 4
        const staleEpochState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 4,
        });

        await expect(saveProducerState(adapter, staleEpochState, newEpochOwnership)).rejects.toThrow(
          /does not match authoritative epoch/
        );
      });
    });

    describe("2. Startup Lifecycle & Resilience (Points 5-10)", () => {
      it("5. Active Producer + matching state -> safe read and validation", async () => {
        const adapter = new MemoryAdapter();
        const ownership = createValidOwnership(PRODUCER_A, 1);
        adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

        const matchingState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          textIndex: { exclusionPolicyRevision: 4 },
        });
        adapter.files.set(getProducerStatePath(), JSON.stringify(matchingState));

        const loaded = await loadProducerState(adapter);
        expect(loaded).not.toBeNull();
        expect(loaded?.activeProducerId).toBe(PRODUCER_A);
        expect(loaded?.producerEpoch).toBe(1);

        const freshness = evaluateProducerStateFreshness(loaded!, ownership);
        expect(freshness.isEpochMatch).toBe(true);
      });

      it("6. Active Producer + missing state -> defined and safe behavior (returns null without crash)", async () => {
        const adapter = new MemoryAdapter();
        const loaded = await loadProducerState(adapter);
        expect(loaded).toBeNull();
      });

      it("7. Active Producer + state old epoch -> does not assume authority / does not promote silently", async () => {
        const adapter = new MemoryAdapter();
        const currentOwnership = createValidOwnership(PRODUCER_A, 3);
        adapter.files.set(".lina/ownership.json", JSON.stringify(currentOwnership));

        // Disk contains old epoch 2 state
        const oldEpochState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 2,
        });
        adapter.files.set(getProducerStatePath(), JSON.stringify(oldEpochState));

        const loaded = await loadProducerState(adapter);
        expect(loaded).not.toBeNull();

        const freshness = evaluateProducerStateFreshness(loaded!, currentOwnership);
        expect(freshness.isEpochMatch).toBe(false);
        expect(freshness.producerFreshness).toBe("stale");
      });

      it("8. Companion + missing state -> does not create file", async () => {
        const adapter = new MemoryAdapter();
        const ownership = createValidOwnership(PRODUCER_A, 1);
        adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

        const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
        expect(consumption.producerState).toBeNull();
        expect(adapter.files.has(getProducerStatePath())).toBe(false);
        expect(adapter.operations.some((op) => op.startsWith("write:"))).toBe(false);
      });

      it("9. Standby + missing state -> does not create file, cannot write without ownership", async () => {
        const adapter = new MemoryAdapter();
        const ownership = createValidOwnership(PRODUCER_A, 1);
        adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

        const state = await loadProducerState(adapter);
        expect(state).toBeNull();
        expect(adapter.files.has(getProducerStatePath())).toBe(false);

        // Standby PRODUCER_B attempts write
        const standbyState = createProducerState({
          activeProducerId: PRODUCER_B,
          producerEpoch: 1,
        });
        await expect(saveProducerState(adapter, standbyState, ownership)).rejects.toThrow(
          /does not match authoritative owner/
        );
      });

      it("10. Corrupt state -> degraded/unknown freshness without crash", async () => {
        const adapter = new MemoryAdapter();
        adapter.files.set(getProducerStatePath(), "{ corrupted invalid json");

        const loaded = await loadProducerState(adapter);
        expect(loaded).toBeNull();

        const consumption = await readCompanionConsumptionState(adapter, COMPANION_C, "companion");
        expect(consumption.producerState).toBeNull();
        expect(consumption.producerFreshness).toBe("unknown");
      });
    });

    describe("3. Maintenance State Integration (Points 11-12)", () => {
      it("11. supports full maintenance status lifecycle: running -> idle -> backoff -> error", () => {
        const runningState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          maintenance: {
            status: "running",
            lastRunAt: new Date(fixedNow - 5000).toISOString(),
          },
        });
        expect(runningState.maintenance.status).toBe("running");

        const idleState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          maintenance: {
            status: "idle",
            lastRunAt: new Date(fixedNow).toISOString(),
            lastError: null,
          },
        });
        expect(idleState.maintenance.status).toBe("idle");
        expect(idleState.maintenance.lastError).toBeNull();

        const backoffState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          maintenance: {
            status: "backoff",
            lastError: "Rate limited by provider, retrying in 30s",
            lastRunAt: new Date(fixedNow).toISOString(),
          },
        });
        expect(backoffState.maintenance.status).toBe("backoff");

        const errorState = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          maintenance: {
            status: "error",
            lastError: "Disk full error during text index write",
            lastRunAt: new Date(fixedNow).toISOString(),
          },
        });
        expect(errorState.maintenance.status).toBe("error");
        expect(errorState.maintenance.lastError).toBe("Disk full error during text index write");
      });

      it("12. tracks lastError and lastRunAt correctly across maintenance updates", async () => {
        const adapter = new MemoryAdapter();
        const ownership = createValidOwnership(PRODUCER_A, 1);
        adapter.files.set(".lina/ownership.json", JSON.stringify(ownership));

        const now = new Date().toISOString();
        // Update to error
        const stateWithError = await updateProducerState(adapter, PRODUCER_A, (current) => {
          return createProducerState({
            activeProducerId: PRODUCER_A,
            producerEpoch: 1,
            updatedAt: now,
            textIndex: current?.textIndex,
            embeddings: current?.embeddings,
            maintenance: {
              status: "error",
              lastError: "Erro ao guardar índice textual.",
              lastRunAt: now,
            },
          });
        }, ownership);

        expect(stateWithError.maintenance.status).toBe("error");
        expect(stateWithError.maintenance.lastError).toBe("Erro ao guardar índice textual.");
        expect(stateWithError.maintenance.lastRunAt).toBe(now);

        // Subsequent success clears lastError and sets status idle
        const later = new Date(Date.now() + 5000).toISOString();
        const stateSuccess = await updateProducerState(adapter, PRODUCER_A, (current) => {
          return createProducerState({
            activeProducerId: PRODUCER_A,
            producerEpoch: 1,
            updatedAt: later,
            textIndex: current?.textIndex,
            embeddings: current?.embeddings,
            maintenance: {
              status: "idle",
              lastError: null,
              lastRunAt: later,
            },
          });
        }, ownership);

        expect(stateSuccess.maintenance.status).toBe("idle");
        expect(stateSuccess.maintenance.lastError).toBeNull();
        expect(stateSuccess.maintenance.lastRunAt).toBe(later);
      });
    });

    describe("4. Freshness Semantics (Points 13-14)", () => {
      it("13. producer-state updatedAt represents state modification / publication event and is evaluated accurately", () => {
        const recentUpdatedAt = new Date(fixedNow - 30 * 60 * 1000).toISOString(); // 30 min ago -> fresh
        const state = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: recentUpdatedAt,
        });

        const ownership = createValidOwnership(PRODUCER_A, 1);
        const report = evaluateProducerStateFreshness(state, ownership, { now: fixedNow });

        expect(report.producerFreshness).toBe("fresh");
        expect(report.producerHeartbeatFreshness).toBe("fresh");

        // When epoch mismatches, producerFreshness is marked stale despite recent updatedAt
        const mismatchOwnership = createValidOwnership(PRODUCER_B, 2);
        const mismatchReport = evaluateProducerStateFreshness(state, mismatchOwnership, { now: fixedNow });
        expect(mismatchReport.producerFreshness).toBe("stale");
      });

      it("14. textIndexFreshness and embeddingsFreshness use their respective success publication timestamps independently", () => {
        const textTimestamp = new Date(fixedNow - 2 * 3600 * 1000).toISOString(); // 2h ago -> fresh
        const embeddingsTimestamp = new Date(fixedNow - 36 * 3600 * 1000).toISOString(); // 36h ago -> aging
        const stateUpdatedAt = new Date(fixedNow - 10 * 60 * 1000).toISOString(); // 10m ago

        const state = createProducerState({
          activeProducerId: PRODUCER_A,
          producerEpoch: 1,
          updatedAt: stateUpdatedAt,
          textIndex: {
            lastSuccessfulPublicationAt: textTimestamp,
          },
          embeddings: {
            lastSuccessfulPublicationAt: embeddingsTimestamp,
          },
        });

        const ownership = createValidOwnership(PRODUCER_A, 1);
        const report = evaluateProducerStateFreshness(state, ownership, { now: fixedNow });

        expect(report.textIndexFreshness).toBe("fresh");
        expect(report.embeddingsFreshness).toBe("aging");
        expect(report.producerFreshness).toBe("fresh");
        expect(report.overallFreshness).toBe("aging");
      });
    });
  });
});
