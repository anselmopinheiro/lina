import type { DeclarativeSettingsLifecycleController } from "./declarativeSettingsLifecycleController";
import type { PureBinaryResult, PureBinaryStatus } from "./pureSettingsAsyncActions";

export type DeclarativeBinaryAction = "check" | "create-or-update" | "remove";

export interface DeclarativeBinaryReadDiagnostic {
  configuredPreference: "jsonl" | "prefer-binary";
  effectiveSource: "binary" | "jsonl" | "not-loaded";
  fallbackReason: string;
}

export interface DeclarativeBinarySnapshot {
  status: PureBinaryStatus;
  reasonCode?: "legacy-manifest";
  recordCount?: number;
  dimensions?: number;
  byteLengthKiB?: number;
  pending: boolean;
  action?: DeclarativeBinaryAction;
  feedback: "idle" | "pending" | "success" | "error" | "blocked";
  canCheck: boolean;
  canCreateOrUpdate: boolean;
  canRemove: boolean;
  readDiagnostic: DeclarativeBinaryReadDiagnostic;
}

export interface DeclarativeSettingsBinaryBindingsOptions {
  lifecycle: DeclarativeSettingsLifecycleController;
  getCurrentStatus(): PureBinaryResult | undefined;
  check(): Promise<PureBinaryResult>;
  createOrUpdate(): Promise<PureBinaryResult>;
  remove(): Promise<void>;
  confirmRemove(): Promise<boolean>;
  getReadPreference(): "jsonl" | "prefer-binary";
  getMaintainBinaryCopy(): boolean;
  getReadDiagnostic?(): DeclarativeBinaryReadDiagnostic;
}

export interface DeclarativeSettingsBinaryBindings {
  getSnapshot(): DeclarativeBinarySnapshot;
  check(): Promise<boolean>;
  createOrUpdate(): Promise<boolean>;
  remove(): Promise<boolean>;
  invalidate(): void;
}

function toStatus(result: PureBinaryResult): Omit<DeclarativeBinarySnapshot, "pending" | "action" | "feedback" | "canCheck" | "canCreateOrUpdate" | "canRemove" | "readDiagnostic"> {
  return {
    status: result.status,
    reasonCode: result.reasonCode,
    recordCount: result.recordCount,
    dimensions: result.dimensions,
    byteLengthKiB: result.byteLengthKiB,
  };
}

export function createDeclarativeSettingsBinaryBindings(
  options: DeclarativeSettingsBinaryBindingsOptions,
): DeclarativeSettingsBinaryBindings {
  let state = options.getCurrentStatus() ? toStatus(options.getCurrentStatus()!) : { status: "unchecked" as const };
  let action: DeclarativeBinaryAction | undefined;
  let feedback: DeclarativeBinarySnapshot["feedback"] = "idle";

  const isPending = (): boolean => options.lifecycle.isPending("binary");
  const legacyBlocked = (): boolean => state.reasonCode === "legacy-manifest";
  const snapshot = (): DeclarativeBinarySnapshot => ({
    ...state,
    pending: isPending(),
    action,
    feedback,
    canCheck: !isPending(),
    canCreateOrUpdate: !isPending() && !legacyBlocked(),
    canRemove: !isPending(),
    readDiagnostic: options.getReadDiagnostic?.() ?? {
      configuredPreference: options.getReadPreference(),
      effectiveSource: "not-loaded",
      fallbackReason: "none",
    },
  });

  const run = async (nextAction: Exclude<DeclarativeBinaryAction, "remove">): Promise<boolean> => {
    if (nextAction === "create-or-update" && !snapshot().canCreateOrUpdate) {
      feedback = "blocked";
      options.lifecycle.requestUpdate();
      return false;
    }
    if (nextAction === "check" && !snapshot().canCheck) return false;
    const token = options.lifecycle.beginPending("binary");
    if (!token) return false;
    action = nextAction;
    feedback = "pending";
    try {
      const result = nextAction === "check" ? await options.check() : await options.createOrUpdate();
      if (!options.lifecycle.canApply(token)) return false;
      state = toStatus(result);
      feedback = result.status === "error" ? "error" : "success";
      options.lifecycle.completePending(token, result.status === "error" ? "error" : "success");
      action = undefined;
      options.lifecycle.requestUpdate();
      return result.status !== "error";
    } catch {
      if (!options.lifecycle.canApply(token)) return false;
      state = { status: "error" };
      feedback = "error";
      action = undefined;
      options.lifecycle.completePending(token, "error");
      options.lifecycle.requestUpdate();
      return false;
    }
  };

  return {
    getSnapshot: snapshot,
    check() { return run("check"); },
    createOrUpdate() { return run("create-or-update"); },
    async remove() {
      if (!snapshot().canRemove) return false;
      if (!await options.confirmRemove()) return false;
      const token = options.lifecycle.beginPending("binary");
      if (!token) return false;
      action = "remove";
      feedback = "pending";
      try {
        await options.remove();
        if (!options.lifecycle.canApply(token)) return false;
        state = { status: "absent" };
        feedback = "success";
        action = undefined;
        options.lifecycle.completePending(token, "success");
        options.lifecycle.requestUpdate();
        return true;
      } catch {
        if (!options.lifecycle.canApply(token)) return false;
        state = { status: "error" };
        feedback = "error";
        action = undefined;
        options.lifecycle.completePending(token, "error");
        options.lifecycle.requestUpdate();
        return false;
      }
    },
    invalidate() {
      options.lifecycle.invalidateDomain("binary");
      action = undefined;
      feedback = "idle";
    },
  };
}
