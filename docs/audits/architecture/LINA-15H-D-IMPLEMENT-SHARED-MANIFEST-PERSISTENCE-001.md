# LINA-15H-D — Implementação: persistência crash-safe do manifesto partilhado (`saveTextIndex`)

**Data:** 2026-10-02 · **Branch:** master · **Base:** `edd3e01` (LINA-15H-C).

**Estado:** implementação de C-03, C-05, C-08 e C-11 (auditoria `LINA-15H-C-AUDIT-ATOMIC-PUBLICATION-001.md`). Sem push, tag ou release.

## 1. Findings

| Finding | Estado | Resumo |
|---|---|---|
| C-03 | **resolvido** | protocolo com nomes determinísticos, backup+publicação por ficheiro, manifesto último; identidade dos embeddings preservada em todos os pontos de crash |
| C-05 | **resolvido** | `saveTextIndex` recebe a fence (`IndexWriteFence`) e revalida-a antes de cada mutação; os três chamadores de produção provam a autoridade no momento da escrita |
| C-08 | **resolvido** | o recovery só restaura com evidência; nunca substitui uma publicação (texto ou embeddings) mais recente por uma antiga |
| C-11 | **resolvido** para os nomes do protocolo | limpeza dos `*.publish.tmp`/`*.publish.backup` determinísticos, só sob fence |

## 2. Protocolo final de `saveTextIndex`

Chamador: lease (rebuild, lote automático ou manutenção canónica da 15H-C) → fence sem auto-claim → `saveTextIndex(…, fence)`.

1. validar a política; `assertIndexWriteFence`;
2. `recoverTextIndexPublication` (resolve uma publicação interrompida antes de ler o manifesto);
3. ler a secção `embeddings`/`embeddingInput` do manifesto partilhado: `manifest.json` → `text-manifest.publish.backup` → `manifest.publish.backup` (backup da publicação de embeddings, relevante quando o crash deixou `manifest.json` ausente); resíduos de backup que o recovery não resolveu são removidos depois de extraída a identidade;
4. compor o manifesto (preserva a secção lida; `generationId` e digests novos);
5. staging dos três ficheiros em `producer/staging/text-{notes,chunks,manifest}.publish.tmp`; validar o manifesto em staging;
6. reler a secção partilhada: se mudou (ou, quando lida de um backup, se o manifesto reapareceu) → **abortar**, nunca last-write-wins;
7. por ficheiro, na ordem notes → chunks → **manifest** (ponto de commit lógico): `assertFence`, `rename` do atual para `producer/backups/text-*.publish.backup`, `assertFence`, `rename` do tmp para o destino;
8. validar o manifesto publicado (`generationId` e secção de embeddings iguais);
9. remover os backups (só após o commit; sob fence).

Falha não-crash: rollback apenas do que a publicação moveu (um backup que não chegou a ser movido nunca apaga o original — corrige um defeito do protocolo anterior). **Após rejeição da fence não há rollback**: o estado fica para o recovery.

## 3. Manifesto partilhado

O manifesto continua a ser um ficheiro com dois escritores. A preservação é feita sob o lease da 15H-C, com leitura dentro do lease, releitura imediatamente antes da publicação e validação do resultado. Nenhum identificador persistido novo; o formato do manifesto é o mesmo.

## 4. Fence (C-05)

- Novo `src/index/writeFence.ts`: `IndexWriteFence` (mesma abstração da 15A; `EmbeddingWriteFence` passou a ser um alias), `OwnershipFenceRejectedError`, `assertIndexWriteFence`, `withFencedAdapter` (proxy que revalida antes de cada `write/writeBinary/remove/rename/mkdir`).
- `main.ts`: o rebuild, o lote automático e o ramo "sem alterações" obtêm a fence com `acquireFence({autoClaimIfUnclaimed:false})` **no momento da escrita**. Sem fence: o rebuild falha com a mensagem de operação de produtor e o lote é descartado sem escrever (as alterações são redetetadas pela reconciliação de arranque; não é reenfileirado para evitar ciclos). A proveniência é carimbada a partir da fence capturada (já não de `evaluateProvenance()` indefinida nem de `getProvenance()` em cache).
- `isAuthorizedSync()` continua a ser apenas gate de montante; deixa de ser a autoridade final de qualquer escrita de texto.
- Teste estático: os três chamadores de produção passam a fence.

## 5. Recovery (C-08)

`recoverTextIndexPublication` (corre primeiro, a partir de `recoverEmbeddingPersistenceArtifacts`, portanto no arranque, no início de uma geração e dentro de `saveTextIndex`):

- tmp de staging: sempre removidos, nunca promovidos;
- tripla atual completa (manifesto, digests e contagens) ⇒ backups são resíduo: **só removidos**;
- backup de manifesto ao lado de um manifesto existente com tripla atual incompleta ⇒ `text-backup-superseded`, nada alterado;
- caso contrário, restaura apenas se a tripla "backups + ficheiros intactos" for ela própria uma publicação completa; senão `text-backup-invalid`;
- restauro via staging; backups mantidos até validar.

Recovery de embeddings (`restoreCanonicalBackups`): **não restaura o manifesto de backup por cima de um manifesto existente, válido e diferente** (publicação textual mais recente). Se o JSONL de backup corresponde ao manifesto atual (que preserva a identidade — passo 3 acima), é restaurado só o JSONL. Um manifesto corrupto continua a poder ser substituído.

## 6. Matrizes de crash

`tests/index/sharedManifestPersistence.test.ts`: para **cada** operação mutável de `saveTextIndex` (≥12) com um par de embeddings publicado, crash → recovery de arranque → verifica: identidade dos embeddings igual (E1), par `consistent`, índice textual utilizável, sem resíduo; e repetição: o `saveTextIndex` seguinte recupera sozinho. Crash depois do commit faz roll-forward (nunca volta atrás). Revogação da fence após cada chamada: nenhuma mutação depois da rejeição.

## 7. Concorrência e lifecycle

Mantém-se a 15H-C: sob o lease de manutenção canónica ficam recusados geração, lote, rebuild, binário e outra manutenção durante o `saveTextIndex`. Lifecycle inalterado: par consistente continua `consistent`; par inconsistente não é reparado por `saveTextIndex`; um crash recuperável de texto não torna o par inconsistente.

## 8. Ficheiros alterados

`src/index/indexStore.ts` (protocolo e recovery), `src/index/writeFence.ts` (novo), `src/index/embeddingPersistence.ts` (alias de fence, chamada ao recovery textual, guarda C-08), `main.ts` (fence nos 3 chamadores), testes: `sharedManifestPersistence` (novo, 27), ajustes de nomes/duplos em `artifactGenerationIntegrity`, `canonicalPurgeCoordination`, `indexStore`, `indexController` (duplo de autoridade + 1 teste de lote sem autoridade), tolerância de microtasks em `embeddingProviderValidation` (a recuperação passou a ter mais passos assíncronos).

## 9. Gates

`npm test` 164 ficheiros / 2193 testes; `npm run typecheck`; `npm run lint:obsidian:strict` (0/0); `npm run build` (main.js restaurado); `npm run release-check`; `git diff --check` — todos verdes.

## 10. Findings residuais

1. Ficheiros aleatórios `*.tmp-*`/`*.bak-*` deixados por versões anteriores não são reconhecidos nem limpos (nomes desconhecidos; só se limpa o que o protocolo possui).
2. `text-backup-superseded` mantém os backups e avisa; não há resolução automática (exige decisão humana ou fase futura).
3. `saveTextIndex` continua a devolver `false` para rejeição de fence, o que a UI de rebuild apresenta como falha genérica de produtor.
4. Um lote descartado por falta de autoridade só é redetetado no arranque seguinte.
5. Limites da plataforma inalterados: sem `fsync`, TOCTOU entre `assertFence` e o rename, sem atomicidade multi-ficheiro; o nome `manifest.json` continua a desaparecer brevemente entre dois renames (visível a ferramentas de sincronização).
6. A geração mantém `acquireFence()` com auto-claim (fluxo legítimo existente, não alterado).

## 11. Possível trabalho 15H-E

Separar o marcador do índice textual da identidade dos embeddings (exige migração); limpeza dos órfãos legados de nome aleatório; mensagem específica para perda de autoridade no rebuild; política para `text-backup-superseded`.

## 12. Garantias

Sem alterações a schemas, `data.json`, formato JSONL, formato binário, modelo `{deviceId, epoch}`, Scheduler, Worker, Operation Manager, `effectiveAiConfig`, política de purge da 15H-C ou protocolo de publicação de embeddings. Nenhum provider chamado, nenhum embedding gerado, nenhuma nota alterada.
