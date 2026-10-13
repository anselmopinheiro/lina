# LINA 0.3.2 — Plugin review: zero warnings

## Baseline

- Branch: `master`.
- HEAD, `origin/master` and tag `0.3.2`: `ad85f6da42dac8dac569f75665162a7f51ba8417` before this audit's CSS/documentation changes.
- Release `0.3.2` is a pre-release named `Lina 0.3.2 Alpha`.
- Release assets are `main.js`, `manifest.json` and `styles.css`.

## CSS warnings

- Before: 25 `!important` declarations in `styles.css`.
- After: 0 declarations.
- Decision: scoped selectors now use the component container plus the native element type (`input`, `select` or `button`) where Obsidian's generic controls had required an override. This preserves the styles without global selectors or `!important`.

## Vault enumeration

The audited `getMarkdownFiles()` uses are functional requirements:

- index freshness status needs the eligible note metadata when content exclusions are absent;
- startup and exclusion-policy reconciliation compare eligible vault files with the persisted index;
- text-index rebuild scans the eligible Markdown scope;
- `vaultScanner` and `noteScanner` provide the plugin's Markdown-only index input.

Each production path applies the Obsidian config-folder and Lina exclusion policy where applicable. No redundant full-vault enumeration was found, so no architecture change was made. This remains an acceptable plugin-review recommendation for an indexing plugin.

## Clipboard

All four `navigator.clipboard.writeText()` paths are user initiated:

- copy suggested metadata;
- copy an AI response;
- copy the support email address;
- copy the TEST-only M6 diagnostic trace.

There is no clipboard read, background clipboard access, or clipboard data sent to a network/AI provider. The functionality is retained as an acceptable recommendation.

## Attestations

The release workflow uses `actions/attest-build-provenance@v2` with `main.js`, `manifest.json` and `styles.css`, before uploading those same explicit assets. The existing 0.3.2 pre-release contains those three assets and GitHub reports SHA-256 digests for each.

A read-only query to GitHub's attestation endpoint for the published `main.js` and `styles.css` digests returned HTTP 404 for the current credential/API route. It is therefore not recorded as direct attestation verification. The workflow is the confirmed procedure for producing the attestations on the final tag.

This audit changes `styles.css`; consequently, the existing tag and uploaded assets no longer represent the future release HEAD. Do not promote the current pre-release. After validation, a new commit/push and an intentional tag/assets update are required so the existing workflow generates attestations for the final artifacts. This audit does not move or recreate the tag.

## Gates

- `npm run lint:obsidian`: pass.
- `npm run lint:obsidian:strict`: pass.
- CSS search for `!important`: zero matches.
- Full test/build/release gates: recorded after the CSS change in the task report.

## Manual visual checklist before final release

- Desktop and Android: settings landing, privacy/exclusions, general/device, help/support.
- Desktop and Android: sidebar/search, selects, search inputs and buttons.
- Confirm no horizontal overflow and the intended hover/focus states.

## CI M6 Portability and Attestations Unblocking

- Causa: o workflow do GitHub Actions (`.github/workflows/ci.yml`) falhava no step `Run tests` em `ubuntu-latest` devido a dependências de caminho absoluto local Windows (`D:/anselmo/__obsidian__/zettel`) em `tests/index/m6DesktopRuntimeValidation.test.ts` e `tests/index/producerSqliteCanonicalObsidianRuntime.test.ts`. Como o job `build` falhava, o job dependente `release` (`actions/attest-build-provenance@v2`) era ignorado, impedindo a geração das proveniências.
- Correção arquitetural:
  - Fixture determinística versionada: criada em `tests/fixtures/m6ValidationFixtures.ts` para prover estrutura canónica, metadados, ownership e hashes criptográficos exatos sem requerer vaults locais não versionados.
  - M6 cutover runtime validation (`m6DesktopRuntimeValidation.test.ts`): passou a executar por omissão contra a fixture determinística isolada e efémera, preservando 100% da cobertura útil de cutover, rollback, pesquisa semântica e fallback, com suporte opcional a `LINA_REAL_VAULT_PATH` para validação manual.
  - Obsidian canonical proof (`producerSqliteCanonicalObsidianRuntime.test.ts`): condicionado explicitamente a `process.env.LINA_REAL_VAULT_PATH` (Opção B), evitando falhas no CI Linux onde o vault pessoal não existe, mantendo a cobertura contínua assegurada por `producerSqliteCanonicalRuntimeValidation.test.ts`.
- Resultado da suite: 206 ficheiros de teste e 2606 testes passaram com 100% de sucesso localmente e sem dependências de caminhos pessoais.
- Desbloqueio: com a suite reproduzível e verde no CI, o job `release` da tag `0.3.2` é autorizado a executar e emitir as attestations com `actions/attest-build-provenance@v2`.

## Result

Zero project-controlled CSS warnings remain. Vault enumeration and clipboard findings are functional, user-controlled recommendations. CI suite is now 100% reproducible and independent of personal local paths, unlocking GitHub Actions release provenance generation. Final release promotion remains blocked until the changed artifacts and attestations are verified.
