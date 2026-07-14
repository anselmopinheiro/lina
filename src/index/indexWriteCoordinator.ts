export type IndexWriteOperationKind = "text-rebuild" | "text-automatic-batch" | "embedding-generation";

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

    if (this.state.activeOperation === "text-rebuild") {
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

    if (this.state.activeOperation === "text-rebuild" || this.state.activeOperation === "text-automatic-batch") {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token: IndexWriteCoordinatorToken = {
      kind: "embedding-generation",
      startedAt,
    };

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

  startTextRebuild(): IndexWriteCoordinatorResult {
    if (this.state.disposed) {
      return {
        status: "disposed",
        state: this.getState(),
      };
    }

    if (this.state.embeddingGenerationRequested || this.state.activeOperation === "embedding-generation") {
      return {
        status: "embedding-generation-active",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token: IndexWriteCoordinatorToken = {
      kind: "text-rebuild",
      startedAt,
    };

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

    const embeddingBlocksBatch = this.state.activeOperation === "embedding-generation"
      || (this.state.embeddingGenerationRequested && !options?.allowEmbeddingReservation);
    if (embeddingBlocksBatch) {
      return {
        status: "embedding-generation-active",
        state: this.getState(),
      };
    }

    if (this.state.activeOperation === "text-rebuild") {
      return {
        status: "text-index-busy",
        state: this.getState(),
      };
    }

    const startedAt = new Date().toISOString();
    const token: IndexWriteCoordinatorToken = {
      kind: "text-automatic-batch",
      startedAt,
    };

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

    if (this.state.activeOperation !== token.kind || this.state.activeStartedAt !== token.startedAt) {
      return;
    }

    this.state = {
      activeOperation: null,
      activeStartedAt: null,
      embeddingGenerationRequested: token.kind === "embedding-generation" ? false : this.state.embeddingGenerationRequested,
      disposed: this.state.disposed,
    };
  }
}
