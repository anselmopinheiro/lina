/**
 * Shared ownership write fence for index persistence. It is the same abstraction
 * introduced for embeddings in LINA-15A: callers capture `{deviceId, epoch}` when
 * acquiring it and every durable mutation re-validates it. Persistence owns no
 * second authority model.
 */
export interface IndexWriteFence {
  assertCurrent(): Promise<boolean>;
  /** Authority captured when the fence was acquired; used only to stamp provenance. */
  readonly identity?: { readonly producerDeviceId: string; readonly epoch: number };
}

export class OwnershipFenceRejectedError extends Error {}

export async function assertIndexWriteFence(fence: IndexWriteFence | undefined): Promise<void> {
  if (fence && !await fence.assertCurrent()) {
    throw new OwnershipFenceRejectedError("Ownership fence rejected the index write.");
  }
}

const MUTATING_ADAPTER_METHODS = new Set(["write", "writeBinary", "remove", "rename", "mkdir"]);

/**
 * Returns an `App` whose adapter re-validates the fence before every mutating call.
 * Reads are bound to the original adapter so DataAdapter implementations keep working.
 */
export function withFencedAdapter<T extends { vault: { adapter: object } }>(
  app: T,
  fence: IndexWriteFence | undefined,
  onMutation?: () => void,
): T {
  if (!fence) return app;
  const original = app.vault.adapter;
  const guardedAdapter = new Proxy(original, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (MUTATING_ADAPTER_METHODS.has(String(key))) {
        return async (...args: unknown[]) => {
          await assertIndexWriteFence(fence);
          const result: unknown = await Reflect.apply(value, target, args);
          onMutation?.();
          return result;
        };
      }
      return value.bind(target) as unknown;
    },
  });
  const guardedVault = new Proxy(app.vault, { get: (target, key) => key === "adapter" ? guardedAdapter : Reflect.get(target, key) as unknown });
  return new Proxy(app, { get: (target, key) => key === "vault" ? guardedVault : Reflect.get(target, key) as unknown });
}
