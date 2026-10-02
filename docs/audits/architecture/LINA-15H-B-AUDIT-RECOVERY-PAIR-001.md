# LINA-15H-B-A — AUDITORIA: RECOVERY NO ARRANQUE E VALIDAÇÃO DO PAR CANÓNICO

> **Fase:** LINA-15H-B (parte A: auditoria; **sem implementação**) · **Data:** 2026-10-02 · **Branch:** `master` · **Base:** `89b4764`
> **Prompt-mestra:** `PROMPT-MESTRA-LINA-004` não existe no repositório (registado em 15D-A); prevalecem `AGENTS.md` e `docs/`.
> **Legenda:** **FACTO** (código ou probe) · **INFERÊNCIA** · **HIPÓTESE** · **RECOMENDAÇÃO**.
> **Probes** (scratchpad fora do repositório, código de produção real, `FakeAdapter`/adaptador em memória, sem providers nem embeddings reais): `p1`, `p1b`, `p2` (15H-A, reutilizados), **`p3`** (binário sobre par inconsistente) e **`p4`** (classificação do lifecycle por cenário).
> Nenhum ficheiro de produção, teste, schema ou `data.json` foi alterado.

---

## 1. Objetivo

Determinar, antes de implementar, como o Lina deve: detetar publicações incompletas no arranque; validar o par canónico; distinguir ausência/corrupção/truncagem/inconsistência; recuperar de crash; impedir que uma publicação parcial seja tratada como válida; preservar o fencing da 15A; e convergir para o `EmbeddingLifecycleSnapshot` (15D).

## 2. Metodologia

Releitura do código atual (`embeddingPersistence.ts`, `embeddingBinaryStorage.ts`, `embeddingBinaryCopyController.ts`, `embeddingGenerator.ts`, `runtimeEmbeddingIndex.ts`, `maintenanceEngine.ts`, `binaryWorker.ts`, `reconciliationWorker.ts`, `ownershipGate.ts`, `main.ts`) para confirmar os findings P-01…P-10 da 15H-A; pesquisa explícita de chamadores de recovery; quatro probes; mapeamento de testes.

## 3. Estado atual (confirmado)

Caminho: gerador → checkpoints (`.lina/producer/checkpoints`) → staging (`.lina/producer/staging`) → `embeddings.jsonl` e `manifest.json` (em `.lina/index/`) → `publicationId` no manifesto → cópia binária derivada (`sourcePublicationId`) → `readEmbeddingStatus`/`readEmbeddingUpdatePreview` → `buildEmbeddingWorkLifecycleSnapshot` → consumidores. Os findings da 15H-A mantêm-se válidos (nada mudou em `src/index/embedding*` desde então).

## 4. Recovery atual

| Mecanismo | Arranque? | Chamador | Ownership | Escreve/apaga | Valida identidade | Valida par | Recupera auto |
|---|---|---|---|---|---|---|---|
| `recoverEmbeddingPersistenceArtifacts` (JSONL/manifest/checkpoint, limpeza de `.tmp`/backups) | **Não** | só `generateEmbeddingsForChunks` (`embeddingGenerator.ts:989`), i.e. ao iniciar uma geração | **sim** (`fence`, 1 asserção no início; recusa → `ownership-fence-rejected`) | sim (rename/remove) | provider/modelo/dimensões/contrato do manifesto | **sim** (`validateCanonicalFiles`: contagem, dimensões, duplicados, identidade, contrato) | **sim** (restaura backups válidos; completa 1.ª publicação interrompida) |
| `recoverBinaryEmbeddingPublication` | **Não** | **nenhum** em `src/`/`main.ts` (confirmado por pesquisa; só testes) | n/a | sim | digests | conjunto binário | n/a |
| `migrateBinaryArtifactsAtStartup` | **Sim** (após reconciliação de arranque) | `ReconciliationWorker.runStartupReconciliation` → `MaintenanceEngine` | `canRun("binary-copy")` + `BinaryWorker.canPublish` (sem fence) | **sim** (reconstrói a cópia binária) | **não** valida o par antes de reconstruir (ver R-02) | **não** | repara binário `absent/outdated/incomplete/invalid` por reconstrução |
| `loadEmbeddingCheckpoint` | no início de geração | gerador | herda fence do recovery | apaga checkpoint inválido | sim (identidade do checkpoint) | par checkpoint/sidecar | descarta |
| `readTextIndexStatus` | sim (estado) | vários | n/a | **não** | `generationId`/digests | sim (notes/chunks/manifest) | **não** (só classifica) |

**FACTO:** a afirmação da 15H-A está **confirmada** — `recoverBinaryEmbeddingPublication` não tem chamador de produção. **FACTO novo:** existe um escritor de arranque (`migrateBinaryArtifactsAtStartup`) que **não** é um recovery e que opera sem validar o par canónico. Para Producer e Companion não há qualquer inicialização de recovery de embeddings no arranque; o Companion nunca chega a escrever (gate/`canRun`).

## 5. Modelo do par canónico

**FACTO (por código):** o par **canónico** é `embeddings.jsonl` + `manifest.json` (secções `embeddings` e `embeddingInput`). `manifest.json` é **partilhado** com o índice textual (`saveTextIndex` preserva as secções de embeddings). O binário (`embeddings.binary.manifest.json` + `embeddings.meta.jsonl` + `embeddings.vectors.f32`) é **derivado** e só é aceite quando o seu `sourcePublicationId` coincide com o `publicationId` do manifesto (+ digests sha256 do conjunto). Checkpoints não fazem parte do par (não pesquisáveis).

Análise por combinação (lifecycle medido pelo probe **p4** com 3 chunks reais e identidade alvo igual à publicada; "sem recovery"):

| Estado em disco | Leitura (`readEmbeddingStatus`) | Lifecycle | Ação | Avaliação |
|---|---|---|---|---|
| saudável (3/3) | readable, 3 válidos | **READY** | none | correto |
| **W1** JSONL novo (3) + manifest antigo (diz 2), **mesma identidade** | readable, 3 válidos | **READY** | none | **inconsistência mascarada como saudável** |
| **W1** JSONL novo + manifest antigo, **modelo diferente** | readable, 0 válidos | **INCOMPATIBLE** | rebuild (confirmação) | seguro mas sem sinalização de par; rebuild total desnecessário |
| **W2** JSONL novo + manifest ausente | manifesto `{}` ; índice textual "missing" | `NO_TEXT_INDEX` (via estado textual) | — | transitório; afeta também o índice textual |
| **W3** manifest novo (3) + JSONL antigo (2) | readable, 2 válidos, 1 em falta | **UPDATE_AVAILABLE** | update | **publicação incompleta mascarada como trabalho normal** |
| **W4** binário novo + JSONL antigo | binário rejeitado (`sourcePublicationId` ≠ `publicationId`) | READY/JSONL | none | **seguro** (cai para JSONL) |
| binário antigo + JSONL novo | idem | idem | none | seguro |
| **W5a** JSONL truncado em fronteira de linha (2 de 3) | readable, 2 válidos, 1 em falta | **UPDATE_AVAILABLE** | update | **truncagem mascarada** |
| **W5b** truncado a meio de linha | readable, 3 registos (1 inválido), 2 válidos | **UPDATE_AVAILABLE** | update | idem |
| manifest declara embeddings, JSONL ausente | `missing` | **INDEX_ONLY** | generate | aceitável (fail-closed), sem sinal de "publicação perdida" |
| todos presentes, **digest binário** diferente | binário `invalid` | JSONL | — | seguro (digest valida o binário) |

**FACTO (p3):** com **W1 + mesma identidade** e cópia binária ausente/desatualizada, o reparo de arranque (`BinaryEmbeddingCopyController.createOrUpdate`) constrói o binário a partir do **JSONL novo** com o `publicationId` do manifesto **antigo**: `status: valid, recordCount: 2`. Depois de o recovery restaurar o JSONL antigo (1 registo, `totalEmbeddings: 1`), `check()` continua `valid` com `recordCount: 2` — **o binário passa a conteúdo diferente do canónico** (R-02). O `buildCandidate` do binário só rejeita provider/modelo/dimensões diferentes, não contagem.

## 6. Identidade da publicação

| Conceito | Onde existe hoje | Observação |
|---|---|---|
| Identidade do embedding | `embeddings{provider,model,dimensions}`, `embeddingInput{version,prefixMode}`, `vectorContract` (+`contractId`) no manifesto; por registo `provider/model/dimensions/embeddingInputHash` | define o espaço vetorial |
| **Identidade da publicação** | `manifest.embeddings.publicationId` (`emb-<tempo>-<aleatório>`, regenerado em cada `publishCanonicalEmbeddings`) | marcador de commit usado **só** pela cópia binária e pela cache runtime |
| Ownership epoch | `provenance{producerDeviceId, producerEpoch, generatedAt}` (informativo, não validado contra o JSONL) | ≠ publicação |
| Contagem | `embeddings.totalEmbeddings` (escrito sempre; lido só em `validateCanonicalContent`) | não validado na leitura |
| Digest/tamanho | **binário:** sha256 + bytes; **JSONL: nenhum** | JSONL só tem `canonicalMtime/size` na identidade da cache runtime |

**Conclusão (FACTO/INFERÊNCIA):** o **JSONL não transporta nem é ligado a nenhum marcador de publicação**; a ligação ao manifesto é só por contagem (não verificada na leitura) + provider/modelo/dimensões + `textHash`/`embeddingInputHash` por registo. Dois artefactos de gerações diferentes com a **mesma identidade de embedding** são indistinguíveis ao nível do par; a segurança de pesquisa vem exclusivamente da validação **por registo**.

## 7. Decisão sobre `publicationId` / digest — alternativas

`publicationId` **já existe** no manifesto; o que falta é a ligação JSONL↔manifesto e a validação na leitura.

| Alt. | Descrição | Resolve | Schema | Retrocompat. | Companion/sync | Custo |
|---|---|---|---|---|---|---|
| **A** | Usar o que existe: validar `totalEmbeddings` (contagem de linhas), terminação por `\n`, dimensões e identidade na **leitura**; validar `recordCount` do binário contra `totalEmbeddings` | W3, W5a/b, W1 com contagem diferente, R-02 | **nenhum** | manifestos sem `totalEmbeddings` ⇒ sem verificação de contagem; JSONL legado sem `\n` final tem de continuar legível (teste existente) | Companion valida read-only; sem dependência de escrita | O(n linhas) por leitura (já se percorre o ficheiro) |
| **B** | A + campo aditivo opcional no manifesto (`embeddings.jsonlByteLength`, eventualmente `jsonlSha256`) | W1 **de mesma contagem**; truncagem a meio; swap parcial | **aditivo opcional** (sem migração; ausente ⇒ A) | total | `stat.size` é barato (mobile); sha256 de 53 MB é caro ⇒ preferir bytes | + `size` no publish |
| **C** | Marcador por linha/cabeçalho (`publicationId` no JSONL) | pareamento forte | **altera formato JSONL** (invariante: "formato em disco inalterado") | quebra leitura legada | afeta todos os leitores | **não recomendado** |

**HIPÓTESE (a validar na implementação):** A basta para eliminar F-10 (truncagem/contagem) e R-02; B é necessário apenas para o caso residual "gerações diferentes, mesma contagem e mesma identidade", já coberto por validação por registo. **Evidência atual insuficiente para escolher B de forma definitiva**; recomenda-se **A como alteração mínima**, com B (apenas `jsonlByteLength`) como extensão opcional decidida na 15H-B-IMPLEMENT.

## 8. Crash matrix

| # | Estado em disco | Deteção no arranque (hoje) | Classificação factual (hoje) | Lifecycle (hoje) | Recovery possível |
|---|---|---|---|---|---|
| **W1** | JSONL novo + manifest antigo (+ `embeddings.publish.backup`, `manifest.publish.tmp`) | nenhuma | readable | **READY** (mesma id.) / INCOMPATIBLE (modelo diferente) | `recoverEmbeddingPersistenceArtifacts` restaura o par antigo (sem avisos; p1b) — **só em nova geração** |
| **W2** | JSONL novo + manifest ausente (+ `manifest.publish.backup`/`tmp`) | nenhuma | índice textual "missing" | `NO_TEXT_INDEX` | restaura o par antigo (p1) |
| **W3** | manifest novo + JSONL antigo | nenhuma | readable | **UPDATE_AVAILABLE** | só por entrega de sincronização (não é produzível localmente); sem backups ⇒ **nenhum recovery** possível |
| **W4** | binário novo + JSONL antigo | `check` ⇒ `outdated` | binário rejeitado | JSONL | `migrateBinaryArtifactsAtStartup` reconstrói (**sem validar o par**, R-02) |
| **W5** | JSONL truncado | nenhuma | readable (linha) / invalid (meio) | **UPDATE_AVAILABLE** | nenhuma; só nova geração incremental |
| **W6** | binário incompleto/parcial | `check` ⇒ `incomplete/invalid` | rejeitado | JSONL | reparo de arranque por reconstrução; **sem chamar `recoverBinaryEmbeddingPublication`**; tmp/backups ficam até próxima publicação |
| **W7** | `.tmp` órfão | nenhuma | ignorado pelos leitores | inalterado | só em recovery de geração (nomes conhecidos) |
| **W8** | publicação interrompida | = W1/W2 | — | — | idem |
| **W9** | ownership perdido durante recovery | `fence.assertCurrent()` **uma vez** no início; passos seguintes (renames/removes) **sem nova asserção** (R-05) | — | — | outro Producer repete o recovery |

## 9. Política de recovery recomendada

| Estado | Recovery automático (Producer ativo, com fence + coordenador) | Bloquear geração/publicação | Preservar antigo | Descartar novo |
|---|---|---|---|---|
| ausência (nada publicado) | n/a | não | n/a | n/a |
| `.tmp`/backup órfão **com canónico válido** | **sim** (limpar nomes conhecidos) | não | sim | sim (tmp) |
| par inconsistente **com backup válido** | **sim** (restaurar o par antigo, como hoje) | até concluir | **sim** | sim (candidato não publicado) |
| par inconsistente **sem backup** (ex.: sincronizado) | **não** (não destruir): classificar `canonical-pair-inconsistent` | **sim** para publicar incremental; permitir rebuild confirmado | sim | só por ação explícita |
| JSONL truncado | **não** apagar | idem | sim | n/a |
| binário incompleto | sim (reconstruir/limpar derivado; nunca toca no canónico) | não | sim (JSONL) | sim |
| identidade incompatível | não (é caso de plano: rebuild confirmado, 15B) | não | sim | n/a |
| corrupção de JSONL (linhas inválidas) | não | sim | sim | só por rebuild confirmado |

"Reconstruir" não é a resposta por defeito: recuperar restaura o último par **válido**; só ausência de qualquer par válido leva a `INDETERMINATE`/rebuild sob confirmação. Companion: **nunca** recovery destrutivo (apenas classificação read-only).

## 10. Ownership / fencing

**FACTO:** `acquireFence()` devolve `undefined` a Companion/standby/unassigned e **nunca faz auto-claim** (`autoClaimIfUnclaimed:false` em `assertFence`); `recoverEmbeddingPersistenceArtifacts` sem fence válida devolve `ownership-fence-rejected` e não escreve; diagnóstico/leitura (`readEmbeddingStatus`, `validateCanonicalEmbeddingIndex`) não exigem ownership e não escrevem. **Lacunas:** (i) o recovery só tem **uma** asserção de fence (`embeddingPersistence.ts:549`) — publicação e checkpoint reafirmam antes de cada rename, o recovery não; (ii) um recovery **no arranque** teria de **adquirir o `IndexWriteCoordinator`** (hoje só é chamado dentro de uma geração que já o detém); (iii) o reparo binário de arranque não usa fence (só `canPublish`). O recovery não passa pelo Operation Manager: tem de ser tratado como **escritor de manutenção** sob o coordenador, nunca como geração.

## 11. Lifecycle

**FACTO (p4):** hoje uma inconsistência física aparece como **READY** (W1 mesma identidade) ou **UPDATE_AVAILABLE** (W3, W5) — exatamente o mascaramento que a política não admite. **RECOMENDAÇÃO:** introduzir um facto de leitura `canonicalPairState` (`consistent | inconsistent | truncated | unverifiable-legacy`) em `EmbeddingWorkSummary` e mapeá-lo no adaptador (sem criar fonte de verdade nova, regra 15D) para:

| Facto | Estado | Justificação |
|---|---|---|
| `consistent` / `unverifiable-legacy` | os atuais (READY, UPDATE_AVAILABLE, …) | compatibilidade |
| `inconsistent` ou `truncated`, **com** backup recuperável | `INDETERMINATE` (reason `canonical-pair-recoverable`) até o recovery correr | fail-closed no gate; Producer recupera |
| `inconsistent`/`truncated`, **sem** backup | `INCOMPATIBLE` com `plan.mode = full-rebuild` e razão `canonical-pair-inconsistent` (rebuild **sob confirmação**, nunca auto-dispatch) | alinha-se à 15B/15C |
| ficheiro válido mas acima do limite | **`resource-limit-exceeded` inalterado** (15C) | distinto de corrupção |
| ilegível (erro de I/O) | `INDETERMINATE` (inalterado) | idem |

`ERROR` fica reservado a falha de operação (não a estado em disco). `READY`/`UPDATE_AVAILABLE` não podem ocorrer com `canonicalPairState ∈ {inconsistent, truncated}`.

## 12. Resource limits (15C)

**FACTO:** `readCanonicalEmbeddingFileState` decide `resource-limit-exceeded` pelo `stat.size` **antes** de ler; a validação de contagem/terminação só pode correr em ficheiros dentro do limite de ponte. **Requisito:** a validação de par nunca lê um ficheiro acima do limite (usar `stat.size` + `totalEmbeddings` e, se existir, `jsonlByteLength`); acima do limite → manter `resource-limit-exceeded` (não `truncated`/corrompido).

## 13. Sincronização (qualquer mecanismo)

| Ordem de chegada | Estado resultante no recetor | Seguro? |
|---|---|---|
| JSONL antes do manifest | W1/W3-like (JSONL novo + manifest antigo) | hoje: READY/INCOMPATIBLE sem sinal ⇒ **parcialmente** (pesquisa protegida por validação por registo) |
| manifest antes do JSONL | W3 | hoje UPDATE_AVAILABLE ⇒ trabalho enganoso no Producer; Companion só lê |
| binário antes de JSONL/manifest | `sourcePublicationId` ≠ manifest ⇒ rejeitado | **sim** |
| `.tmp` antes | ignorado | **sim** |
| versões antigas coexistem | par antigo coerente | **sim** |
| conflito escolhe versões diferentes por ficheiro | par inconsistente | depende de A/B (§7) |

O Lina só fica garantidamente seguro durante a convergência se classificar o par (§11); sem isso, o recetor mostra estados normais para um par transitório. Nenhum mecanismo específico é assumido.

## 14. Testes existentes e lacunas

Existentes: `embeddingPersistence.test.ts` (67; rollback, backup, ordem, recovery de backup e de 1.ª publicação, idempotência, ficheiros desconhecidos, fence), `embeddingBinaryStorage.test.ts` (19, incl. recovery), `embeddingBinaryCopyController.test.ts` (12), `ownershipGate.test.ts`, 15B/15C/15D (plano↔snapshot, resource-limit, fonte de snapshot). **Lacunas:** (a) crash entre os dois renames e observação do par/lifecycle (W1/W2); (b) truncagem em fronteira de linha e contagem-vs-manifesto na leitura; (c) binário construído sobre par inconsistente (R-02); (d) recovery **no arranque** (não existe) e sob coordenador; (e) re-asserção de fence durante recovery; (f) lifecycle para `canonicalPairState`; (g) W3 por sincronização; (h) Companion nunca escreve em recovery; (i) JSONL legado sem `\n` final continua legível (existe teste que fixa isto ⇒ restrição).

## 15. Findings

| ID | Sev. | Título / evidência | Localização | Impacto / condição | Recomendação |
|---|---|---|---|---|---|
| **R-01** | MEDIUM | Sem recovery de embeddings no arranque (**FACTO**) | `embeddingGenerator.ts:989` único chamador | par inconsistente/órfãos persistem até nova geração | recovery de arranque do Producer, sob fence + coordenador |
| **R-02** | **MEDIUM** | Binário derivado de par inconsistente é `valid` e sobrevive ao recovery com conteúdo diferente (**FACTO, p3**) | `embeddingBinaryCopyController.ts:runWrite/checkInternal`; `buildCandidate` | só com W1 de mesma identidade + reparo de arranque/rebuild antes do recovery; serve vetores de outra geração (por registo continuam validados por hash) | validar `recordCount === totalEmbeddings` e par canónico antes de reconstruir e em `check`; reparo de arranque só com par `consistent` |
| **R-03** | MEDIUM | Lifecycle mascara pares inconsistentes como READY/UPDATE_AVAILABLE (**FACTO, p4**) | `readEmbeddingStatus` → `buildEmbeddingWorkLifecycleSnapshot` | custo/ação enganosos (update externo para chunks já presentes antes da truncagem) | `canonicalPairState` (§11) |
| **R-04** | MEDIUM | Leitores não validam contagem/terminação (= P-03; **FACTO**) | `readCanonicalEmbeddingFileState`, `parseJsonlRecords`, `parseManifestEmbeddingInfo` | truncagem em fronteira de linha invisível | Alt. A (§7) |
| **R-05** | LOW | Recovery com uma única asserção de fence antes de vários renames/removes (**FACTO**) | `embeddingPersistence.ts:540-610` | janela TOCTOU maior que a da publicação | reafirmar fence antes de cada mutação |
| **R-06** | LOW | Recovery restaura backup descartando a geração nova (não perde checkpoint) e não corre sob coordenador fora de uma geração (**FACTO/INFERÊNCIA**) | idem | trabalho de geração repetido; concorrência com purge (P-04) | coordenador no recovery de arranque; manter checkpoint |
| **R-07** | LOW | `recoverBinaryEmbeddingPublication` sem chamador; tmp/backups binários só desaparecem na próxima publicação (**FACTO**) | `embeddingBinaryStorage.ts:559` | resíduos; sem efeito em leitores | chamar sob fence no arranque ou remover |
| **R-08** | INFO | `resource-limit-exceeded` preservado como estado distinto (15C) | `readCanonicalEmbeddingFileState` | — | manter na validação de par |
| **R-09** | INFO | JSONL legado sem `\n` final tem de continuar legível (teste existente) | `embeddingPersistence.test.ts` | restringe a regra de terminação | exigir `\n` só quando `totalEmbeddings` existir e houver `jsonlByteLength`/publicação nova |

## 16. Proposta de implementação (15H-B-IMPLEMENT)

1. **Facto de leitura** `canonicalPairState` num módulo puro (`inspectCanonicalPair`), usando `stat` + (dentro do limite) leitura: contagem de linhas vs `totalEmbeddings`, terminação, dimensões, identidade provider/modelo, `publicationId` presente; `unverifiable-legacy` quando faltam `totalEmbeddings`/`publicationId`.
2. **Propagar** para `EmbeddingWorkSummary` e mapear no adaptador (`INDETERMINATE`/`INCOMPATIBLE` conforme §11); sem tocar no Scheduler/Worker/Manager além do que o snapshot já dita.
3. **Recovery de arranque do Producer ativo**: após a reconciliação de arranque e **antes** do reparo binário; adquirir fence + coordenador; chamar `recoverEmbeddingPersistenceArtifacts` (com fence reafirmada por passo); nunca auto-claim; Companion só classifica.
4. **Binário:** validar `recordCount === totalEmbeddings` e par `consistent` em `check`/`runWrite`; reparo de arranque só com par consistente; chamar `recoverBinaryEmbeddingPublication` sob fence (ou documentar remoção).
5. **Sem alterar** formato JSONL, `data.json`, ownership, nem criar schema obrigatório; `jsonlByteLength` (Alt. B-lite) opcional/aditivo.
6. Testes primeiro (lacunas §14); probes p1/p1b/p3/p4 convertidos em testes de caracterização.

## 17. Resposta a P-01 / P-02 / P-03

- **P-01 (par não atómico):** confirmado e **não removível** com renames sequenciais; mitigação = deteção (par) + recovery de arranque; atomicidade total exigiria alterar o modelo de publicação (fora do âmbito mínimo).
- **P-02 (recovery só em geração):** confirmado; resolvido por §16.3 (+ R-07).
- **P-03 (leitores sem validação):** confirmado; resolvido por Alt. A (§7) + §16.1; F-09 e F-10 só passam a "resolvidos" quando §18 estiver satisfeito.

## 18. Critérios de aceitação da futura 15H-B-IMPLEMENT

1. Existe recovery no arranque do Producer ativo, sob fence **reafirmada por mutação** e sob o coordenador; Companion/standby nunca escrevem; sem auto-claim.
2. `canonicalPairState` é calculado por um único módulo puro e consumido pelo snapshot; READY/UPDATE_AVAILABLE são impossíveis com par `inconsistent`/`truncated`.
3. Truncagem em fronteira de linha e contagem divergente são detetadas (p2/p4 reproduzidos em testes); ficheiros legados sem `totalEmbeddings` continuam legíveis (`unverifiable-legacy`).
4. O binário não é reconstruído nem aceite sobre par inconsistente (p3 reproduzido; `recordCount` validado).
5. `resource-limit-exceeded` e `unreadable` mantêm os estados da 15C.
6. Recovery nunca apaga sem backup válido; sem backup ⇒ classificar, não destruir; rebuild apenas sob confirmação.
7. Cobertura das lacunas (a)–(i) §14; testes 15A/15B/15C/15D/15F/15G intactos.
8. Sem alteração de schema obrigatório, `data.json`, formato JSONL ou ownership.

## 19. Respostas finais

1. **Recovery no arranque?** Não para embeddings; só existe reparo binário de arranque (sem validar o par).
2. **Par canónico:** `embeddings.jsonl` + `manifest.json`; o binário é derivado e ligado por `publicationId`.
3. **Mesma publicação?** O JSONL não carrega marcador; só contagem (não verificada na leitura), identidade e hashes por registo; o binário usa `publicationId` + digests.
4. **Janelas de crash:** §8 (W1/W2 inconsistentes; recovery só em nova geração).
5. **Ordens de sincronização:** §13; binário e `.tmp` seguros; JSONL/manifest fora de ordem ficam mascarados.
6. **Recovery protegido por ownership?** Sim (fence), mas com uma asserção só e sem coordenador fora de geração.
7. **Companion pode desencadear recovery destrutivo?** Não.
8. **Estado de lifecycle:** hoje READY/UPDATE_AVAILABLE (incorreto); alvo `INDETERMINATE`/`INCOMPATIBLE` conforme backup (§11).
9. **`publicationId` necessário?** Já existe; não é preciso novo identificador — falta **validar** o par (Alt. A), com `jsonlByteLength` opcional.
10. **Alteração mínima para F-09/F-10:** Alt. A + `canonicalPairState` no lifecycle + recovery de arranque do Producer + validação do binário (§16, §18).

## 20. Garantias desta fase

Nenhum código de produção, teste, schema ou `data.json` alterado; nenhum embedding gerado; nenhuma chamada externa; probes fora do repositório; sem commit nem push.
