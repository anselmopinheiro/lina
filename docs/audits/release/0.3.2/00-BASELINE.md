# LINA 0.3.2 — Auditoria pré-pre-release: baseline

**Data:** 2026-10-13 · **Âmbito:** auditoria modular + transversal, sem tag/release.

## Estado inicial verificado

| Item | Esperado | Observado |
| --- | --- | --- |
| Diretório / git root | `D:/_dev/obsidian/lina` | `D:/_dev/obsidian/lina` |
| Branch | `master` | `master` |
| HEAD | `357d7bd66f1d89afad18a74340e1445028552ebd` | idêntico |
| `origin/master` | == HEAD | idêntico |
| Working tree | limpa | limpa |
| `git diff --check` | limpo | limpo |
| Versão (`manifest`/`package`/`package-lock`/`versions`) | 0.3.2 | 0.3.2, `minAppVersion` 1.13.0, `isDesktopOnly: false` |

## Gates no baseline (antes de qualquer alteração)

| Gate | Resultado |
| --- | --- |
| `npm test` | 2603 passed / **1 failed** (206 ficheiros) — `tests/index/m6DesktopRuntimeValidation.test.ts:102` (`expected 2302 to be 2303`) |
| `npm run lint:obsidian` | 0 erros, 0 avisos |

## Convenção documental

`docs/audits/` usa subpastas por categoria (`architecture`, `release`, `sync`, `ux`, `documentation`). Os relatórios desta fase ficam em `docs/audits/release/0.3.2/`, mantendo os nomes numerados pedidos.

## Método

Leitura de `AGENTS.md`; inspeção do código-fonte relevante por módulo (sem exploração integral do repositório); confirmação do comportamento no código antes de o dar como documentado; correções mínimas apenas para P0/P1; sem chamadas externas, sem geração de embeddings, sem alterações a notas do vault.

## Limitações declaradas

- Não foi executada validação runtime em Obsidian (Desktop/Android) por este agente. Os resultados Android referidos no Módulo 6 são os fornecidos pelo responsável.
- Os testes do repositório que inspecionam texto-fonte (p. ex. `aiPrivacyGateIntegration.test.ts`) provam presença estrutural, não comportamento runtime.
