import { DeviceCapabilities } from "../capabilities/deviceCapabilities";
import { createPathScopedDebouncer, PathScopedDebouncer } from "../index/automaticUpdateEvents";

export type TextIndexVaultEvent = "create" | "modify" | "delete" | "rename";

export interface TextIndexWorkerOptions {
  readonly capabilities: DeviceCapabilities;
  readonly isAutomaticUpdateEnabled: () => boolean;
  readonly subscribeVaultEvent: (
    event: TextIndexVaultEvent,
    callback: (file: unknown, oldPath?: string) => void,
  ) => () => void;
  readonly onVaultEvent: (event: TextIndexVaultEvent, file: unknown, oldPath?: string) => void;
  readonly timers: {
    readonly setTimeout: (callback: () => void, delay: number) => number;
    readonly clearTimeout: (timeoutId: number) => void;
  };
}

/**
 * Owns the text-index ingestion lifecycle. Existing index algorithms remain
 * behind its injected callbacks during this first migration step.
 */
export class TextIndexWorker {
  private started = false;
  private listeners: Array<() => void> = [];
  private modifyDebouncer?: PathScopedDebouncer<() => void>;

  constructor(private readonly options: TextIndexWorkerOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  start(): void {
    this.stop();
    if (!this.options.capabilities.canWatchVaultEvents
      || !this.options.capabilities.canMaintainTextIndex
      || !this.options.isAutomaticUpdateEnabled()) {
      return;
    }

    for (const event of ["create", "modify", "delete", "rename"] as const) {
      this.listeners.push(this.options.subscribeVaultEvent(event, (file, oldPath) => {
        this.options.onVaultEvent(event, file, oldPath);
      }));
    }
    this.modifyDebouncer = createPathScopedDebouncer((run) => run(), 2000, this.options.timers);
    this.started = true;
  }

  scheduleModify(path: string, run: () => void): void {
    if (!this.started) {
      return;
    }
    this.modifyDebouncer?.schedule(path, run);
  }

  stop(): void {
    this.modifyDebouncer?.cancelAll();
    this.modifyDebouncer = undefined;
    for (const unsubscribe of this.listeners) {
      unsubscribe();
    }
    this.listeners = [];
    this.started = false;
  }

  dispose(): void {
    this.stop();
  }
}
