# LINA-15H-E — Auditoria final de fecho da persistência

Estado: auditoria apenas. Nenhum código, schema ou `data.json` foi alterado. Nenhum embedding foi gerado, nenhum provider foi chamado, nenhum commit ou push foi feito.

## 1. Objetivo

Responder, com evidência do código atual, se a persistência de texto e embeddings do Lina, depois das fases 15H-B, 15H-C e 15H-D, é coerente, recuperável, fenced e fail-closed, ou se ainda existe algum caminho em que se possa perder, misturar, aceitar ou apresentar como válido um estado que não corresponde ao que está realmente persistido.

## 2. Base auditada

- Branch `master`, HEAD `b4ed0dc` (`fix(index): make shared manifest persistence crash-safe`), working tree limpa no início.
- Commits relevantes: `89b4764` (15H-A), `fa83d02` (15H-B-A), `57ec4f0` (15H-B), `edd3e01` (15H-C), `b4ed0dc` (15H-D).
- A documentação não foi aceite como prova: cada conclusão abaixo assenta em leitura do código atual e/ou em probe executado (secção 11 e 16).

## 3. Documentos consultados

`AGENTS.md`; `docs/INDEX.md`; `LINA-15H-B-IMPLEMENT-RECOVERY-PAIR-001`, `LINA-15H-C-IMPLEMENT-ATOMIC-PUBLICATION-001`, `LINA-15H-D-IMPLEMENT-SHARED-MANIFEST-PERSISTENCE-001`; auditorias 15H-A, 15H-B-A, 15H-C-A; registos de 15A–15G em `AGENTS.md`.

Código lido: `src/index/indexStore.ts`, `src/index/embeddingPersistence.ts`, `src/index/writeFence.ts`, `src/index/indexWriteCoordinator.ts`, `src/index/embeddingBinaryCopyController.ts`, `src/index/embeddingBinaryStorage.ts`, `src/device/ownershipGate.ts`, `src/search/runtimeEmbeddingIndex.ts`, e os chamadores em `main.ts` (arranque ~1615; reconcile/purge ~2225–2290; rebuild ~2421–2530; geração ~3013; lotes automáticos ~3434/3477/3721).

Divergências documentação/código identificadas: ver N-01 a N-05 (a documentação 15H-C/15H-D descreve o rollback e a exclusão como cobrindo "toda a mutação sob fence"; o código tem exceções, abaixo).

## 4. Arquitetura real

- Artefactos partilhados em `.lina/index/`: `notes.json`, `chunks.jsonl`, `manifest.json` (partilhado entre texto e a secção `embeddings`/`embeddingInput`/`vectorContract`), `embeddings.jsonl`, ficheiros binários derivados. Operacional local: `.lina/producer/{staging,backups,checkpoints}`.
- Autoridade: `OwnershipGate.acquireFence()` captura `{producerDeviceId, epoch}`; `assertFence()` revalida contra `.lina/ownership.json` (ausente ≠ inválido).
- Exclusão: `IndexWriteCoordinator`, **em memória, por instância do plugin**.
- Estado factual: `inspectCanonicalPair`/`validateCanonicalContent` → `canonicalPairState` → `EmbeddingLifecycleSnapshot`.

## 5. Protocolo de embeddings

Publicação (`publishCanonicalEmbeddings`): preparar e validar `embeddings.publish.tmp` e `manifest.publish.tmp` → backup do JSONL canónico → rename do novo JSONL → manifesto atual para backup → rename do manifesto tmp → validação do par → limpeza de backups e checkpoint. O ponto lógico de commit é o rename do manifesto (manifesto publicado depois do JSONL). Cada mutação passa por adapter fenced (revalida a fence antes de cada `write/rename/remove/mkdir`).

Rollback: `catch` global restaura backups. **Corre também quando o erro é `OwnershipFenceRejectedError` e com o adapter não fenced** (N-01).

Purge: sob lease `canonical-maintenance`, com ordenação P1 (ramo "tudo purgado" publica manifesto "disabled/empty" de forma coerente). `publishEmbeddingsDisabledManifest` partilha o mesmo padrão de rollback não fenced.

Binário: derivado, controlador próprio, lease `binary-maintenance`, `recoverBinaryEmbeddingPublication`; nunca canónico; só lido se `sourcePublicationId` coincide.

Primeiro publish: sem canónico prévio, sem backups; falha antes do rename do manifesto deixa JSONL novo sem manifesto correspondente, classificado pelo par como `inconsistent`/`unreadable` (fail-closed na pesquisa).

## 6. Protocolo de texto

`saveTextIndex(app, notes, chunks, chunkingOptions, excludedNotes, exclusionsInfo, provenance, policyIdentity, fence)`:

1. Lê a secção `embeddings` do manifesto atual (**se o manifesto está corrompido a secção torna-se `{}` silenciosamente** — N-03).
2. Backups do manifesto de texto e do manifesto de embeddings; remove backups de texto não resolvidos (~linha 632).
3. Staging `text-*.publish.tmp`; releitura da secção partilhada de embeddings antes de publicar.
4. Por ficheiro: backup + rename com `assertIndexWriteFence`; **manifesto por último = commit lógico**.
5. Validação; rollback só para erros que não são rejeição de fence; limpeza de backups.

Recovery de texto (`recoverTextIndexPublication`): remove tmps; tripla corrente completa ⇒ resíduo de backups; backup do manifesto ao lado de manifesto existente com tripla incompleta ⇒ `text-backup-superseded`; restauro por staging só se backups + ficheiros intactos formam tripla completa.

## 7. Coordinator

Leases: `embedding-generation` (+reserva), `text-automatic-batch`, `text-rebuild`, `canonical-maintenance`, `binary-maintenance`. Tokens com id único; `finish` por token. Rejeita lote×lote, rebuild×lote/rebuild/manutenção. É estado de processo: **não protege entre instâncias/dispositivos/janelas** (N-02). `saveTextIndex` e `recoverTextIndexPublication` não adquirem lease por si; dependem do chamador (todos os chamadores atuais em `main.ts` adquirem lease — verificado por leitura; a proteção é por convenção, não imposta pela API).

## 8. Ownership/fencing

Fence capturada na aquisição, revalidada antes de cada mutação adaptadora. Rejeição de fence: `saveTextIndex` não faz rollback (correto). `publishCanonicalEmbeddings` e `publishEmbeddingsDisabledManifest` fazem rollback sobre `.lina/index` **depois** de perder a autoridade (N-01). A correção 15A (auto-claim só se manifesto ausente) foi confirmada. TOCTOU entre `assertFence` e o rename é inerente ao DataAdapter.

## 9. Recovery

`recoverEmbeddingPersistenceArtifacts` chama primeiro `recoverTextIndexPublication`; arranque via ReconciliationWorker sob fence + lease `binary-maintenance`, sem auto-claim. `restoreCanonicalBackups` usa `manifestSupersedesBackup` para não restaurar antigo sobre mais recente quando há evidência. Limite: a evidência é de contagem/`publicationId`; com contagem igual e conteúdo diferente o par é aceite (N-04, probe P1).

## 10. Lifecycle

`canonicalPairState` alimenta o snapshot; `inconsistent`, `unreadable`, `resource-limit-exceeded` e `unverifiable-legacy` não são tratados como utilizáveis. O caminho JSONL do runtime rejeita apenas `inconsistent`; o binário compara contagem/publicationId/identidade. Sem identidades fabricadas (15D confirmado). Invalidação do cache runtime após publicação/rollback/recovery confirmada por leitura; sem leitura de checkpoint com mutação fora do lease de geração (`loadEmbeddingCheckpoint` só é chamado pelo gerador).

## 11. Matriz de crash

Legenda: CONS = CONSISTENTE; FC = FAIL-CLOSED; REC = RECUPERÁVEL; IND = INDETERMINADO; INS = INSEGURO. "Evidência": código (C), probe (P), teste (T).

### Embeddings

| Operação | Crash | Disco | Observado | Recovery | Final | Classe | Evid. |
|---|---|---|---|---|---|---|---|
| publish | após tmp JSONL/manifesto | tmps + canónico antigo | antigo válido | tmps removidos | antigo | CONS | C,T |
| publish | após backup JSONL, antes rename | backup + canónico (ainda presente) | antigo | limpeza/backup residual | antigo | REC | C,T |
| publish | após rename JSONL, antes do manifesto | JSONL novo, manifesto antigo | par `inconsistent` (contagem/id) | restaurar backup JSONL | antigo | REC/FC | C,T |
| publish | após rename JSONL, mesma contagem | JSONL novo, manifesto antigo | par aceite como consistente | recovery aceita | misto | **INS (N-04)** | P1 |
| publish | após manifesto, antes de limpeza | novo + backups | novo válido | backups removidos | novo | CONS | C,T |
| primeiro publish | após JSONL, sem manifesto | JSONL sem manifesto | par não utilizável | recovery/rebuild | sem índice | FC | C |
| purge (tudo) | entre JSONL e manifesto | ordenação P1 | manifesto coerente com vazio | recovery | vazio | REC | C,T |
| rebuild | antes de publicação | índice anterior | anterior | nenhum | anterior | CONS | C |
| rollback pós-fence | fence rejeitada, rollback corre | ficheiros restaurados sem autoridade | — | — | pode sobrepor novo produtor | **INS (N-01)** | P5,P6 |

### Texto

| Operação | Crash | Disco | Observado | Recovery | Final | Classe | Evid. |
|---|---|---|---|---|---|---|---|
| save | após staging | tmps + tripla antiga | antiga | tmps removidos | antiga | CONS | C,T |
| save | após backup notes | backup + notes antigo | antiga | residual | antiga | REC | C,T |
| save | após rename notes (novo) | notes novo, chunks/manifest antigos | tripla mista; manifesto ainda antigo | restauro por backups | antiga | REC | C,T |
| save | após rename chunks | idem | idem | idem | antiga | REC | C,T |
| save | após manifesto, antes de validação/limpeza | tripla nova + backups | nova | backups resíduo | nova | CONS | C,T |
| save | manifesto corrompido de início | secção embeddings perdida | save com sucesso | nenhum | identidade de embeddings apagada | **INS (N-03)** | P2 |
| recovery | crash a meio | staging + backups | idempotente | repetir | tripla completa ou incompleta | REC / `text-backup-superseded` residual | C,T |

Classes IND: nenhuma linha classificada INDETERMINADO sem evidência; onde a evidência falta (sincronização externa, secção 13) o risco é declarado como incerteza.

## 12. Concorrência

| Par | Proteção | Resultado |
|---|---|---|
| generation × saveTextIndex | coordinator (mesma instância); manifest section re-read | protegido intra-instância |
| generation × purge | coordinator | protegido |
| generation × recovery | coordinator (lease de manutenção/geração) | protegido |
| saveTextIndex × purge | coordinator por chamador | protegido por convenção |
| saveTextIndex × recovery | idem | protegido por convenção |
| saveTextIndex × rebuild | rebuild lease | protegido |
| purge × recovery | `canonical-maintenance` | protegido |
| rebuild × recovery | rebuild vs manutenção rejeitados | protegido |
| lote automático × purge | rejeição lote×manutenção | protegido |
| lote automático × saveTextIndex | `text-automatic-batch` | protegido |
| **qualquer par, duas instâncias/dispositivos** | nenhuma (coordinator em memória; fence só valida epoch) | **N-02: probes P3/P4 perdem JSONL canónico ou índice textual** |

Não protegidas pelo coordinator por API: `saveTextIndex`, `recoverTextIndexPublication`, `loadEmbeddingCheckpoint` (limpeza de órfão), `recoverBinaryEmbeddingPublication` — exigem lease do chamador.

## 13. Sincronização externa

Syncthing/Obsidian Sync podem entregar `manifest.json`, JSONL, `chunks.jsonl`, `notes.json`, `.tmp` e `.backup` fora de ordem e a meio de uma publicação. Consequências classificadas: manifesto novo + JSONL antigo ⇒ par `inconsistent` (fail-closed) exceto contagem igual (N-04); `.tmp`/`.backup` sincronizados para um Companion são ignorados pela leitura (nomes determinísticos) mas podem ser consumidos por um recovery num Producer ativo. Companion nunca escreve. Não há prova de ordem; risco de classe RISCO ARQUITETURAL/RESIDUAL — **incerteza declarada**: não foi executado cenário real de sincronização.

## 14. Artefactos órfãos

| Tipo | Cria | Consome/limpa | Recovery reconhece | Confundível com válido | Sobrevive | Classe |
|---|---|---|---|---|---|---|
| `embeddings.publish.tmp`/`manifest.publish.tmp` | publish | publish/recovery | sim | não | só após crash, até recovery | benigno |
| `embeddings.publish.backup`/`manifest.publish.backup` | publish | publish/recovery | sim | não | idem | recuperável |
| `embeddings.checkpoint.*` (+tmp/backup) | gerador | gerador/recovery | sim | não pesquisável | até geração/limpeza | benigno |
| `text-*.publish.tmp`/`.backup` | saveTextIndex | save/recovery 15H-D | sim | não | idem | recuperável |
| `text-backup-superseded` | recovery | — | marcador | não | **indefinidamente** (sem consumidor) | operacionalmente problemático (menor) |
| órfãos legados com nome aleatório (pré-15H-D) | versões anteriores | ninguém | **não** | não | indefinidamente | benigno (espaço), declarado em 15H-D |
| binários derivados e tmps | controlador binário | controlador/recovery binário | sim | só se `sourcePublicationId` coincide | até manutenção | benigno |

Nenhum nome desconhecido é removido pelo recovery (conforme AGENTS.md).

## 15. DataAdapter

Garantias: rename individual (nomes de destino mantidos ausentes antes do rename por compatibilidade mobile), staging determinístico, fence antes de cada mutação adaptadora, lease em memória, recovery idempotente.

Limites (não são bugs, mas limitam o que se pode afirmar): sem fsync; sem atomicidade multi-ficheiro; sem transação de filesystem; TOCTOU entre `assertFence` e a operação; sincronização externa fora do controlo do plugin; sobreposição entre instâncias não detetada (N-02).

## 16. Revisão dos findings anteriores

Verificado contra o código atual (não pela documentação). Probes executados fora do repositório (bundle esbuild com alias `obsidian → tests/helpers/mockObsidian.ts`, `FakeAdapter` com hooks `beforeOperation`/`shouldFail`): P1 contagem igual aceite após recovery; P2 `saveTextIndex` sobre manifesto corrompido perde identidade de embeddings e devolve sucesso; P3/P4 sobreposição entre duas instâncias perde JSONL canónico/índice textual; P5/P6 rollback muta `.lina/index` após rejeição de fence em `publishCanonicalEmbeddings` e no ramo "tudo purgado". Suite completa `npx vitest run`: 164 ficheiros / 2193 testes verdes.

| Fase | Finding | Estado |
|---|---|---|
| 15A | Fencing durável, auto-claim só com manifesto ausente | RESOLVIDO (confirmado; ver N-01 para rollback pós-fence → PARCIAL quanto a "nenhuma mutação após perda de autoridade") |
| 15B | `full-rebuild` ⇒ `INCOMPATIBLE`/confirmação | RESOLVIDO |
| 15C | Teto de leitura ≠ corrupção | RESOLVIDO |
| 15D | Snapshot único, sem identidades fabricadas | RESOLVIDO |
| 15F | Consistência config/runtime | RESOLVIDO |
| 15G | Defaults/compatibilidade de settings | RESOLVIDO (fora do motor de persistência) |
| 15H-B | Recovery no arranque, par canónico, fence | PARCIAL (equal-count, N-04) |
| 15H-C | Purge coordenado, coordinator, ramo P1 | PARCIAL (rollback pós-fence N-01; escopo intra-instância N-02) |
| 15H-D | `saveTextIndex` crash-safe com fence | PARCIAL (manifesto corrompido N-03; resíduos aceites) |

## 17. Classificação final

| ID | Descrição | Classificação |
|---|---|---|
| N-01 | `publishCanonicalEmbeddings`/`publishEmbeddingsDisabledManifest`: rollback corre com adapter não fenced após `OwnershipFenceRejectedError` e muta `.lina/index` sem autoridade (viola I3). Reproduzido (P5, P6). | **BUG REAL** |
| N-02 | Coordinator só em memória: duas instâncias (outro dispositivo/janela com autoridade em disputa, ou transferência de ownership) sobrepõem escritas (viola I4). Reproduzido (P3, P4) com instâncias simuladas; a fence limita mas não elimina a janela. | **RISCO ARQUITETURAL** |
| N-03 | `saveTextIndex` sobre manifesto ilegível substitui `embeddings` por `{}` e devolve sucesso (viola I1 em estado degradado). Reproduzido (P2). | **BUG REAL** |
| N-04 | Vinculação JSONL↔manifesto por contagem/`publicationId` sem digest do conteúdo: contagem igual com conteúdo diferente é aceite (viola I2/I5 neste caso). Reproduzido (P1). Documentado em 15H-B §10.1/10.2 como limite. | **RISCO ARQUITETURAL** |
| N-05 | `text-backup-superseded` sem consumidor/limpeza | RESIDUAL ACEITE |
| N-06 | Órfãos legados de nome aleatório | RESIDUAL ACEITE |
| N-07 | Sem fsync / atomicidade multi-ficheiro / TOCTOU fence→rename | RESIDUAL ACEITE |
| N-08 | `saveTextIndex`/recovery de texto exigem lease por convenção do chamador (todos os chamadores atuais cumprem) | RESIDUAL ACEITE |
| N-09 | Chegada dessincronizada por sync externo | FORA DO ÂMBITO (parcialmente; mitigação fail-closed na leitura) |
| N-10 | Exclusão intra-instância (todos os pares da secção 12) | FECHADO |
| N-11 | Lifecycle sem identidades fabricadas; `inconsistent`/`unreadable` bloqueados na pesquisa; invalidação de cache | FECHADO |
| N-12 | Auto-claim 15A, ownership ausente vs inválido | FECHADO |
| N-13 | Recovery de texto idempotente, nomes conhecidos apenas | FECHADO |

Observação sobre N-04: o JSONL de pesquisa rejeita só `inconsistent`; o caminho binário é mais estrito. Não foi provada exploração sem sincronização externa ou crash entre renames.

## 18. Riscos residuais

N-02, N-04, N-05, N-06, N-07, N-08, N-09 acima. A incerteza principal é o comportamento real sob sincronização externa e em mobile/iOS (não testado).

## 19. Próximos passos (decisão do responsável; nada implementado)

1. Corrigir N-01: não executar rollback mutável após `OwnershipFenceRejectedError` (ou deixá-lo a cargo do recovery do próximo produtor autorizado).
2. Corrigir N-03: `saveTextIndex` falhar fechado (ou preservar o ficheiro) quando o manifesto existe mas é ilegível.
3. Decidir N-02 e N-04: se justifica um lease/lock persistente por `.lina/` e um digest de conteúdo na ligação JSONL↔manifesto (decisão de arquitetura e de compatibilidade de schema).

## 20. Resposta à pergunta central

**Não.** Existem situações em que o estado persistido pode ser perdido ou aceite como válido sem corresponder ao realmente persistido: (a) N-01, mutação durável após perda de ownership (bug reproduzido); (b) N-03, perda silenciosa da identidade de embeddings por `saveTextIndex` sobre manifesto corrompido (bug reproduzido); (c) N-04, par com contagem igual e conteúdo diferente aceite como consistente (risco arquitetural reproduzido); (d) N-02, exclusão apenas por instância. Dentro de uma única instância e do caminho nominal, o sistema é coerente, recuperável, fenced e fail-closed na leitura.

## Gates

`git diff --check` e `git status` executados no fim; único ficheiro novo: este relatório. Nenhum commit, nenhum push.

CONCLUSÃO DA AUDITORIA

Persistência:
Coerente no caminho nominal intra-instância; dois bugs reais (N-01, N-03) e dois riscos arquiteturais (N-02, N-04) reproduzidos por probe.

Embeddings:
Publicação com commit no manifesto, validação e rollback funcionam; rollback pós-fence viola I3 (N-01); vinculação por contagem (N-04).

Texto:
`saveTextIndex` fenced, manifesto por último, recovery idempotente; manifesto ilegível apaga identidade de embeddings (N-03).

Recovery:
Idempotente, só nomes conhecidos, texto antes de embeddings; limite de evidência por contagem (N-04).

Ownership/fencing:
Fence antes de cada mutação adaptadora; auto-claim corrigido; rollback pós-rejeição não fenced (N-01); TOCTOU residual.

Concorrência:
Fechada intra-instância; sem proteção entre instâncias (N-02).

Lifecycle:
Sem identidades fabricadas, estados inseguros bloqueados, invalidação confirmada.

Resíduos:
`text-backup-superseded` e órfãos legados aleatórios aceites; sem remoção de ficheiros desconhecidos.

FECHADOS: N-10, N-11, N-12, N-13
RESIDUAIS ACEITES: N-05, N-06, N-07, N-08
BUGS REAIS: N-01, N-03
RISCOS ARQUITETURAIS: N-02, N-04
FORA DO ÂMBITO: N-09

DECISÃO TÉCNICA:
Necessária nova implementação (mínimo: N-01 e N-03); a persistência não está estruturalmente estabilizada até estes dois bugs serem corrigidos e N-02/N-04 serem decididos.

Nenhuma implementação realizada.
Nenhum commit.
Nenhum push.
