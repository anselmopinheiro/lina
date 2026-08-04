export const PURE_SETTINGS_ASYNC_ACTION_IDS = [
  "test-analysis-connection", "test-embeddings-connection", "check-binary-copy", "create-or-update-binary-copy", "remove-binary-copy",
] as const;
export type PureSettingsAsyncActionId = typeof PURE_SETTINGS_ASYNC_ACTION_IDS[number];

export type PureAsyncActionState<Result> =
  | { status: "idle" }
  | { status: "awaiting-confirmation" }
  | { status: "pending" }
  | { status: "success"; result: Result }
  | { status: "error"; error: PureAsyncActionError };

export interface PureAsyncActionError { code: "connection-failed" | "binary-operation-failed"; messageKey: string; retryable: boolean; }
export interface PureConnectionResult { outcome: "success" | "failed"; messageKey: string; }
export interface PureBinaryResult {
  status: "disabled" | "absent" | "valid" | "outdated" | "incomplete" | "invalid" | "unsupported" | "error";
  reasonCode?: "legacy-manifest";
  recordCount?: number;
  dimensions?: number;
  byteLengthKiB?: number;
}

export type PureConnectionTestActionId = Extract<PureSettingsAsyncActionId, "test-analysis-connection" | "test-embeddings-connection">;
export type PureConnectionFeedbackMessageKey = "connection-success" | "connection-failed" | "analysis-api-key-missing" | "embeddings-api-key-missing" | "embedding-test-failed";
export type PureConnectionTestResult =
  | { outcome: "success"; messageKey: "connection-success" }
  | { outcome: "failed"; messageKey: Exclude<PureConnectionFeedbackMessageKey, "connection-success"> };
export type PureConnectionTestState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; result: PureConnectionTestResult }
  | { status: "error"; error: { code: "connection-failed"; messageKey: Exclude<PureConnectionFeedbackMessageKey, "connection-success">; retryable: true } };

export interface PureConnectionTestInput {
  provider: string;
  baseUrl: string;
  model: string;
  credentialAvailable: boolean;
  timeout: string;
}

export interface PureConnectionTestRuntimePorts {
  testAnalysisConnection(input: PureConnectionTestInput): Promise<PureConnectionTestResult>;
  testEmbeddingsConnection(input: PureConnectionTestInput): Promise<PureConnectionTestResult>;
  requestUpdate(): void;
}

export interface PureConnectionTestRuntime {
  getState(actionId: PureConnectionTestActionId): PureConnectionTestState;
  isDisabled(actionId: PureConnectionTestActionId): boolean;
  run(actionId: PureConnectionTestActionId, input: PureConnectionTestInput): Promise<void>;
}

export type PureAsyncActionEffect =
  | { type: "set-pending" }
  | { type: "set-success" }
  | { type: "set-error" }
  | { type: "clear-transient-result" }
  | { type: "request-settings-refresh" }
  | { type: "run-analysis-connection-test" }
  | { type: "run-embeddings-connection-test" }
  | { type: "check-binary-copy" }
  | { type: "create-or-update-binary-copy" }
  | { type: "remove-binary-copy" }
  | { type: "invalidate-runtime-embedding-index" }
  | { type: "open-removal-confirmation" };

export interface PureSettingsAsyncActionStrings {
  testConnection: string; testEmbeddingsConnection: string; testingConnection: string;
  connectionSuccess: string; connectionFailed: string; embeddingTestFailed: string;
  binaryCheck: string; binaryCreate: string; binaryRemove: string; binaryRemoveConfirm: string;
  binaryWorking: string; binarySuccess: string; binaryError: string;
}

export type PureConnectionTestFeedbackStrings = Pick<
  PureSettingsAsyncActionStrings,
  "testingConnection" | "connectionSuccess" | "connectionFailed" | "embeddingTestFailed"
> & {
  analysisApiKeyMissing: string;
  embeddingsApiKeyMissing: string;
};

export function normalizePureConnectionTestError(): Extract<PureConnectionTestState, { status: "error" }>["error"] {
  return { code: "connection-failed", messageKey: "connection-failed", retryable: true };
}

export function getPureConnectionTestFeedbackText(
  strings: PureConnectionTestFeedbackStrings,
  state: PureConnectionTestState,
): string {
  if (state.status === "idle") return "";
  if (state.status === "pending") return strings.testingConnection;

  const messageKey = state.status === "success" ? state.result.messageKey : state.error.messageKey;
  switch (messageKey) {
    case "connection-success": return strings.connectionSuccess;
    case "analysis-api-key-missing": return strings.analysisApiKeyMissing;
    case "embeddings-api-key-missing": return strings.embeddingsApiKeyMissing;
    case "embedding-test-failed": return strings.embeddingTestFailed;
    case "connection-failed": return strings.connectionFailed;
  }
}

export function createPureConnectionTestRuntime(ports: PureConnectionTestRuntimePorts): PureConnectionTestRuntime {
  const states: Record<PureConnectionTestActionId, PureConnectionTestState> = {
    "test-analysis-connection": { status: "idle" },
    "test-embeddings-connection": { status: "idle" },
  };

  const execute = (actionId: PureConnectionTestActionId, input: PureConnectionTestInput): Promise<PureConnectionTestResult> =>
    actionId === "test-analysis-connection"
      ? ports.testAnalysisConnection(input)
      : ports.testEmbeddingsConnection(input);

  return {
    getState(actionId) {
      return states[actionId];
    },
    isDisabled(actionId) {
      return states[actionId].status === "pending";
    },
    async run(actionId, input): Promise<void> {
      if (states[actionId].status === "pending") return;

      states[actionId] = { status: "pending" };
      ports.requestUpdate();
      try {
        const result = await execute(actionId, input);
        states[actionId] = result.outcome === "success"
          ? { status: "success", result }
          : { status: "error", error: { code: "connection-failed", messageKey: result.messageKey, retryable: true } };
      } catch {
        states[actionId] = { status: "error", error: normalizePureConnectionTestError() };
      }
      ports.requestUpdate();
    },
  };
}

export type PureBinaryStatus = "unchecked" | PureBinaryResult["status"];
export interface PureBinaryStatusState {
  status: PureBinaryStatus;
  reasonCode?: "legacy-manifest";
  recordCount?: number;
  dimensions?: number;
  byteLengthKiB?: number;
}
export type PureBinaryActionState =
  | { status: "idle" }
  | { status: "awaiting-confirmation"; actionId: "remove-binary-copy" }
  | { status: "pending"; actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy" }
  | { status: "success"; actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy" }
  | { status: "error"; actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy"; error: PureAsyncActionError };

export interface PureBinaryRuntimeInput {
  legacyManifest: boolean;
}

export interface PureBinaryConfirmationRequest {
  actionId: "remove-binary-copy";
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: true;
}

export interface PureBinaryRuntimePorts {
  checkBinaryCopy(input: PureBinaryRuntimeInput): Promise<PureBinaryResult>;
  createOrUpdateBinaryCopy(input: PureBinaryRuntimeInput): Promise<PureBinaryResult>;
  removeBinaryCopy(input: PureBinaryRuntimeInput): Promise<void>;
  requestConfirmation(request: PureBinaryConfirmationRequest): Promise<boolean>;
  requestUpdate(): void;
}

export interface PureBinaryRuntime {
  getActionState(): PureBinaryActionState;
  getStatusState(): PureBinaryStatusState;
  isDisabled(actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy", input: PureBinaryRuntimeInput): boolean;
  run(actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy", input: PureBinaryRuntimeInput): Promise<void>;
}

export type PureBinaryFeedbackStrings = Pick<
  PureSettingsAsyncActionStrings,
  "binaryWorking" | "binarySuccess" | "binaryError" | "binaryRemoveConfirm"
>;

export type PureBinaryStatusStrings = {
  copyState: string;
  notChecked: string;
  disabled: string;
  absent: string;
  valid: string;
  outdated: string;
  incomplete: string;
  invalid: string;
  unsupported: string;
  legacyManifest: string;
  error: string;
  records: string;
  dimensions: string;
};

export function normalizePureBinaryActionError(): PureAsyncActionError {
  return { code: "binary-operation-failed", messageKey: "binary-error", retryable: true };
}

export function getPureBinaryFeedbackText(strings: PureBinaryFeedbackStrings, state: PureBinaryActionState): string {
  switch (state.status) {
    case "idle": return "";
    case "awaiting-confirmation": return strings.binaryRemoveConfirm;
    case "pending": return strings.binaryWorking;
    case "success": return strings.binarySuccess;
    case "error": return strings.binaryError;
  }
}

export function getPureBinaryStatusText(strings: PureBinaryStatusStrings, state: PureBinaryStatusState): string {
  const label = state.reasonCode === "legacy-manifest"
    ? strings.legacyManifest
    : {
      unchecked: strings.notChecked,
      disabled: strings.disabled,
      absent: strings.absent,
      valid: strings.valid,
      outdated: strings.outdated,
      incomplete: strings.incomplete,
      invalid: strings.invalid,
      unsupported: strings.unsupported,
      error: strings.error,
    }[state.status];
  const details = state.recordCount === undefined
    ? ""
    : ` · ${state.recordCount} · ${state.dimensions ?? 0}D · ${state.byteLengthKiB ?? 0} KiB`;
  return `${strings.copyState}: ${label}${details}`;
}

export function createPureBinaryRuntime(
  ports: PureBinaryRuntimePorts,
  confirmation: PureBinaryConfirmationRequest,
): PureBinaryRuntime {
  let actionState: PureBinaryActionState = { status: "idle" };
  let statusState: PureBinaryStatusState = { status: "unchecked" };

  const operationInProgress = (): boolean => actionState.status === "awaiting-confirmation" || actionState.status === "pending";
  const applyResult = (result: PureBinaryResult): void => {
    statusState = {
      status: result.status,
      reasonCode: result.reasonCode,
      recordCount: result.recordCount,
      dimensions: result.dimensions,
      byteLengthKiB: result.byteLengthKiB,
    };
  };
  const isActionDisabled = (
    actionId: "check-binary-copy" | "create-or-update-binary-copy" | "remove-binary-copy",
    input: PureBinaryRuntimeInput,
  ): boolean => {
    const actionInput: PureBinaryActionInput = {
      operationInProgress: operationInProgress(),
      legacyManifest: input.legacyManifest || statusState.reasonCode === "legacy-manifest",
    };
    if (actionId === "check-binary-copy") return isPureBinaryCheckDisabled(actionInput);
    if (actionId === "create-or-update-binary-copy") return isPureBinaryCreateDisabled(actionInput);
    return isPureBinaryRemoveDisabled(actionInput);
  };

  return {
    getActionState() {
      return actionState;
    },
    getStatusState() {
      return statusState;
    },
    isDisabled: isActionDisabled,
    async run(actionId, input): Promise<void> {
      if (isActionDisabled(actionId, input)) return;

      if (actionId === "remove-binary-copy") {
        actionState = { status: "awaiting-confirmation", actionId };
        ports.requestUpdate();
        const confirmed = await ports.requestConfirmation(confirmation);
        if (!confirmed) {
          actionState = { status: "idle" };
          ports.requestUpdate();
          return;
        }
      }

      actionState = { status: "pending", actionId };
      ports.requestUpdate();
      try {
        if (actionId === "check-binary-copy") {
          const result = await ports.checkBinaryCopy(input);
          applyResult(result);
          actionState = result.status === "error"
            ? { status: "error", actionId, error: normalizePureBinaryActionError() }
            : { status: "success", actionId };
        } else if (actionId === "create-or-update-binary-copy") {
          const result = await ports.createOrUpdateBinaryCopy(input);
          applyResult(result);
          actionState = result.status === "error"
            ? { status: "error", actionId, error: normalizePureBinaryActionError() }
            : { status: "success", actionId };
        } else {
          await ports.removeBinaryCopy(input);
          statusState = { status: "absent" };
          actionState = { status: "success", actionId };
        }
      } catch {
        statusState = { status: "error" };
        actionState = { status: "error", actionId, error: normalizePureBinaryActionError() };
      }
      ports.requestUpdate();
    },
  };
}

export interface PureConnectionActionInput {
  provider: string; baseUrl: string; model: string; credentialAvailable: boolean; timeout: string; actionInProgress: boolean;
}
export interface PureBinaryActionInput { operationInProgress: boolean; legacyManifest: boolean; }

export function isPureConnectionActionDisabled(input: PureConnectionActionInput): boolean {
  return input.actionInProgress;
}
export function isPureBinaryCheckDisabled(input: PureBinaryActionInput): boolean { return input.operationInProgress; }
export function isPureBinaryCreateDisabled(input: PureBinaryActionInput): boolean { return input.operationInProgress || input.legacyManifest; }
export function isPureBinaryRemoveDisabled(input: PureBinaryActionInput): boolean { return input.operationInProgress; }

const feedback = (requiresAriaLive: boolean) => ({ supportsPending: true, supportsSuccess: true, supportsError: true, requiresAriaLive, ariaLivePoliteness: requiresAriaLive ? "polite" as const : undefined });

export function createPureSettingsAsyncActionDescriptors(
  strings: PureSettingsAsyncActionStrings,
  inputs: { analysis: PureConnectionActionInput; embeddings: PureConnectionActionInput; binary: PureBinaryActionInput }
) {
  return [
    {
      id: "test-analysis-connection" as const, domain: "analysis" as const, label: strings.testConnection,
      inputs: { provider: inputs.analysis.provider, baseUrl: inputs.analysis.baseUrl, model: inputs.analysis.model, credentialAvailable: inputs.analysis.credentialAvailable, timeout: inputs.analysis.timeout },
      disabled: isPureConnectionActionDisabled(inputs.analysis), confirmation: { required: false, destructive: false }, feedback: feedback(true),
      pendingMessage: strings.testingConnection, successMessage: strings.connectionSuccess, errorMessage: strings.connectionFailed,
      declaredEffects: [{ type: "set-pending" }, { type: "request-settings-refresh" }, { type: "run-analysis-connection-test" }, { type: "set-success" }, { type: "set-error" }, { type: "request-settings-refresh" }, { type: "clear-transient-result" }] satisfies PureAsyncActionEffect[],
      cleanupEffects: [{ type: "clear-transient-result" }] satisfies PureAsyncActionEffect[], requiresFutureRefresh: true,
    },
    {
      id: "test-embeddings-connection" as const, domain: "embedding" as const, label: strings.testEmbeddingsConnection,
      inputs: { provider: inputs.embeddings.provider, baseUrl: inputs.embeddings.baseUrl, model: inputs.embeddings.model, credentialAvailable: inputs.embeddings.credentialAvailable, timeout: inputs.embeddings.timeout },
      disabled: isPureConnectionActionDisabled(inputs.embeddings), confirmation: { required: false, destructive: false }, feedback: feedback(true),
      pendingMessage: strings.testingConnection, successMessage: strings.connectionSuccess, errorMessage: strings.embeddingTestFailed,
      declaredEffects: [{ type: "set-pending" }, { type: "request-settings-refresh" }, { type: "run-embeddings-connection-test" }, { type: "set-success" }, { type: "set-error" }, { type: "request-settings-refresh" }, { type: "clear-transient-result" }] satisfies PureAsyncActionEffect[],
      cleanupEffects: [{ type: "clear-transient-result" }] satisfies PureAsyncActionEffect[], requiresFutureRefresh: true,
    },
    {
      id: "check-binary-copy" as const, domain: "binary" as const, label: strings.binaryCheck, inputs: { ...inputs.binary },
      disabled: isPureBinaryCheckDisabled(inputs.binary), confirmation: { required: false, destructive: false }, feedback: feedback(true),
      pendingMessage: strings.binaryWorking, successMessage: strings.binarySuccess, errorMessage: strings.binaryError,
      declaredEffects: [{ type: "set-pending" }, { type: "check-binary-copy" }, { type: "set-success" }, { type: "set-error" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[],
      cleanupEffects: [{ type: "clear-transient-result" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[], requiresFutureRefresh: true,
    },
    {
      id: "create-or-update-binary-copy" as const, domain: "binary" as const, label: strings.binaryCreate, inputs: { ...inputs.binary },
      disabled: isPureBinaryCreateDisabled(inputs.binary), confirmation: { required: false, destructive: false }, feedback: feedback(true),
      pendingMessage: strings.binaryWorking, successMessage: strings.binarySuccess, errorMessage: strings.binaryError,
      declaredEffects: [{ type: "set-pending" }, { type: "create-or-update-binary-copy" }, { type: "invalidate-runtime-embedding-index" }, { type: "set-success" }, { type: "set-error" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[],
      cleanupEffects: [{ type: "clear-transient-result" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[], requiresFutureRefresh: true,
    },
    {
      id: "remove-binary-copy" as const, domain: "binary" as const, label: strings.binaryRemove, inputs: { ...inputs.binary },
      disabled: isPureBinaryRemoveDisabled(inputs.binary), confirmation: { required: true, message: strings.binaryRemoveConfirm, confirmLabel: strings.binaryRemove, cancelLabel: "cancel", destructive: true }, feedback: feedback(true),
      pendingMessage: strings.binaryWorking, successMessage: strings.binarySuccess, errorMessage: strings.binaryError,
      declaredEffects: [{ type: "open-removal-confirmation" }, { type: "set-pending" }, { type: "remove-binary-copy" }, { type: "invalidate-runtime-embedding-index" }, { type: "set-success" }, { type: "set-error" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[],
      cleanupEffects: [{ type: "clear-transient-result" }, { type: "request-settings-refresh" }] satisfies PureAsyncActionEffect[], requiresFutureRefresh: true,
    },
  ];
}
