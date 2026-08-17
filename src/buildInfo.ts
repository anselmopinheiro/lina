declare const __LINA_BUILD_TIMESTAMP__: string | undefined;

/**
 * Compile-time build metadata. It is deliberately not part of LinaSettings
 * and therefore can never be written to a user's vault configuration.
 */
export const LINA_DEVELOPMENT_BUILD_TIMESTAMP = typeof __LINA_BUILD_TIMESTAMP__ === "string"
  ? __LINA_BUILD_TIMESTAMP__
  : "development source (bundle not built)";

export const LINA_GENERATED_BUNDLE_NAME = "main.js";
