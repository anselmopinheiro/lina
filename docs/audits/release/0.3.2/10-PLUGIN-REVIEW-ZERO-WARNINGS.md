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

## Result

Zero project-controlled CSS warnings remain. Vault enumeration and clipboard findings are functional, user-controlled recommendations. Final release promotion remains blocked until the changed artifacts are validated, committed, pushed and released through the attesting workflow.
