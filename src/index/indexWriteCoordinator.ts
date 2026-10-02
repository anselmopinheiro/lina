export type IndexWriteOperationKind = "text-rebuild" | "text-automatic-batch" | "embedding-generation" | "binary-maintenance" | "canonical-maintenance";

export interface IndexWriteCoordinatorState {
  activeOperation: IndexWriteOperationKind | null;
  activeStartedAt: string | null;
  embeddingGenerationRequested: boolean;
  disposed: boolean;
}

interface AcceptedCoordinatorResult {
  status: "accepted";
  state: IndexWriteCoordinatorState;
  token?: IndexWriteCoordinatorToken;
}

interface RejectedCoordinatorResult {
  status: "disposed" | "text-index-busy" | "embedding-generation-active";
  state: IndexWriteCoordinatorState;
}

export type IndexWriteCoordinatorResult = AcceptedCoordinatorResult | RejectedCoordinatorResult;

export interface StartAutomaticBatchOptions {
  allowEmbeddingReservation?: boolean;
}

export interface IndexWriteCoordinatorToken {
  kind: IndexWriteOperationKind;
  startedAt: string;
  /** Unique per started operation; `finish` only releases the operation that owns it. */
  id: number;
}

let nextTokenId = 1;

function createToken(kind: IndexWriteOperationKind, startedAt: string): IndexWriteCoordinatorToken {
  return { kind, startedAt, id: nextTokenId++ };
}

function createIdleState(): IndexWriteCoordinatorState {
  return {
    activeOperation: null,
    activeStartedAt: null,
    embeddingGenerationRequested: false,
    disposed: false,
  };
}

export class IndexWriteCoordinator {
  private state: IndexWriteCoordinatorState = createIdleState();
  private activeTokenId: number | null = null;

  getState(): IndexWriteCoordinatorState {
    return { ...this.state };
  }

  dispose(): void {
    this.state = {
      ...this.state,
      disposed: true,
    };
  }

  requestEmbeddingGenerationPreparation(): IndexWriteCoordinatorResult {
    if (this.state.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    if (this.state.activeOperation === "text-rebuild" || this.state.activeOperation === "canonical-maintenance") {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    this.state = {
      ...this.state,
      embeddingGenerationRequested: true,
    };

    return {
      status: "accepted",
      state: this.getState(),
    };
  }

  cancelEmbeddingGenerationPreparation(): void {
    if (this.state.activeOperation === "embedding-generation") {
      return;
    }

    this.state = {
      ...this.state,
      embeddingGenerationRequested: false,
    };
  }

  startEmbeddingGeneration(): IndexWriteCoordinatorResult {
    if (this.state.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    if (this.state.activeOperation !== null) {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token = createToken("embedding-generation", startedAt);
    this.activeTokenId = token.id;

    this.state = {
      activeOperation: token.kind,
      activeStartedAt: startedAt,
      embeddingGenerationRequested: true,
      disposed: false,
    };

    return {
      status: "accepted",
      state: this.getState(),
      token,
    };
  }

  /** Uses the canonical index writer exclusion after its JSONL lease is released. */
  startBinaryMaintenance(): IndexWriteCoordinatorResult {
    if (this.state.disposed) return { status: "disposed", state: this.getState() };
    if (this.state.activeOperation !== null || this.state.embeddingGenerationRequested) {
      return {
        status: this.state.activeOperation?.startsWith("text-") || this.state.activeOperation === "canonical-maintenance" ? "text-index-busy" : "embedding-generation-active",
        state: this.getState(),
      };
    }
    const startedAt = new Date().toISOString();
    const token = createToken("binary-maintenance", startedAt);
    this.activeTokenId = token.id;
    this.state = { ...this.state, activeOperation: token.kind, activeStartedAt: startedAt };
    return { status: "accepted", state: this.getState(), token };
  }

  /**
   * Exclusive lease for destructive canonical maintenance (purge). It covers the
   * whole read-validate-publish cycle, so it is refused while any other writer
   * (including a pending generation reservation) is active, and it blocks all of them.
   */
  startCanonicalMaintenance(): IndexWriteCoordinatorResult {
    if (this.state.disposed) return { status: "disposed", state: this.getState() };
    if (this.state.activeOperation !== null || this.state.embeddingGenerationRequested) {
      return { status: "text-index-busy", state: this.getState() };
    }
    const startedAt = new Date().toISOString();
    const token = createToken("canonical-maintenance", startedAt);
    this.activeTokenId = token.id;
    this.state = { ...this.state, activeOperation: token.kind, activeStartedAt: startedAt };
    return { status: "accepted", state: this.getState(), token };
  }

  startTextRebuild(): IndexWriteCoordinatorResult {
    if (this.state.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    if (this.state.embeddingGenerationRequested || this.state.activeOperation === "embedding-generation" || this.state.activeOperation === "binary-maintenance") {
      return {
        status: "embedding-generation-active",
        state: this.getState(),
      };
    }

    // Any other active writer (automatic batch, another rebuild, canonical
    // maintenance) is incompatible with a rebuild of the shared manifest.
    if (this.state.activeOperation !== null) {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token = createToken("text-rebuild", startedAt);
    this.activeTokenId = token.id;

    this.state = {
      ...this.state,
      activeOperation: token.kind,
      activeStartedAt: startedAt,
    };

    return {
      status: "accepted",
      state: this.getState(),
      token,
    };
  }

  startAutomaticBatch(options?: StartAutomaticBatchOptions): IndexWriteCoordinatorResult {
    if (this.state.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    const embeddingBlocksBatch = this.state.activeOperation === "embedding-generation" || this.state.activeOperation === "binary-maintenance"
      || (this.state.embeddingGenerationRequested && !options?.allowEmbeddingReservation);
    if (embeddingBlocksBatch) {
      return {
        status: "embedding-generation-active",
        state: this.getState(),
      };
    }

    // Text rebuild, another automatic batch and canonical maintenance all write
    // the shared manifest: a single automatic batch may run at a time.
    if (this.state.activeOperation !== null) {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token = createToken("text-automatic-batch", startedAt);
    this.activeTokenId = token.id;

    this.state = {
      ...this.state,
      activeOperation: token.kind,
      activeStartedAt: startedAt,
    };

    return {
      status: "accepted",
      state: this.getState(),
      token,
    };
  }

  finish(token: IndexWriteCoordinatorToken | null | undefined): void {
    if (!token) {
      return;
    }

    if (this.activeTokenId !== token.id || this.state.activeOperation !== token.kind) {
      return;
    }

    this.activeTokenId = null;
    this.state = {
      activeOperation: null,
      activeStartedAt: null,
      embeddingGenerationRequested: token.kind === "embedding-generation" ? false : this.state.embeddingGenerationRequested,
      disposed: this.state.disposed,
    };
  }
}
