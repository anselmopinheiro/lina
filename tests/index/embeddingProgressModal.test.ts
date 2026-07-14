import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { EmbeddingOperationState } from "../../src/index/embeddingOperationManager";
import { EmbeddingProgressModal } from "../../src/index/embeddingProgressModal";

function makeState(partial: Partial<EmbeddingOperationState>): EmbeddingOperationState {
  return {
    operationId: 1,
    origin: "command",
    status: "running",
    startedAt: "2026-07-14T00:00:00.000Z",
    finishedAt: null,
    message: null,
    error: null,
    phase: "generating",
    totalChunks: 10,
    processedChunks: 0,
    generatedChunks: 0,
    failedChunks: 0,
    reusedChunks: 0,
    percentage: 0,
    currentChunk: null,
    cancelRequestedAt: null,
    ...partial,
  };
}

function makeElementStub(initialText = ""): {
  textContent: string;
  value: number;
  max: number;
  addClass: (className: string) => void;
  createEl: (tag: string, options?: { text?: string }) => ReturnType<typeof makeElementStub>;
  createDiv: () => ReturnType<typeof makeElementStub>;
  empty: () => void;
} {
  return {
    textContent: initialText,
    value: 0,
    max: 0,
    addClass: vi.fn(),
    createEl: (_tag: string, options?: { text?: string }) => makeElementStub(options?.text ?? ""),
    createDiv: () => makeElementStub(),
    empty: vi.fn(),
  };
}

describe("embedding progress modal", () => {
  beforeEach(() => {
    Object.defineProperty(EmbeddingProgressModal.prototype, "setTitle", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("is a passive view of the central embedding operation state and unsubscribes on close", () => {
    let subscribedListener: ((state: EmbeddingOperationState) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: (state: EmbeddingOperationState) => void) => {
      subscribedListener = listener;
      listener(makeState({ processedChunks: 2, generatedChunks: 2, percentage: 20 }));
      return unsubscribe;
    });
    const modal = new EmbeddingProgressModal(new App(), subscribe);
    const contentEl = makeElementStub();
    modal.contentEl = contentEl as never;

    modal.onOpen();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribedListener).toBeDefined();

    subscribedListener?.(makeState({
      status: "cancelling",
      message: "Cancelling embedding generation...",
      processedChunks: 3,
      generatedChunks: 3,
      percentage: 30,
    }));

    modal.onClose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(contentEl.empty).toHaveBeenCalledTimes(1);
  });

  it("closing the modal does not call any cancellation callback", () => {
    const cancel = vi.fn();
    const modal = new EmbeddingProgressModal(new App(), () => () => {});
    modal.contentEl = makeElementStub() as never;

    modal.onOpen();
    modal.onClose();

    expect(cancel).not.toHaveBeenCalled();
  });
});
