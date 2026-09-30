# LINA-14F.3: Auditoria de Cutover Ativo de Worker e Operation Manager

**Documento:** `LINA-14F3-AUDIT-WORKER-OPERATION-CUTOVER-001.md`  
**Fase:** LINA-14F.3 (Cutover Ativo de EmbeddingWorker e EmbeddingOperationManager)  
**Data:** 2026-09-30  
**Estado:** Concluído / Aprovado para Implementação  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  

---

## 1. Contexto e Objetivos

Nas fases anteriores da consolidação do ciclo de vida dos embeddings (LINA-14):
- **LINA-14A:** Estabeleceu o modelo puro e imutável `EmbeddingLifecycleSnapshot`.
- **LINA-14B / B.1:** Criou o adapter canónico e validou a paridade em Shadow Mode.
- **LINA-14C:** Efetuou a migração dos consumidores de leitura (Sidebar, Diagnostics, Device Diagnostics, Semantic Capability).
- **LINA-14D / D.2:** Implementou a camada shadow do Write Path (Controller, Policy, Scheduler, Worker e Operation Manager).
- **LINA-14E:** Realizou a auditoria global autorizando o cutover gradual.
- **LINA-14F.1:** Executou o cutover ativo do Read Path / UI.
- **LINA-14F.2:** Executou o cutover ativo da coordenação do Write Path (`EmbeddingWorkStatusController`, `EmbeddingPolicyEngine`, `EmbeddingScheduler`).

O objetivo da presente fase **LINA-14F.3** é efetuar o cutover ativo da camada de execução física e controlo de operações:
1. **`EmbeddingWorker`** (`src/maintenance/embeddingWorker.ts`)
2. **`EmbeddingOperationManager`** (`src/index/embeddingOperationManager.ts`)
3. **Integração com `MaintenanceEngine`** (`src/maintenance/maintenanceEngine.ts`)

A meta é garantir que:
$$\text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{EmbeddingWorker / OperationManager}$$
seja o fluxo canónico e exclusivo de tomada de decisão operacional para:
- Elegibilidade de início de geração/atualização (`canStart`);
- Autorização e proteção atómica de cancelamento (`canCancel`);
- Autorização controlada de retry após falha (`canRetry`);
- Fencing estrito contra perda de ownership em voo (`ownershipLostDuringOperation`);
- Coordenação segura de locks e single-flight com `IndexWriteCoordinator`.

---

## 2. Análise Estrutural e Arquitetural dos Componentes

### 2.1 `EmbeddingWorker` (`src/maintenance/embeddingWorker.ts`)

| Responsabilidade | Comportamento Atual / Legado | Comportamento Canónico (LINA-14F.3) | Ação de Migração |
| :--- | :--- | :--- | :--- |
| **Verificação de Capacidade e Autoridade** | Validações pontuais booleanas: `canGenerateEmbeddings()`, `canPublish()`, `isTextIndexBusy()`. | Derivado da decisão canónica: `decision.applicable`, `decision.canExecute`, `decision.blockedReason`. Suporta injeção de `getLifecycleSnapshot` / `evaluateDecision`. | Unificar verificação na decisão canónica, mantendo portas de capabilities para retrocompatibilidade. |
| **Início de Execução (`requestGeneration`)** | Verifica `operationManager.getState()` e `isTextIndexBusy()`, adquire reserva no `IndexWriteCoordinator`. | Valida autoridade via decisão canónica (`canStart` / `decision.canExecute`). Rejeita nós Standby e Companion com `"not-active-producer"` ou `"not-capable"`. Bloqueia em `INDETERMINATE`. | Ligar a `evaluateOperationDecisionFromSnapshot` / `deriveEmbeddingWritePathDecision`. |
| **Coordenação de Escrita e Locks** | Utiliza `IndexWriteCoordinator` (`requestPreparation`, `drainTextIndex`, `startGeneration`, `finish`, `cancelPreparation`). | Preservar integralmente o protocolo de coordenação com índice textual. Single-flight garantido. | **Preservar 100% Intacto**. |
| **Notificação de Estado e Erros** | Notifica via `statusNotifications` (`idle`, `running`, `error`). | Mantém atualização síncrona/reativa sem introduzir polling ou timers. | **Preservar**. |
| **Handoff Binário Pós-Publicação** | Invoca `binaryHandoff.maintainAfterPublication(result.publicationId)` após sucesso confirmado. | Mantém o handoff estritamente desacoplado pós-publicação atómica. | **Preservar**. |

### 2.2 `EmbeddingOperationManager` (`src/index/embeddingOperationManager.ts`)

| Responsabilidade | Comportamento Atual / Legado | Comportamento Canónico (LINA-14F.3) | Ação de Migração |
| :--- | :--- | :--- | :--- |
| **Single-Flight e Reentrância** | Bloqueia novas operações com `already-running` se `activePromise` existir. | Mantém proteção single-flight incondicional. | **Preservar**. |
| **Transições de Fase** | Fases: `preparing`, `waiting-for-text-index`, `validating`, `generating`, `persisting`, `completed`, `failed`, `cancelled`. | Alinhado com `ProcessPhase` do `EmbeddingLifecycleSnapshot`. | **Preservar / Reforçar**. |
| **Proteção de Cancelamento** | Permite cancelamento se `status === "running"`. | Cancelamento atómico seguro: durante fases não-interrompíveis (`persisting`, `finalizing`), a operação é protegida contra cancelamento destrutivo (`process.cancellable = false`). Retorna `"non-cancellable"` ou processa transição segura. | **Integrar regra de atomicidade canónica**. |
| **Gestão de Progresso e Métricas** | Clamp de chunks, percentagem e contadores (`processedChunks`, `generatedChunks`, `failedChunks`, `reusedChunks`). | Mantém sanitização e clamps robustos. | **Preservar**. |
| **Disposição e Cleanup** | `dispose()` aborta controlador ativo e limpa subscritores de forma idempotente. | Idempotente e seguro. | **Preservar**. |

### 2.3 `MaintenanceEngine` (`src/maintenance/maintenanceEngine.ts`)

| Responsabilidade | Análise de Interação | Classificação |
| :--- | :--- | :--- |
| **Preempção Manual do Scheduler** | `preemptEmbeddingSchedulerForManual()` quando `origin !== "automatic"`. | Preservar. |
| **Encaminhamento de Request** | Delega em `embeddingWorker.requestGeneration(origin, onProgress)`. | Canónico via worker. |
| **Cancelamento** | Delega em `embeddingWorker.cancelActiveOperation()`. | Canónico via worker/operationManager. |
| **Autorização de Publicação** | `canPublish()` delega em gate de ownership. | Alinhado com snapshot write authority. |

---

## 3. Matriz de Estados do Ciclo de Vida e Regras de Execução

| Estado Canónico (`primary`) | Ação Canónica (`action`) | `canStart` | `canCancel` | `canRetry` | Comportamento de Execução |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **`READY`** | `none` | `false` | `false` | `false` | Sem trabalho pendente. Nenhuma execução disparada. |
| **`UPDATE_AVAILABLE`** | `update` | `true` | `false` | `false` | Atualização incremental autorizada. Pesquisa existente preservada durante execução. |
| **`INDEX_ONLY`** | `generate` | `true` | `false` | `false` | Geração inicial de embeddings autorizada para Active Producer. |
| **`INCOMPATIBLE`** | `rebuild` | `false`* | `false` | `false` | Rebuild exige confirmação explícita do utilizador. Bloqueado para início automático (`canStart = false` sem confirmação). |
| **`UPDATING`** | `cancel` / `none` | `false` | `true` (fases cancellable) | `false` | Operação em curso. Não-reentrante (`already-running`). Cancelamento autorizado exceto em `persisting`. |
| **`CANCELLING`** | `none` | `false` | `false` | `false` | Transição de cancelamento em progresso. Bloqueia novas requisições e cancelamentos repetidos (`already-cancelling`). |
| **`ERROR`** | `retry` | `false` | `false` | `true` | Retry controlado e autorizado após erro; respeita backoff. |
| **`INDETERMINATE`** | `none` | `false` | `false` | `false` | Bloqueia incondicionalmente qualquer execução automática ou não-confirmada. |
| **`Companion` (Role)** | `none` | `false` | `false` | `false` | Dispositivo de leitura pura. Execução bloqueada com `not-capable` / `not-active-producer`. |
| **`Standby` (Producer)** | `none` | `false` | `false` | `false` | Produtor em standby sem lock de escrita. Execução bloqueada com `not-active-producer`. |

---

## 4. Garantias de Segurança Operacional

1. **Producer-Only Write:** Dispositivos sem autoridade de escrita ativa (`isCompanion` ou `isStandby`) são rejeitados de forma síncrona antes de qualquer reserva de recursos.
2. **Companion Isolation:** Dispositivos companion nunca iniciam workers de geração e têm todas as mutações físicas bloqueadas.
3. **Standby sem Escrita:** Dispositivos standby preservam estado e rejeitam requisições sem afetar a estabilidade da réplica.
4. **Zero Silent Fallback:** Estados indeterminados ou erros não revertem silenciosamente para `idle` ou operações cegas.
5. **Single-Flight e Locks:** `EmbeddingOperationManager` impede concorrência física local; `IndexWriteCoordinator` garante coordenação atómica com o índice textual.
6. **Atomicidade da Publicação:** Durante a fase `persisting`, o cancelamento não pode corromper a transação JSONL canónica em disco.
7. **Fencing contra Perda de Ownership:** Se a autoridade de escrita for revogada durante uma execução ativa, o estado é sinalizado como `ownershipLostDuringOperation`.

---

## 5. Plano de Implementação da Fase LINA-14F.3

1. **Migração do `EmbeddingWorker` (`src/maintenance/embeddingWorker.ts`):**
   - Integrar suporte a snapshot/decisão canónica via `getLifecycleSnapshot` / `evaluateDecision` nas options.
   - Refatorar `requestGeneration` para derivar elegibilidade a partir de `evaluateOperationDecisionFromSnapshot(snapshot)` ou das portas canónicas de autoridade.
   - Tratar explicitamente `INDETERMINATE`, `INCOMPATIBLE`, `STANDBY`, `COMPANION`, `ERROR`.
   - Garantir coerência com os resultados de status (`not-capable`, `not-active-producer`, `already-running`, `text-index-busy`, `accepted`).

2. **Migração do `EmbeddingOperationManager` (`src/index/embeddingOperationManager.ts`):**
   - Integrar verificação de cancelabilidade baseada na fase do processo (`persisting` / `finalizing` não são interrompíveis).
   - Suportar resultado seguro de cancelamento (`non-cancellable` quando a operação atingiu o ponto de não-retorno atómico).

3. **Criação da Suíte de Testes Canónica (`tests/maintenance/embeddingOperationLifecycleCutover.test.ts`):**
   - Cobrir rigorosamente os 13 cenários obrigatórios:
     1. `READY` (sem operação; ação none);
     2. `UPDATE_AVAILABLE` (update autorizado);
     3. `INDEX_ONLY` (geração inicial);
     4. `INCOMPATIBLE` (rebuild com confirmação obrigatória);
     5. `ERROR` (retry controlado);
     6. `Companion` (bloqueado sem escrita);
     7. `Standby` (bloqueado sem escrita);
     8. `INDETERMINATE` (execução automática bloqueada);
     9. Geração em curso (`already-running` / single-flight);
     10. Cancelamento (transição segura e proteção em persisting);
     11. Retry (autorização pós-falha);
     12. Perda de ownership (sinalização `ownershipLostDuringOperation`);
     13. Divergência legado/canónico (validação de paridade e regras estritas).

4. **Validação Completa de Qualidade:**
   - `npm test` (garantir 100% de passagem em todos os testes do repositório);
   - `npm run typecheck`;
   - `npm run lint:obsidian:strict`;
   - `npm run build`;
   - `npm run release-check`;
   - `git diff --check`.

5. **Relatório de Implementação e Documentação:**
   - Criar `docs/audits/architecture/LINA-14F3-IMPLEMENT-WORKER-OPERATION-CUTOVER-001.md`.
   - Atualizar `AGENTS.md` e `CHANGELOG.md`.
