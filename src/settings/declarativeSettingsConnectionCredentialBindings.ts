import type {
  DeclarativeSettingsLifecycleController,
  DeclarativeSettingsLifecycleDomain,
} from "./declarativeSettingsLifecycleController";
import type {
  CredentialAvailability,
  CredentialDomain,
  CredentialMutationPort,
  CredentialRef,
  CredentialStatusPort,
  SafeCredentialError,
} from "./pureCredentialModel";
import type {
  PureConnectionTestInput,
  PureConnectionTestResult,
} from "./pureSettingsAsyncActions";

export type ConnectionCredentialDomain = "analysis" | "embeddings";
export type ConnectionFeedbackStatus = "idle" | "pending" | "success" | "error";
export type CredentialFeedbackStatus = "absent" | "stored" | "saving" | "clearing" | "success" | "error";

export interface SafeConnectionConfiguration {
  provider: string;
  model: string;
  baseUrl: string;
  timeout: string;
  credentialAvailable: boolean;
}

export interface SafeConnectionFeedback {
  status: ConnectionFeedbackStatus;
  provider?: string;
  model?: string;
  baseUrl?: string;
  messageKey?: PureConnectionTestResult["messageKey"];
}

export interface SafeCredentialFeedback {
  status: CredentialFeedbackStatus;
  available: boolean;
  operation?: "save" | "clear";
  error?: SafeCredentialError;
}

export interface ConnectionCredentialBindingsState {
  readonly analysis: { connection: SafeConnectionFeedback; credential: SafeCredentialFeedback };
  readonly embeddings: { connection: SafeConnectionFeedback; credential: SafeCredentialFeedback };
}

export interface ConnectionCredentialBindingsOptions {
  lifecycle: DeclarativeSettingsLifecycleController;
  connectionPorts: {
    testAnalysisConnection(input: PureConnectionTestInput): Promise<PureConnectionTestResult>;
    testEmbeddingsConnection(input: PureConnectionTestInput): Promise<PureConnectionTestResult>;
  };
  credentialStatus: CredentialStatusPort;
  credentialMutations: CredentialMutationPort;
  getConnectionConfiguration(domain: ConnectionCredentialDomain): SafeConnectionConfiguration;
  getCredentialRef(domain: CredentialDomain): CredentialRef;
  confirmCredentialClear(domain: CredentialDomain): Promise<boolean>;
}

export interface ConnectionCredentialBindings {
  getState(): ConnectionCredentialBindingsState;
  runConnectionTest(domain: ConnectionCredentialDomain): Promise<boolean>;
  saveCredential(domain: CredentialDomain, draft: string, clearDraft: () => void): Promise<boolean>;
  clearCredential(domain: CredentialDomain): Promise<boolean>;
  registerCleanup(owner: string, id: string, cleanup: () => void): boolean;
  removeCleanup(owner: string, id: string): boolean;
  registerDraftCleanup(domain: CredentialDomain, id: string, cleanup: () => void): boolean;
  invalidateConnection(domain: ConnectionCredentialDomain): void;
  invalidateCredential(domain: CredentialDomain): void;
}

const lifecycleDomain = (domain: ConnectionCredentialDomain): DeclarativeSettingsLifecycleDomain => domain;
const credentialLifecycleDomain = (domain: CredentialDomain): DeclarativeSettingsLifecycleDomain =>
  domain === "analysis" ? "credentials-analysis" : "credentials-embeddings";
const emptyConnection = (): SafeConnectionFeedback => ({ status: "idle" });
const owner = (domain: CredentialDomain): string => `credentials-${domain}`;

export function createConnectionCredentialBindings(
  options: ConnectionCredentialBindingsOptions,
): ConnectionCredentialBindings {
  const connections: Record<ConnectionCredentialDomain, SafeConnectionFeedback> = {
    analysis: emptyConnection(),
    embeddings: emptyConnection(),
  };
  const credentials: Record<CredentialDomain, SafeCredentialFeedback> = {
    analysis: { status: "absent", available: false },
    embeddings: { status: "absent", available: false },
  };

  const availabilityFor = (domain: CredentialDomain, provider: string): CredentialAvailability =>
    options.credentialStatus.getAvailability(options.getCredentialRef(domain), provider as never);

  const synchronizeCredential = (domain: CredentialDomain): CredentialAvailability => {
    const configuration = options.getConnectionConfiguration(domain);
    const availability = availabilityFor(domain, configuration.provider);
    credentials[domain] = {
      status: availability.available ? "stored" : "absent",
      available: availability.available,
    };
    return availability;
  };

  const completeConnection = (
    domain: ConnectionCredentialDomain,
    token: ReturnType<DeclarativeSettingsLifecycleController["beginPending"]>,
    result: PureConnectionTestResult,
  ): boolean => {
    if (!token || !options.lifecycle.canApply(token)) return false;
    const configuration = options.getConnectionConfiguration(domain);
    connections[domain] = {
      status: result.outcome === "success" ? "success" : "error",
      provider: configuration.provider,
      model: configuration.model,
      baseUrl: configuration.baseUrl,
      messageKey: result.messageKey,
    };
    options.lifecycle.completePending(token, result.outcome === "success" ? "success" : "error");
    options.lifecycle.requestUpdate();
    return true;
  };

  synchronizeCredential("analysis");
  synchronizeCredential("embeddings");

  const invalidateConnection = (domain: ConnectionCredentialDomain): void => {
    options.lifecycle.invalidateDomain(lifecycleDomain(domain));
    connections[domain] = emptyConnection();
  };

  return {
    getState() {
      return {
        analysis: { connection: { ...connections.analysis }, credential: { ...credentials.analysis } },
        embeddings: { connection: { ...connections.embeddings }, credential: { ...credentials.embeddings } },
      };
    },
    async runConnectionTest(domain) {
      const token = options.lifecycle.beginPending(lifecycleDomain(domain));
      if (!token) return false;
      const configuration = options.getConnectionConfiguration(domain);
      connections[domain] = {
        status: "pending", provider: configuration.provider, model: configuration.model, baseUrl: configuration.baseUrl,
      };
      try {
        const input: PureConnectionTestInput = { ...configuration };
        const result = domain === "analysis"
          ? await options.connectionPorts.testAnalysisConnection(input)
          : await options.connectionPorts.testEmbeddingsConnection(input);
        return completeConnection(domain, token, result);
      } catch {
        return completeConnection(domain, token, { outcome: "failed", messageKey: "connection-failed" });
      }
    },
    async saveCredential(domain, draft, clearDraft) {
      if (!draft.trim()) return false;
      const token = options.lifecycle.beginPending(credentialLifecycleDomain(domain));
      if (!token) return false;
      credentials[domain] = { ...credentials[domain], status: "saving", operation: "save" };
      options.lifecycle.requestUpdate();
      const configuration = options.getConnectionConfiguration(domain);
      try {
        const result = await options.credentialMutations.save(options.getCredentialRef(domain), draft, configuration.provider as never);
        if (!options.lifecycle.canApply(token)) return false;
        if (result.ok) {
          clearDraft();
          credentials[domain] = { status: "success", available: result.available, operation: "save" };
          invalidateConnection(domain);
          options.lifecycle.completePending(token, "success");
          options.lifecycle.requestUpdate();
          return true;
        }
        credentials[domain] = { status: "error", available: credentials[domain].available, operation: "save", error: result.error };
        options.lifecycle.completePending(token, "error");
        options.lifecycle.requestUpdate();
        return false;
      } catch {
        if (!options.lifecycle.canApply(token)) return false;
        credentials[domain] = { status: "error", available: credentials[domain].available, operation: "save", error: "save-failed" };
        options.lifecycle.completePending(token, "error");
        options.lifecycle.requestUpdate();
        return false;
      }
    },
    async clearCredential(domain) {
      if (!await options.confirmCredentialClear(domain)) return false;
      const token = options.lifecycle.beginPending(credentialLifecycleDomain(domain));
      if (!token) return false;
      credentials[domain] = { ...credentials[domain], status: "clearing", operation: "clear" };
      options.lifecycle.requestUpdate();
      const configuration = options.getConnectionConfiguration(domain);
      try {
        const result = await options.credentialMutations.clear(options.getCredentialRef(domain), configuration.provider as never);
        if (!options.lifecycle.canApply(token)) return false;
        if (result.ok) {
          credentials[domain] = { status: "success", available: result.available, operation: "clear" };
          invalidateConnection(domain);
          options.lifecycle.completePending(token, "success");
          options.lifecycle.requestUpdate();
          return true;
        }
        credentials[domain] = { status: "error", available: credentials[domain].available, operation: "clear", error: result.error };
        options.lifecycle.completePending(token, "error");
        options.lifecycle.requestUpdate();
        return false;
      } catch {
        if (!options.lifecycle.canApply(token)) return false;
        credentials[domain] = { status: "error", available: credentials[domain].available, operation: "clear", error: "clear-failed" };
        options.lifecycle.completePending(token, "error");
        options.lifecycle.requestUpdate();
        return false;
      }
    },
    registerCleanup(cleanupOwner, id, cleanup) {
      return options.lifecycle.registerCleanup(cleanupOwner, id, cleanup);
    },
    removeCleanup(cleanupOwner, id) {
      return options.lifecycle.removeCleanup(cleanupOwner, id);
    },
    registerDraftCleanup(domain, id, cleanup) {
      return options.lifecycle.registerCleanup(owner(domain), id, cleanup);
    },
    invalidateConnection,
    invalidateCredential(domain) {
      options.lifecycle.invalidateDomain(credentialLifecycleDomain(domain));
      synchronizeCredential(domain);
      invalidateConnection(domain);
    },
  };
}
