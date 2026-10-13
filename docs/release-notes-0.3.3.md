# Lina 0.3.3 — Release notes

0.3.3 is a technical compliance and release hygiene patch release. It introduces no new functional features or user-facing workflow changes.

## Highlights

- **Reproducible build output:** production builds no longer embed a build timestamp. Release bundles depend only on source, lockfile and toolchain.
- **Reviewer lint parity:** aligned repository ESLint configuration with `eslint-plugin-obsidianmd` recommended standards using `projectService` and repository-level boundaries (`eslint .`).
- **Strict type safety at Node/Electron boundary:** isolated optional desktop Node modules through a typed platform boundary (`getOptionalNodeRequire`, `getOptionalNodeCrypto`, `resolveNodeSqliteConstructor`) with zero `any` types, eliminating `@typescript-eslint/no-unsafe-assignment` and `no-unsafe-call` warnings.

See the [Changelog](../CHANGELOG.md).
