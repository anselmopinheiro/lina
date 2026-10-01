# LINA-15A — Audit: Ownership Fencing

**Data:** 2026-10-01  
**Âmbito:** auditoria arquitetural documental; nenhuma alteração de produção, schema, `ownership.json` ou notas do vault.  
**Baseline auditado:** `master` em `66156b7` (`docs(audit): complete post-LINA14 embeddings subsystem audit`).

## 1. Decisão executiva

**NÃO APROVADO para afirmar o invariante de fencing em tempo real.** O Lina impede correctamente o arranque de trabalho quando a decisão de ownership disponível diz que o dispositivo não é o produtor ativo. Contudo, um produtor que começa autorizado pode escrever checkpoints e publicar o par canónico de embeddings depois de ter perdido ownership ou de o epoch ter mudado. A autoridade é capturada no início, não é uma pré-condição renovada em cada fronteira de escrita.

Este é um risco **P1 / HIGH** para o contrato Single Active Producer. A correção recomendada é pequena mas transversal: uma única porta de fencing assíncrona, com epoch esperado, invocada antes de cada checkpoint, antes de publicar e antes de recovery que possa promover/restaurar artefactos.

## 2. Pergunta central e resposta

Pergunta: *um dispositivo só pode persistir/publicar embeddings enquanto a sua autoridade for actual e válida?*

**Resposta: não.** `main.ts` obtém `provenance` por `evaluateProvenance()` uma vez antes de chamar `generateEmbeddingsForChunks` (linha 2900). A geração conserva esse valor em `GenerateEmbeddingsOptions` e chama `writeEmbeddingCheckpoint` (linha 1324 de `src/index/embeddingGenerator.ts`) e `publishCanonicalEmbeddings` (linhas 904 e 1476) sem reavaliar ownership. As funções de persistência não aceitam gate, epoch esperado ou callback de autorização (`src/index/embeddingPersistence.ts`, linhas 654 e 811).

## 3. Fontes e método

Foram lidos, pela ordem funcional relevante: `AGENTS.md`; `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md`; `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md`; `docs/architecture/producer-ownership.md`; `docs/architecture/sync-foundations.md`; a auditoria global pós-LINA-14; `main.ts`; `src/device/deviceOwnership.ts`; `src/device/ownershipGate.ts`; `src/device/ownershipTransferSafety.ts`; `src/device/artifactProvenance.ts`; Worker, Scheduler, Operation Manager, coordinator, generator e persistence; e os testes de ownership, worker e persistence.

Foi também executado `git status --short` (limpo no início) e `git diff --check` no fim. Não foram feitos builds, chamadas a providers, geração de embeddings ou alterações fora deste relatório.

## 4. Contrato arquitetural aplicável

O baseline LINA-14 define Producer-Only Write e exige que revogação durante operação aborte a persistência com `not-active-producer` (`LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md`, linhas 137--143). A arquitetura de ownership separa papel de autorização e usa `.lina/ownership.json` com `activeProducerId` e epoch monotónico (`docs/architecture/producer-ownership.md`, secções 2, 5 e 6).

O contrato desejado é:

```text
persistir/publicar = producer role
                    ∧ ownership manifest legível e válido
                    ∧ activeProducerId = localDeviceId
                    ∧ epoch actual = epoch adquirido pela operação
```

Provenance documenta quem publicou; não autoriza a publicação. Um token de provenance capturado não pode substituir uma leitura actual do manifesto.

## 5. Estado Git e limites da auditoria

O checkout estava em `master`, HEAD `66156b7`, sem modificações listadas por `git status --short`. Este relatório é a única modificação desta auditoria. Não houve commit nem push.

Fora de âmbito: alterar TypeScript de produção, schemas, `ownership.json`, dados do vault, mecanismos de sync, ou recuperar automaticamente manifestos danificados.

## 6. Aquisição, renovação, verificação e perda de ownership

`evaluateOwnershipGate` valida device ID e papel; carrega o manifesto e compara produtor e, quando recebido, epoch esperado (`src/device/ownershipGate.ts`, linhas 50--119). `OwnershipGate.evaluate(expectedEpoch?)` atualiza `lastDecision`; `canPublish()` reavalia assíncronamente (`linhas 151--177`). Transfer e relinquish aplicam `expectedEpoch` antes de persistir (`src/device/ownershipTransferSafety.ts`, linhas 151--191; `src/device/deviceOwnership.ts`, linhas 270--366).

O problema está no caminho ativo: `main.ts` injeta no `EmbeddingWorker` `isAuthorizedSync()` (linhas 1487--1489), que lê somente `lastDecision` e, para producer sem decisão, devolve `true` (`ownershipGate.ts`, linhas 179--191). Não há renovação durante a operação nem invalidation por mudança externa de `.lina/ownership.json`. Os campos de lifecycle `ownershipLostDuringOperation` são observacionais: derivam snapshot/cache e não cercam os writes.

## 7. Epoch como fencing token

O serviço tem o mecanismo correcto para o token: manifestos válidos exigem epoch inteiro >= 1, e transfer/relinquish incrementam-no; transferências de preview usam `expectedEpoch`. Mas a operação de embeddings não guarda um `expectedEpoch` operacional: guarda apenas `provenance` opcional. `getProvenance()` usa `lastDecision` e `evaluateProvenance()` devolve objecto imutável, ambos sem criar uma obrigação para `writeEmbeddingCheckpoint` ou `publishCanonicalEmbeddings`.

Logo, epoch existe no modelo e na transferência, mas ainda não é um fence no limite de persistência de embeddings.

## 8. Matriz de `ownership.json` (13 casos)

| # | Estado observado | Comportamento actual | Comportamento seguro requerido |
|---:|---|---|---|
| 1 | ficheiro ausente, producer | `loadOwnership` devolve `null`; auto-claim pode criar epoch 1 | auto-claim inicial explícito e único; sem write de embeddings até decisão confirmada |
| 2 | ficheiro ausente, companion/unassigned | bloqueado por role antes de claim | manter bloqueio |
| 3 | manifesto válido, local é active, epoch corrente | autorizado | permitir apenas com epoch capturado e revalidado |
| 4 | manifesto válido, outro active | standby, bloqueado no arranque | bloquear todos os writes |
| 5 | manifesto válido, `activeProducerId:null` / relinquish | standby, bloqueado | bloquear todos os writes |
| 6 | epoch diferente do esperado | `epoch-mismatch` se parâmetro for usado | abortar operação antes de cada write |
| 7 | ficheiro vazio | `loadOwnership => null`, pode auto-claim | `invalid-ownership`; nunca auto-claim, nunca publicar |
| 8 | JSON truncado/malformado | `loadOwnership => null`, pode auto-claim | `invalid-ownership`; preservar evidência, pedir recuperação explícita |
| 9 | JSON válido mas schema/campos inválidos | `loadOwnership => null`, pode auto-claim | `invalid-ownership`; bloquear |
| 10 | schema futuro/desconhecido | `loadOwnership => null`, pode auto-claim | `unsupported-ownership-schema`; bloquear |
| 11 | leitura/adapter falha | `loadOwnership => null`, pode auto-claim | `ownership-unreadable`; bloquear e diagnosticar |
| 12 | manifesto muda para outro produtor durante geração | sem fence de checkpoint/publicação | abortar antes do próximo checkpoint e antes de publicar |
| 13 | manifesto muda de epoch mantendo o mesmo produtor | sem `expectedEpoch` no write | abortar como `epoch-mismatch`; exigir nova operação |

As linhas 148--171 de `deviceOwnership.ts` explicam a colapsagem 1/7/8/9/10/11 em `null`. As linhas 76--89 de `ownershipGate.ts` tratam esse `null` como elegível para auto-claim. Esta é a causa de F-02, não uma hipótese.

## 9. Corridas multi-dispositivo

O protocolo de transferência tem revalidação de epoch, pelo que preview obsoleto não deve transferir autoridade silenciosamente. Isso não impede a corrida seguinte:

```text
A (epoch 7) inicia geração -> captura provenance A/7
B transfere authority -> ownership passa B/8
A continua batches -> grava checkpoint ou promove embeddings/manifesto A/7
```

O sync não fornece lock distribuído. Portanto a única defesa local possível e necessária é compare-and-fence junto de cada write. Mesmo após o fence, dois dispositivos offline podem divergir até receberem sync; a proposta não promete consenso instantâneo, apenas impede que um nó que já observou a revogação publique de novo e impede publicação quando a leitura actual já não confirma o seu token.

## 10. Fronteiras de escrita auditadas

1. Arranque: `EmbeddingWorker.requestGeneration()` bloqueia conforme capability/decisão no início (`embeddingWorker.ts`, linhas 268--293), mas a porta é síncrona/cacheada no wiring de `main.ts`.
2. Checkpoint: `embeddingGenerator.ts` chama `writeEmbeddingCheckpoint` após batches (linhas 1306--1331). Não há gate.
3. Publicação normal e publish-only: `publishPlannedEmbeddingRecords` e a fase final chamam `publishCanonicalEmbeddings` sem fence (linhas 896--911 e 1471--1483).
4. Purge/reconciliação: `purgeOrphanEmbeddingRecords` pode republicar ou remover canónico (`embeddingPersistence.ts`, linhas 989--1085); recebe provenance opcional, não autoridade.
5. Recovery: `generateEmbeddingsForChunks` chama `recoverEmbeddingPersistenceArtifacts` antes do planeamento (`embeddingGenerator.ts`, linha 984), sem gate. Recovery pode promover/restore ficheiros.
6. Binary handoff só é chamado após resultado de publicação com sucesso, mas inheritirá um publication potencialmente não autorizado.

## 11. Persistência, publicação e recovery

Há boa robustez de integridade: temporários, backups, validação e rollback em checkpoints e publicação (`embeddingPersistence.ts`, linhas 654--776 e 811--975); os testes cobrem truncagem, rollback e recuperação. Essa atomicidade protege o par de ficheiros contra interrupção local. Não protege autorização: as APIs aceitam `app`, dados e metadata, mas não uma autorização actual nem epoch esperado.

Recovery também é uma operação de mutação e deve passar pelo mesmo fence. A regra deve ser uniforme: uma recuperação que promove/restaura artefactos partilhados requer autoridade actual; um diagnóstico read-only não requer.

## 12. Provenance

`ArtifactProvenance` valida device, epoch e timestamp (`artifactProvenance.ts`, linhas 18--67). A publicação inclui provenance somente se for válido (`embeddingPersistence.ts`, linhas 777--808), logo a ausência não falha fechada. Como `options.provenance` é opcional (`embeddingGenerator.ts`, linha 93), o pipeline pode publicar sem provenance se a reavaliação inicial não a produzir.

Recomendação: o fence devolve um token `{ deviceId, epoch }`; esse token cria provenance no instante de cada promoção, e publication/checkpoint falham se o token não puder ser renovado. Provenance continua metadata, não um selo de autorização reutilizável.

## 13. Cobertura de testes actual

Positivo: testes de ownership cobrem active/standby/roles/epoch mismatch e auto-claim de manifesto ausente (`tests/device/ownershipGate.test.ts`, linhas 18--111); testes de serviço validam manifesto inválido e `loadOwnership => null` (`tests/device/deviceOwnership.test.ts`, linhas 73--170); testes de worker bloqueiam start standby (`tests/maintenance/workerOwnershipGating.test.ts`); e persistence cobre atomicidade/rollback/recovery (`tests/index/embeddingPersistence.test.ts`, secções checkpoint e canonical publication).

Lacunas materiais:

- não há teste que simule perda de ownership entre batches e checkpoint;
- não há teste de troca de epoch entre start e publicação;
- não há teste que manifeste vazio/truncado/inválido/futuro não possa ser auto-claimed;
- não há contrato de gate em `embeddingPersistence`;
- não há teste de recovery bloqueado por ownership;
- não há teste que prove absence de provenance bloqueia publicação de producer path;
- não há teste de invalidation de `lastDecision` em alteração externa do manifesto.

## 14. Findings

| ID | Severidade | Evidência | Impacto |
|---|---|---|---|
| L15A-F01 | HIGH / P1 | provenance é capturada uma vez (`main.ts:2900`); checkpoints/publicação não têm gate (`embeddingGenerator.ts:1324, 1476`; `embeddingPersistence.ts:654,811`) | produtor revogado pode persistir/publicar artefactos partilhados |
| L15A-F02 | HIGH / P1 | `loadOwnership` colapsa inexistente, vazio, inválido e erro em `null`; gate auto-claim em `null` | corrupção/truncagem pode ser sobrescrita por epoch 1, apagando evidência e fencing prévio |
| L15A-F03 | MEDIUM / P2 | Worker/Scheduler usam `isAuthorizedSync()` cacheado; sem watcher/invalidation externo | start e estado runtime podem usar autorização obsoleta; ausência de decisão de producer falha aberta |
| L15A-F04 | MEDIUM / P2 | purge e recovery escrevem/promovem sem gate de persistência | caminhos auxiliares podem contornar o contrato producer-only |
| L15A-F05 | MEDIUM / P2 | provenance é opcional e publication a omite silenciosamente | diagnóstico e auditoria de artefacto tornam-se ambíguos |

## 15. Risco e priorização

F01 e F02 bloqueiam qualquer alegação de que o epoch é um fencing token aplicado a embeddings. São P1 porque afetam integridade da fonte partilhada, não apenas UI. F03--F05 devem seguir no mesmo trabalho, pois uma solução parcial no Worker deixaria os limites de persistence/recovery acessíveis sem contrato.

## 16. Alternativas consideradas

1. **Cancelar só por evento de vault:** insuficiente; eventos podem atrasar/perder-se e não cercam uma rename já iniciada.
2. **Confiar no `isAuthorizedSync()`:** insuficiente; é cache e deliberadamente não recebe epoch esperado.
3. **Inserir check só no Worker antes da geração:** insuficiente; há janela longa até checkpoint/publicação e há outros writers.
4. **Lock distribuído/lease externo:** aumenta escopo e continua dependente do transporte sync; não é necessário para este primeiro fence local.
5. **Porta central de fence no boundary de persistence:** **recomendada**. É testável, aplicável a todos os writers e preserva o modelo actual.

## 17. Recomendação arquitetural

Introduzir uma porta mínima, injectada e sem I/O escondido, por exemplo `OwnershipFence.assertCurrent(expected: { deviceId, epoch }): Promise<OwnershipFenceResult>`. A implementação lê e classifica o manifesto actual, com auto-claim desativado, e só devolve sucesso se role, active producer e epoch coincidirem. Resultados são tipados: `authorized`, `ownership-missing`, `ownership-invalid`, `ownership-unreadable`, `unsupported-schema`, `not-active-producer`, `epoch-mismatch`.

Ao começar operação, obter token por avaliação explícita. Antes de cada checkpoint, antes de recovery mutável, imediatamente antes da primeira rename de publicação e antes de qualquer purge/removal, chamar o fence com o token. Resultado não autorizado: não escrever, abortar com `not-active-producer` ou razão segura, manter checkpoint anterior intacto e não iniciar binary handoff. A validação deve voltar a ocorrer no instante mais próximo possível da promoção; não pode ser apenas antes de preparar temporários.

## 18. Batches de implementação propostos

### Batch A — leitura/classificação de ownership (P1)

Separar resultado de `loadOwnership`: `missing`, `invalid-content`, `unsupported-schema`, `unreadable`, `valid`. Auto-claim só para `missing` confirmado. Testes de 13 estados, incluindo vazio, truncado, schema futuro e erro do adapter.

### Batch B — contrato de fence e operação (P1)

Criar token/porta de fence; capturar epoch no arranque; substituir o uso operacional de `isAuthorizedSync()` no caminho de embeddings por check assíncrono actual; fazer a operação terminar deterministicamente com estado/diagnóstico seguro.

### Batch C — persistence/recovery/purge (P1)

Adicionar fence obrigatório às funções mutantes de checkpoint, publication, recovery e purge. Manter leitores e diagnósticos read-only livres de gate. Garantir que a chamada ocorre antes de cada promotion/delete e que não se criam temporários depois de uma falha de fence quando tal for evitável.

### Batch D — lifecycle, diagnostics e regressão (P2)

Invalidar decisões cacheadas em mudança local e refresh externo; expor apenas razão não sensível; assegurar que scheduler/worker não tratam ausência de decisão como autorização. Atualizar docs/architecture e testes integrados.

## 19. Critérios de aceitação

- [ ] Manifesto ausente pode iniciar claim explícito; manifesto existente vazio, inválido, truncado, futuro ou ilegível nunca é auto-claimed.
- [ ] Cada write partilhado de embeddings requer device ID e epoch que coincidam com manifesto actual.
- [ ] Troca A/7 para B/8 entre batches não cria checkpoint novo por A nem publica A/7.
- [ ] Mudança A/7 para A/8 também bloqueia a operação A/7.
- [ ] Falha de fence não remove/renomeia canónico existente, não apaga checkpoint válido e não inicia binary handoff.
- [ ] Recovery/purge mutáveis obedecem ao mesmo fence; diagnóstico e pesquisa continuam read-only.
- [ ] Publication proveniente de producer path contém provenance válida, associada ao token autorizado.
- [ ] Companion e standby continuam sem escrita; o caminho existente de transferência com `expectedEpoch` mantém-se.
- [ ] Testes determinísticos cobrem as 13 condições, races antes de checkpoint/publicação, rollback e stale completion.
- [ ] `npm run typecheck`, testes focados e `git diff --check` passam antes de qualquer release.

## 20. Plano de testes futuro

Usar `FakeAdapter` e um barrier controlado no gerador/persistence: iniciar como A/7, suspender após batch, escrever B/8, libertar, e provar zero chamadas de rename/write canónico e resultado `not-active-producer`. Repetir para checkpoint, publish-only, recovery e purge. Acrescentar testes de regressão de auto-claim que verifiquem conteúdo original preservado para todos os estados inválidos. Não usar provider real.

## 21. Conclusão

LINA-14 consolidou correctamente a decisão de arranque e a atomicidade de publicação, mas a garantia documental de *ownership fencing em tempo real* ainda não está implementada no percurso activo. O próximo passo seguro é LINA-15A-Batch A--C; não é recomendável declarar a fase concluída, nem expandir automação multi-device, antes de esses fences e os testes de corrida ficarem verdes.

## 22. Registo de validação desta auditoria

- `git status --short` antes da alteração: sem saída.
- `git diff --check`: executado após criação deste relatório, sem erros.
- Não foram executadas chamadas de provider, geração de embeddings, mutações de vault, commit ou push.
