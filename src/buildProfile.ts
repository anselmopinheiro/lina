/* global __LINA_BUILD_PROFILE__ -- injected by esbuild, with a safe test-runtime fallback below */

declare global {
  const __LINA_BUILD_PROFILE__: "dev" | "test";
}

/** Compile-time build profile. TEST may expose technical diagnostics; DEV is release-safe. */
export const BUILD_PROFILE: "dev" | "test" = typeof __LINA_BUILD_PROFILE__ === "string"
  ? __LINA_BUILD_PROFILE__
  : "dev";

export function isDevBuild(): boolean {
  return BUILD_PROFILE === "dev";
}

export function isTestBuild(): boolean {
  return BUILD_PROFILE === "test";
}
