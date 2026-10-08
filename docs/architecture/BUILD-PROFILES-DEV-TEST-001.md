# Build Profiles: DEV and TEST

The compile-time `BUILD_PROFILE` has two values: `dev` and `test`.

| Profile | Output | Local vault | M6 technical UI |
| --- | --- | --- | --- |
| DEV | `dist/dev/` | `D:\anselmo\__obsidian__\zettel\.obsidian\plugins\lina` | Absent |
| TEST | `dist/test/` | `D:\anselmo\__obsidian__\anselmo\.obsidian\plugins\lina` | Present |

`npm run build` creates the release-safe DEV build without copying to a vault.
`npm run build:dev` installs only `main.js`, `manifest.json`, and `styles.css`
from `dist/dev` into zettel. `npm run build:test` installs the same three files
from `dist/test` into anselmo.

The copy script rejects swapped vaults, invalid source/profile pairings, and
equal DEV/TEST destinations. TEST alone registers the temporary **Testes M6**
panel and command; all ownership, search, vector, publication and cache core
code remains identical between profiles. `release-check` is run against the
DEV/root release artifact and TEST UI is excluded from that bundle.
