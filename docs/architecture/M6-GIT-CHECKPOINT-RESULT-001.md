# M6 Git checkpoint result (B4)

```text
B1 = PASS
B2 = PASS
B3 = PASS
B4 = PASS
M6 = NOT_STARTED
CUTOVER = NOT_STARTED
```

| Campo | Valor |
| --- | --- |
| branch | `master` |
| previousHead | `620a2c62b3a907927c12bd72e25b847caa6f3e61` |
| newHead | o commit que contém este ficheiro (`git log -1`; um hash não pode constar do próprio commit) |
| commitMessage | `chore: checkpoint pre-m6 published generation pipeline` |
| pushPerformed | `false` |

## Ficheiros incluídos

- **Produto (modificados, 10):** `main.ts`, `src/device/ownershipGate.ts`, `src/index/embeddingPersistence.ts`, `src/index/producerLocalStorePathResolver.ts`, `src/index/producerLocalStoreTypes.ts`, `src/index/sqliteProducerLocalStore.ts`, `src/index/sqliteProducerShadowWriter.ts`, `src/maintenance/binaryWorker.ts`, `src/search/runtimeEmbeddingIndex.ts`, `src/settings.ts`.
- **Produto (novos, 12):** `src/index/` — `consumerPublishedGenerationEligibility`, `embeddingInputHashBackfill`, `producerStoreEquivalenceAuditor`, `publishedGenerationBuilder`, `publishedGenerationEquivalence`, `publishedGenerationPublicationService`, `publishedGenerationReader`, `publishedGenerationShadowAudit`, `publishedGenerationValidator`, `publishedGenerationWriter`, `sqliteProducerBootstrap`, `sqliteProducerCanonicalWriter`.
- **Testes:** 3 modificados em `tests/index/`; 15 novos (`tests/device/ownershipCache*.test.ts`, `tests/index/` published generation, producer store, SQLite canonical).
- **Documentação arquitetural:** 24 `.md` em `docs/architecture/` (G1, G2, G3, G6, M2–M6).
- **Evidência permanente:** 24 `.json` em `docs/architecture/evidence/` + `evidence/runtime/M3B-CANONICAL-OBSIDIAN-RUNTIME-001.json`.
- **Scripts permanentes:** 6 `scripts/run-obsidian-*-proof.mjs`.
- **Artefacto gerado:** `main.js` (ver decisão).

## Ficheiros excluídos

- `.lina-local/` — base SQLite local do producer (`db/lina-producer.db`, ~10 MB), estado de runtime, não pertence ao repositório. Não está no `.gitignore`; não foi alterado nesta tarefa (fora do âmbito). Recomenda-se adicioná-lo em tarefa posterior.

## Decisão sobre `main.js`

**Incluído.** `main.js` é tracked (`git ls-files main.js`), foi commitado em todos os commits de produto recentes (`620a2c6`, `862ce1f`, `25859cf`, …) e o CI/release usa-o como asset. O bundle foi regenerado por `npm run build` a partir do código deste checkpoint.

## Validação (antes do staging)

| Gate | Resultado |
| --- | --- |
| `npm test` | PASS — 181 ficheiros / 2387 testes |
| `npm run typecheck` | PASS |
| `npm run lint:obsidian:strict` | PASS (0 warnings) |
| `npm run build` | PASS |
| `npm run release-check` | PASS |
| `git diff --check` | PASS |

Revisão de segredos/paths locais (`C:\Users`, `sk-`, `Bearer`, api keys) nas evidências: sem ocorrências.

## Estado final do worktree

Só `.lina-local/` permanece untracked (exclusão deliberada). Sem push. M6, cutover, source selection e cache runtime não foram tocados.

## Normalização de whitespace

Para `git diff --cached --check` passar, 7 ficheiros novos (4 `.md`, 2 `.json` de evidência, 1 teste) foram normalizados de CRLF/trailing whitespace para LF, sem alterar conteúdo (JSON revalidado; `ownershipCacheAudit.test.ts` 4/4).
