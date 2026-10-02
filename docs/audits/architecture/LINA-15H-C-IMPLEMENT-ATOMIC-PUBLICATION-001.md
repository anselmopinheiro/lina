# LINA-15H-C — Implementação: purge coordenado, coordenador endurecido e ramo "tudo purgado" (P1)

**Data:** 2026-10-02 · **Branch:** master · **Base:** `57ec4f0` (LINA-15H-B).

**Estado:** implementação do âmbito da auditoria `LINA-15H-C-AUDIT-ATOMIC-PUBLICATION-001.md` (C-01, C-02, C-04, C-06, C-07, C-09, C-10). C-03, C-05, C-08 e C-11 ficam explicitamente para a LINA-15H-D. Sem push, tag ou release.

## 1. Objetivo

Fechar F-08 no âmbito aprovado: purge, ramo de reconciliação "sem alterações", geração e lotes automáticos passam a respeitar a mesma exclusão (reutilizando o `IndexWriteCoordinator`), com fence sem auto-claim e validação factual do par antes de qualquer mutação do purge.

## 2. Relação com os findings

| Finding | Estado | Como |
|---|---|---|
| C-01 HIGH | **resolvido** | purge sob o lease `canonical-maintenance`; estado relido dentro do lease; o interleaving da probe q2-A deixou de ser possível (geração rejeitada durante o purge e vice-versa) |
| C-02 MEDIUM | **resolvido** | o ramo "sem alterações" executa `saveTextIndex` + purge sob o mesmo lease; o manifesto é relido dentro do lease por `saveTextIndex` (probe q2-B) |
| C-04 MEDIUM | **resolvido** | coordenador rejeita sobreposições incompatíveis; `finish` por identidade única de token |
| C-06 MEDIUM | **resolvido** | ramo total sem escrita in-place (P1) |
| C-07 MEDIUM | **resolvido** | purge só atua sobre `canonicalPairState === "consistent"` |
| C-09 LOW | **resolvido para purge/manutenção canónica** | `acquireFence({autoClaimIfUnclaimed:false})`. A geração mantém o comportamento existente (fluxo legítimo de primeira aquisição); não foi alterada |
| C-10 LOW | **resolvido** | invalidação da cache runtime e `markDirty` do controller só após purge que mutou |
| C-03, C-05, C-08, C-11 | **adiados (15H-D)** | ver §13 |
| C-12…C-15 | inalterados (informativos/aceites) | — |

## 3. Ficheiros alterados

| Ficheiro | Razão |
|---|---|
| `src/index/indexWriteCoordinator.ts` | exclusões, token com `id`, novo lease `canonical-maintenance` |
| `src/index/embeddingPersistence.ts` | purge validado + P1; `runCanonicalMaintenance`; `purgeOrphanEmbeddingsCoordinated`; `EmbeddingWriteFence.identity` (opcional) |
| `main.ts` | reconciliação de exclusões usa o lease/fence sem auto-claim; invalidação pós-purge |
| `tests/index/indexWriteCoordinatorHardening.test.ts` (novo) | coordenador |
| `tests/index/canonicalPurgeCoordination.test.ts` (novo) | purge, fence, corridas, P1, matriz de crash |
| `tests/index/artifactInvalidationAndDefensiveFiltering.test.ts` | o duplo da gate passou a modelar `acquireFence`/`assertFence` (o código já não tolera uma gate sem fence) |
| `docs/…`, `AGENTS.md`, `docs/INDEX.md` | documentação desta fase |

## 4. Coordenador

- `startAutomaticBatch` rejeita se qualquer operação estiver ativa (inclui outro lote, rebuild e manutenção canónica); mantém a rejeição por geração/binário/reserva.
- `startTextRebuild` rejeita lote, outro rebuild e manutenção canónica; mantém `embedding-generation-active` para geração/binário/reserva. A exclusão rebuild × lote que antes dependia de `activeAutomaticIndexUpdates` no host passa também a valer no coordenador (o host mantém o seu contador).
- Token com `id` único: `finish` só liberta a operação que o possui, mesmo com o mesmo `kind` e `startedAt` (probe q3: `finish(B)` já não liberta A; um token antigo não liberta uma operação posterior).
- Novo `startCanonicalMaintenance()`: exclusivo (recusa com qualquer operação ativa, reserva de geração pendente e após `dispose`); `requestEmbeddingGenerationPreparation` e `startBinaryMaintenance` recusam-no com `text-index-busy`.
- Sem novo coordenador, sem alterar a semântica de operações sem conflito real (geração × geração, binário).

## 5. Purge

- `purgeOrphanEmbeddingsCoordinated` = lease → fence sem auto-claim → `assertCurrent` → `purgeOrphanEmbeddingRecords` (que relê manifesto e JSONL) → hook `onPurged` só se `status === "purged"` → release no `finally`.
- Resultado tipado: `purged | unchanged | refused` com `reason`.
- Recusa sem mutar: `canonical-pair-inconsistent`, `canonical-manifest-unreadable`, `canonical-unreadable`, `canonical-pair-unverifiable-legacy`, `resource-limit-exceeded`; recusas de coordenação: `index-write-busy`, `ownership-fence-rejected`, `disposed`.
- `absent`/embeddings desativados/sem JSONL → `unchanged` (nada a purgar; não é erro).
- **Mudança de comportamento deliberada:** publicações legadas sem `publicationId` (`unverifiable-legacy`) deixam de ser purgadas; o purge exige prova do par.

## 6. Reconciliação

`reconcileIndexExclusionsInRuntime`:
- ramo "sem alterações": `runCanonicalMaintenance` cobre carimbo de política (`saveTextIndex`) e purge;
- ramo com lote: o lote mantém o seu lease; o purge corre depois sob `purgeOrphanEmbeddingsCoordinated`;
- ambos obtêm a fence por `acquireCanonicalMaintenanceFence()` (sem auto-claim) e carimbam a proveniência a partir da fence capturada (`createArtifactProvenance`), não de uma decisão em cache.
- Lease ocupado ⇒ o purge é adiado (diagnóstico `orphan embedding purge refused`); a filtragem defensiva da pesquisa continua a proteger a leitura e o próximo purge limpa os órfãos.

## 7. Estratégia P1 (ramo "tudo purgado")

Sem par vazio, sem novo estado, sem schema. Sequência (cada passo mutável precedido de `assertWriteFence`): staging do manifesto resultante (`embeddingsEnabled:false`, sem `embeddings`/`embeddingInput`) → releitura/validação → remover backups antigos → `rename` JSONL → `embeddings.publish.backup` → `rename` manifesto → `manifest.publish.backup` → `rename` tmp → `manifest.json` → validação final (manifesto desativado e JSONL ausente) → limpeza dos backups (só depois do commit). Falha não-crash: rollback inverso. O JSONL sai primeiro para que **todas** as janelas sejam estados que o recovery da 15H-B já entende.

Matriz de crash (teste permanente, 6 operações mutáveis): falhas 1–5 ⇒ após recovery, par `consistent` com o JSONL anterior (o recovery restaura os backups; o purge fica por fazer, é idempotente e será repetido); falha 6 (remoção do último backup) ⇒ par `absent`. O manifesto nunca fica parcial nem escrito in-place (`writtenPaths` não contém `manifest.json`).

## 8. Testes adicionados

`indexWriteCoordinatorHardening` (13): lote duplicado, `finish` com token em falta/antigo/de outro tipo, geração × lote, rebuild × operações incompatíveis, exclusões existentes preservadas, lease de manutenção contra geração/preparação/lotes/rebuild/binário. `canonicalPurgeCoordination` (17): par consistente; recusas por `inconsistent`/`unreadable`/`unverifiable-legacy`/`resource-limit-exceeded` sem qualquer mutação; sem ownership e **sem auto-claim** (gate real); revogação de fence entre mutações + recovery; corrida q2-A (geração rejeitada durante o purge e purge posterior preserva a publicação mais recente); corrida q2-B (lease durante `saveTextIndex`; secção `embeddings` preservada); purge × rebuild/lote; invalidação (sucesso vs. recusa); ramo total (sem in-place, sem resíduos, rollback, matriz de crash).

## 9. Ownership / fence

`{deviceId, epoch}` continua a autoridade; `assertWriteFence` antes de cada mutação do purge e do ramo total; o lease não substitui a fence. Sem ownership válido: nada é escrito, removido ou publicado, e `ownership.json` não é criado. Companion/Standby/Unassigned não obtêm fence ⇒ nunca adquirem efeito de purge (o lease é libertado).

## 10. Invalidação

Após purge que mutou: `invalidateRuntimeEmbeddingIndex("canonical-published")` e `markEmbeddingWorkStatusDirty("embeddings-published")`. Não ocorre em `unchanged`, `refused`, lease ocupado ou fence recusada. O lifecycle continua a derivar o estado de `canonicalPairState` (par inconsistente ⇒ INCOMPATIBLE); o purge nunca o converte em READY porque recusa agir.

## 11. Gates

| Gate | Resultado |
|---|---|
| `npm test` | 163 ficheiros / 2165 testes aprovados |
| `npm run typecheck` | passou |
| `npm run lint:obsidian:strict` | 0 erros / 0 avisos |
| `npm run build` | passou; `main.js` restaurado (artefacto gerado) |
| `npm run release-check` | passou (não é execução de release) |
| `git diff --check` | passou |

## 12. Findings residuais

1. **Resíduo no ramo total:** falha exatamente na remoção do último backup deixa `embeddings.publish.backup` órfão; o recovery avisa (`canonical-backup-invalid`) mas não o remove (estado final válido, sem impacto em leitura). Não se alterou o recovery.
2. **Rollback do purge pelo recovery:** um crash depois da publicação do manifesto desativado e antes da limpeza é revertido pelo recovery para o par anterior (consistente); o purge repete-se numa reconciliação seguinte.
3. **Purge adiado** quando o lease está ocupado (geração/rebuild/lote ativos); recuperado pela filtragem defensiva e pela reconciliação seguinte.
4. **Limites da plataforma** (inalterados): sem `fsync`, TOCTOU entre `assertFence` e o rename, sem atomicidade multi-ficheiro, sem controlo da sincronização externa. A janela física em que `manifest.json` não existe entre dois renames mantém-se (P1 reduz-a e torna-a recuperável).
5. A geração mantém `acquireFence()` com auto-claim (fluxo legítimo existente).

## 13. Adiado para a LINA-15H-D

C-03 (backups/tmp determinísticos e ordem por ficheiro em `saveTextIndex`), C-05 (fence e aborto sem proveniência em `saveTextIndex`), C-08 (recovery a restaurar o manifesto partilhado só se ausente / re-verificar digests) e C-11 (órfãos `*.tmp-*`/`*.bak-*` de `saveTextIndex`). Nenhum destes foi tocado. `saveTextIndex` apenas passou a ser chamado, no ramo "sem alterações", sob o lease.

## 14. Garantias

Sem alterações a schemas, `data.json`, formato JSONL, modelo `{deviceId, epoch}`, Scheduler, Worker, Operation Manager, `effectiveAiConfig` ou protocolo de publicação da 15H-B. Nenhum provider chamado, nenhum embedding gerado, nenhuma nota do vault alterada.
