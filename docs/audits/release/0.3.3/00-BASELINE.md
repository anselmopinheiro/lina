# LINA 0.3.3 — Auditoria pré-patch: baseline

**Data:** 2026-10-13 · **Âmbito:** Patch técnico 0.3.3 (compliance Obsidian, zero warnings e reprodutibilidade).

## 1. Estado inicial verificado

| Item | Esperado | Observado |
| --- | --- | --- |
| Diretório / git root | `d:\_dev\obsidian\lina` | `d:\_dev\obsidian\lina` |
| Branch | `master` | `master` |
| HEAD inicial | `a331daabf8944e5c356dc384002a53b780d0871f` | `a331daabf8944e5c356dc384002a53b780d0871f` |
| `origin/master` | == HEAD | `a331daabf8944e5c356dc384002a53b780d0871f` |
| Working tree inicial | limpo | limpo (`git status --short` vazio) |
| Versão repo inicial | `0.3.2` | `0.3.2` (`manifest.json`, `package.json`, `versions.json`) |
| Node.js / npm | Node v20 / npm v10 | Node `v20.19.6` / npm `10.8.2` |
| esbuild / TypeScript | `0.25.12` / `^5.4.5` | `esbuild@0.25.12` / `typescript@5.4.5` |

## 2. Release e assets de referência (0.3.2)

- Tag: `0.3.2`
- Commit: `a331daabf8944e5c356dc384002a53b780d0871f`
- Assets publicados na release 0.3.2:
  - `main.js` (sha256: `4f03e7aaa9c1b231034a532f8fef015dac3dece9c296aeccdec49fee73ddd537`)
  - `manifest.json` (sha256: `550d32aaa07a10698a0ddfd808577c720f6c123c67739754b8b6a5db2d142b9d`)
  - `styles.css` (sha256: `eb34096595482868b7207fa45a48963933c9992d3b19ac6da759f92d1d88e5e0`)

## 3. Problemas reportados na revisão Obsidian

1. **Aviso de integridade do build:**
   `Build output does not match the released main.js artifact`
2. **Avisos de tipagem estrita na revisão automatizada:**
   `@typescript-eslint/no-unsafe-assignment` e `@typescript-eslint/no-unsafe-call` em ficheiros que utilizam probing de módulos Node.js desktop (`main.ts`, `src/index/publishedGenerationBuilder.ts`, `src/index/publishedGenerationValidator.ts`, `src/index/sqliteProducerLocalStore.ts`).
3. **Divergência de configuração local vs reviewer:**
   `npm run lint:obsidian:strict` passava localmente sem expor os mesmos erros detetados pelo scanner da comunidade.

## 4. Metodologia da intervenção

- Alinhar com a referência canónica do ecossistema Obsidian (`obsidianmd/obsidian-sample-plugin` e `obsidianmd/eslint-plugin`).
- Identificar e eliminar a causa exata de não-determinismo no build sem quebrar compatibilidade.
- Tipar formalmente a fronteira de módulos Node.js desktop opcionais eliminando `any` e supressões `// eslint-disable-next-line no-undef`.
- Garantir que todos os gates locais e CI passam sem regressões.
