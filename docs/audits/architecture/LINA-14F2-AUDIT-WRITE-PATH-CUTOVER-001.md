# LINA-14F.2: Auditoria de Cutover Ativo do Write Path (Controller, Policy, Scheduler)

**Documento:** `LINA-14F2-AUDIT-WRITE-PATH-CUTOVER-001.md`  
**Fase:** LINA-14F.2 (Cutover Ativo de Controller, Policy e Scheduler)  
**Data:** 2026-09-30  
**Estado:** Concluído / Aprovado para Implementação  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  

---

## 1. Contexto e Objetivos

Na fase LINA-14F.1, o Read Path e as superfícies de UI/Diagnóstico foram desvinculadas das heurísticas legadas e migradas para consumir estritamente o `EmbeddingLifecycleSnapshot`. O Write Path permaneceu intacto durante essa etapa.

O objetivo da presente fase **LINA-14F.2** é efetuar o cutover ativo dos três componentes coordenadores do Write Path:
1. **`EmbeddingWorkStatusController`** (`src/index/embeddingWorkStatusController.ts`)
2. **`EmbeddingPolicyEngine`** (`src/maintenance/embeddingPolicyEngine.ts`)
3. **`EmbeddingScheduler`** (`src/maintenance/embeddingScheduler.ts`)

A meta é garantir que a decisão prescritiva de escrita derivada exclusivamente de `EmbeddingLifecycleSnapshot` via `deriveEmbeddingWritePathDecision(snapshot)` seja a autoridade única e obrigatória para:
- Saber se há trabalho de embeddings pendente (`workAvailable`);
- Saber qual a ação de manutenção aplicável (`action`: `none`, `generate`, `update`, `rebuild`, `retry`, `cancel`);
- Saber se a execução é autorizada (`canExecute`, `allowed`);
- Saber se exige confirmação explícita (`requiresConfirmation`);
- Bloquear incondicionalmente nós `companion` e `standby`;
- Tratar `INDETERMINATE` de forma explícita sem coerção silenciosa para `idle` ou `false`.

---

## 2. Mapeamento de Decisões e Heurísticas Legadas por Componente

### 2.1 `EmbeddingWorkStatusController`

| Elemento / Símbolo | Natureza | Análise de Uso | Classificação |
| :--- | :--- | :--- | :--- |
| `hasEmbeddingWorkAvailable` (export puro) | Função livre legada | Exportada para compatibilidade e testes. Em LINA-14D.2-A já havia sido alinhada com `classifyEmbeddingWork`. | **Manter compatível / Deprecar** (como wrapper puro de `classifyEmbeddingWork` para compatibilidade retroativa com testes sem interferência no runtime do controller). |
| `deriveEmbeddingWorkDecisionAndAvailability` | Função interna | Constrói o `EmbeddingLifecycleSnapshot` através de `adaptCurrentStateToLifecycleSnapshot` e invoca `deriveEmbeddingWritePathDecision(snapshot)`. | **Autoridade Canónica Ativa**. Manter e reforçar garantias de tri-estado (`workAvailable: undefined` em `INDETERMINATE` / `unreadable`, `false` em Companion/Standby/sem trabalho, `true` apenas quando há trabalho executável). |
| `EmbeddingWorkRuntimeState.workAvailable` | Propriedade de estado | Exposto a subscritores de UI e scheduler. Derivado diretamente de `decision.updateRequired` e `decision.applicable`. | **Canónico derivado**. Preservar como projeção tri-state do snapshot. |
| `getDeviceRuntimeState` injection | Port opcional | Fornecido nas options do controller para injetar o estado de autoridade do dispositivo. | **Canónico Ativo**. |

### 2.2 `EmbeddingPolicyEngine`

| Elemento / Símbolo | Natureza | Análise de Uso | Classificação |
| :--- | :--- | :--- | :--- |
| `evaluateEmbeddingUpdatePolicyFromSnapshot` | Função pura canónica | Avalia diretamente o snapshot via `deriveEmbeddingWritePathDecision(snapshot)` e regras de política (`automatic-local-only`, `manual`). | **Autoridade Canónica Principal**. |
| `evaluateLegacyEmbeddingUpdatePolicy` | Função sombra | Utilizada apenas em testes de comparação shadow (LINA-14D.2-B). | **Deprecar / Manter para testes shadow**. Não participa do caminho de execução real. |
| `evaluateEmbeddingUpdatePolicy` (wrapper) | Ponto de entrada | Se `options.lifecycleSnapshot` estiver presente, delega imediatamente em `evaluateEmbeddingUpdatePolicyFromSnapshot`. Se ausente, adaptava sinteticamente via fallback. | **Refatorar**: Tornar a avaliação via snapshot a autoridade estrita, preservando a assinatura para chamadores existentes com adaptação canónica robusta. |
| `comparePolicyEngineDecision` | Função de comparação | Compara a decisão legada com a decisão canónica. | **Manter para testes e diagnósticos shadow**. |

### 2.3 `EmbeddingScheduler`

| Elemento / Símbolo | Natureza | Análise de Uso | Classificação |
| :--- | :--- | :--- | :--- |
| `evaluateSchedulerDecisionFromSnapshot` | Função pura canónica | Deriva `shouldSchedule`, `canDispatch`, `hasWork`, `action`, `requiresConfirmation` exclusivamente de `EmbeddingLifecycleSnapshot`. | **Autoridade Canónica Principal**. |
| `evaluateLegacySchedulerDecision` | Função sombra | Replicava heurísticas booleanas legadas para comparação. | **Manter para testes shadow / Deprecar**. |
| `compareSchedulerDecision` | Função de comparação | Validador shadow de divergências. | **Manter para auditoria e testes shadow**. |
| `hasAutomaticEmbeddingWork` (`main.ts`) | Port de verificação | Chamado pelo scheduler para validar se existe trabalho real antes do dispatch. | **Refatorar**: Derivar via snapshot/write-path decision (`decision.applicable && decision.updateRequired && (action === "update" || action === "generate")`). |
| `canDispatchAutomatically` (`main.ts`) | Port de autorização | Chamado pelo scheduler para validar política de auto-dispatch. | **Refatorar**: Avaliar via `evaluateEmbeddingUpdatePolicyFromSnapshot` com snapshot canónico. |
| Timers, debounce (30s), maxDelay (300s), backoff exponencial | Mecanismo temporal do Scheduler | Mecanismo operacional robusto e testado. | **Preservar 100% Intacto** sem alteração de cadência, timers ou eventos. |

---

## 3. Matriz de Classificação de Componentes

| Componente | Remover Agora | Manter Transitóriamente | Deprecar | Transferir (14F.3 / 14F.4) |
| :--- | :--- | :--- | :--- | :--- |
| Heurísticas ad-hoc de "há trabalho" no scheduler | Sim (substituído por `deriveEmbeddingWritePathDecision`) | - | - | - |
| Avaliação ad-hoc de papel/ownership no scheduler | Sim (substituído por `decision.applicable` / `snapshot.write.applicable`) | - | - | - |
| Funções auxiliares shadow (`compareSchedulerDecision`, `comparePolicyEngineDecision`) | Não | Sim (úteis para testes de não-regressão e harness) | Sim | LINA-14F.4 (limpeza final) |
| Execução física do `EmbeddingWorker` e `EmbeddingOperationManager` | Não | Sim | Não | LINA-14F.3 (cutover do worker/operation) |
| Locks e coordenação de escrita (`IndexWriteCoordinator`) | Não | Sim | Não | LINA-14F.3 |

---

## 4. Invariantes do Ciclo de Vida no Write Path

1. **`READY`:** `workAvailable = false`, `action = "none"`, `canDispatch = false`, `shouldSchedule = true` (mantém escuta passiva), scheduler não despacha.
2. **`UPDATE_AVAILABLE`:** `action = "update"`, `workAvailable = true`, `canDispatch = true` (se local + automatic-local-only), caso contrário `requiresConfirmation = true` e `canDispatch = false`.
3. **`INDEX_ONLY`:** `action = "generate"`, apenas Active Producer pode executar.
4. **`INCOMPATIBLE`:** `action = "rebuild"`, `requiresConfirmation = true`, nunca auto-despachar rebuild.
5. **`ERROR`:** `action = "retry"` quando autorizado; respeita backoff exponencial existente sem auto-retry cego.
6. **`INDETERMINATE`:** `workAvailable = undefined`, bloqueia despacho automático sem assumir `idle`.
7. **`Companion`:** `applicable = false`, `action = "none"`, `workAvailable = false`, `shouldSchedule = false`, `canDispatch = false`.
8. **`Standby`:** `applicable = false`, `action = "none"`, `workAvailable = false`, `shouldSchedule = false`, `canDispatch = false`.
9. **`embeddingsEnabled = false`:** `applicable = false`, `blockedReason = "embeddings-disabled"`, sem geração background.
10. **`publish-only cleanup`:** `action = "update"`, `cost = "none"`, `requiresConfirmation = false`, apenas Active Producer.

---

## 5. Plano de Implementação Seguro

1. **`EmbeddingWorkStatusController`:**
   - Assegurar que `deriveEmbeddingWorkDecisionAndAvailability` constrói o snapshot canónico com o `deviceRuntimeState` correto (seja injetado via options ou default) e exporta `decision`, `lifecycleSnapshot` e `workAvailable` alinhados a 100%.
2. **`EmbeddingPolicyEngine`:**
   - Garantir que `evaluateEmbeddingUpdatePolicy` e `evaluateEmbeddingUpdatePolicyFromSnapshot` usem o snapshot canónico e `deriveEmbeddingWritePathDecision` como autoridade absoluta.
3. **`EmbeddingScheduler` e Portas em `main.ts`:**
   - Em `main.ts`, assegurar que `hasAutomaticEmbeddingWork()` e `canDispatchAutomatically()` consultem a decisão canónica do snapshot.
   - Preservar rigorosamente a integridade dos timers, debounce (30s), maxDelay (300s), backoff exponencial e dispatch do `EmbeddingScheduler`.
4. **Testes de Cobertura e Guardas de Regressão:**
   - Executar suíte completa (`npm test`), confirmando a passagem de todos os 1867+ testes e validando os cenários canónicos.
