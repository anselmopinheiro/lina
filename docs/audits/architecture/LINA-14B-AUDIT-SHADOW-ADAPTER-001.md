# LINA-14B-AUDIT-SHADOW-ADAPTER-001

## 1. Contexto e Objetivo
A fase **LINA-14B** do roadmap estabelece um mecanismo de observabilidade pura em *Shadow Mode* para o ciclo de vida dos embeddings.

O objetivo é converter o estado heterogéneo atual da aplicação em instâncias de [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) (definido na fase LINA-14A) e comparar, lado a lado, as decisões do modelo legado com as decisões do novo modelo puro de ciclo de vida, sem alterar qualquer comportamento ativo de produção.

## 2. Mapeamento das Fontes Atuais de Estado

| Subsistema / Módulo | Dados Produzidos | Consumidores Atuais | Decisões & Reduções Booleanas |
|---|---|---|---|
| **`embeddingState.ts`** | `calculateEmbeddingState()`: `validForSearchCount`, `reusableForNextGenerationCount`, `PublishedEmbeddingIdentity`, `NextGenerationEmbeddingIdentity`. | `calculateEmbeddingUpdatePlan`, `readEmbeddingStatus`, Sidebar diagnostics. | Separa validade para pesquisa (`validForSearch`) de reutilização para próxima geração (`reusableForNextGeneration`). |
| **`embeddingUpdatePlan.ts`** | `calculateEmbeddingUpdatePlan()`: `EmbeddingUpdatePlan` com `mode` (`initial-build`, `incremental`, `full-rebuild`, `indeterminate`), contagens (`toGenerateCount`, `staleToReplaceCount`, `missingCount`, `obsoleteToDropCount`), `requiresPublication`, `reasons`. | `EmbeddingWorkStatusController`, `EmbeddingScheduler`, modal de confirmação. | Decide factualmente se há trabalho e qual a estratégia ótima de atualização. |
| **`embeddingWorkflowState.ts`** | `resolveEmbeddingWorkflowState()`: `EmbeddingWorkflowState` com `status` (`idle`, `checking`, `update-required`, `preparing`, `generating`, `persisting`, `finalizing`, `error`, `cancelled`). | `SidebarStatusViewModel`, `EmbeddingStatusViewModel`. | Reduz o estado de workflow para apresentação na barra lateral. |
| **`deviceRuntimeState.ts`** | `DeviceRuntimeState`: `deviceRole`, `isActiveProducer`, `embeddings.semanticAvailable`, `embeddings.generationAvailable`, `embeddings.exists`, `vectorContract`. | `LinaSettingTab`, `DeviceDiagnosticsModal`, `SidebarStatusViewModel`. | Agrega o estado runtime por dispositivo em memória. |
| **`vectorContract.ts`** | `VectorContractV1`, `contractId`, `computeVectorContractId`, `EffectiveEmbeddingRuntimeConfig`. | `main.ts` (arranque), `deviceRuntimeState.ts`, Companion search. | Formaliza a identidade do espaço vetorial. |
| **`producerState.ts`** | `ProducerStateManifest`: `embeddings.lastSuccessfulPublicationAt`, `embeddings.lastSuccessfulBatchCount`, `maintenance.lastError`. | `DeviceDiagnosticsModal`, telemetria local do Produtor. | Guarda o histórico operacional do Produtor em `.lina/producer-state.json`. |
| **`companionConsumptionState.ts`** | `CompanionArtifactConsumptionState`: `isAvailable`, `searchMode`, `provenance`, `lastKnownProducerEpoch`. | `DeviceDiagnosticsModal`, `executeCompanionSearch`. | Avalia as capacidades de consumo do Companion face aos artefactos sincronizados. |

## 3. Identificação de Decisões Duplicadas e Divergências Potenciais
1. **Disponibilidade Semântica (Read Path):**
   - No modelo legado, `DeviceRuntimeState.embeddings.semanticAvailable` é mantido em cache e recalculado em momentos discretos, enquanto a pesquisa em tempo real verifica o índice runtime diretamente.
   - No novo modelo [`EmbeddingLifecycleSnapshot.read`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts), `semanticAvailable` reflete deterministicamente a presença de registos utilizáveis (`validForSearchCount > 0`) e a compatibilidade de identidade com o dispositivo/contrato.
2. **Avaliação de Trabalho de Atualização (Write Path):**
   - No modelo legado, múltiplos componentes efetuam reduções booleanas distintas sobre `hasEmbeddingWorkAvailable` (ex.: se obsoletos/limpeza contam como trabalho que bloqueia ou pede ação).
   - No novo modelo, `classifyEmbeddingWork()` classifica `kind: "none" | "indeterminate" | "pending"` e atribui severidades distintas (`info` para limpeza/obsoletos, `action` para chunks novos/modificados, `blocking` para incompatibilidade de modelo).
3. **Isolamento de Papel Companion (C1):**
   - No modelo legado, a barra lateral em Companion podia calcular `workAvailable` com base nas definições locais se não houvesse guarda de papel no viewmodel.
   - No novo modelo, `write.applicable = false` e `capability.blockedReason = "companion"`, garantindo que um Companion nunca sinaliza pedidos de geração nem transita para `UPDATE_AVAILABLE`.

## 4. Desenho do Shadow Adapter e Estrutura de Comparação

### 4.1 Interface de Entrada (`CurrentEmbeddingStateInputs`)
O adapter recebe os objetos de estado em memória já calculados pelo plugin:
- `deviceRuntimeState?: DeviceRuntimeState | null`
- `workflowState?: EmbeddingWorkflowState | null`
- `updatePlan?: EmbeddingUpdatePlan | null`
- `vectorContract?: VectorContractV1 | null`
- `publishedIdentity?: PublishedEmbeddingIdentity | null`
- `operationState?: EmbeddingOperationState | null`
- `producerState?: ProducerStateManifest | null`
- `companionState?: CompanionArtifactConsumptionState | null`
- `textIndexUsability?: "ready" | "stale" | "missing" | "invalid"`

### 4.2 Estrutura do Resultado Shadow (`EmbeddingLifecycleShadowResult`)
```typescript
export interface EmbeddingLifecycleDifference {
  readonly area: "read" | "write" | "process" | "primary" | "capability";
  readonly property: string;
  readonly legacyValue: unknown;
  readonly snapshotValue: unknown;
  readonly description: string;
  readonly severity: "info" | "warning" | "divergence";
}

export interface EmbeddingLifecycleShadowResult {
  readonly legacyStateSummary: {
    readonly semanticAvailable: boolean;
    readonly workflowStatus: string;
    readonly workAvailable: boolean;
    readonly role: string;
  };
  readonly lifecycleSnapshot: EmbeddingLifecycleSnapshot;
  readonly differences: readonly EmbeddingLifecycleDifference[];
  readonly matchesPrimary: boolean;
}
```

## 5. Garantias e Restrições de Implementação
- **Zero Efeitos Secundários:** O adapter é uma função pura (`adaptCurrentStateToLifecycleSnapshot` e `compareLegacyWithLifecycleSnapshot`).
- **Não Invasivo:** Não altera chamadores existentes nem aciona persistência ou rede.
- **Observabilidade:** Divergências são apenas reportadas estruturalmente para fins de auditoria e testes.
