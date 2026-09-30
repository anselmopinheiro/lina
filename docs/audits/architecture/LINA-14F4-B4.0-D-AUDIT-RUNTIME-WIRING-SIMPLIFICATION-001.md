# Auditoria de Arquitetura: Simplificação do Runtime Wiring (LINA-14F.4-B4.0-D)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.0-D — Runtime Wiring Simplification  
**Autoridade:** Arquiteto de Software Sénior & Engenheiro TypeScript Obsidian Plugin  
**Estado:** Auditoria Completa / Proposta de Simplificação Arquitetural

---

## 1. Introdução e Contexto

No seguimento das fases de consolidação do ciclo de vida dos embeddings no Lina:
- **LINA-14D:** Criação do Write Path canónico e formalização das decisões operacionais.
- **LINA-14E:** Validação global e invariantes do modelo `EmbeddingLifecycleSnapshot`.
- **LINA-14F.4-B3:** Remoção completa do modelo paralelo legado `EmbeddingWorkflowState`.
- **LINA-14F.4-B4.0-A:** `EmbeddingScheduler` corrigido para utilizar `EmbeddingLifecycleSnapshot` no gate de despacho automático.
- **LINA-14F.4-B4.0-B:** `EmbeddingWorker` corrigido com injeção de `getLifecycleSnapshot` para validação pré-execução física.
- **LINA-14F.4-B4.0-C:** `EmbeddingOperationManager` consolidado como barreira final de autoridade operacional contra o snapshot canónico.

O objetivo desta fase **LINA-14F.4-B4.0-D** é mapear e planear a simplificação do wiring interno do runtime, eliminando duplicações, reconstruções ad-hoc de snapshots, heurísticas residuais e caminhos paralelos na cadeia:

```text
Estado Factual (Vault / Storage / Device)
                  ↓
       EmbeddingLifecycleSnapshot
                  ↓
     deriveEmbeddingWritePathDecision()
                  ↓
   Consumidores (Scheduler / Worker / Manager / UI)
```

---

## 2. Auditoria Detalhada dos 5 Eixos

### 2.1 Eixo 1: Construção de Snapshots (`EmbeddingLifecycleSnapshot`)

#### 2.1.1 Fontes Atuais de Construção
1. **`resolveEmbeddingLifecycle()` (`src/index/embeddingLifecycleModel.ts`):**  
   - O construtor canónico puro de baixo nível que valida as invariantes estruturais e resolve o estado primário (`primary`).
2. **`adaptCurrentStateToLifecycleSnapshot()` (`src/index/embeddingLifecycleAdapter.ts`):**  
   - O adapter principal para converter representações heterogéneas (`CurrentEmbeddingStateInputs`) em snapshots canónicos.
3. **`buildEmbeddingWorkLifecycleSnapshot()` (`src/index/embeddingWorkStatusController.ts`):**  
   - Factory canónica do controller para derivar snapshots a partir do `EmbeddingWorkSummary` com revisão e `DeviceRuntimeState`.
4. **`LinaPlugin.getEmbeddingLifecycleSnapshot()` (`main.ts`):**  
   - Ponto de acesso em runtime do plugin que combina o resumo do controller com a autoridade de escrita em tempo real (`getLiveAuthorityRuntimeState()`) e o estado da operação ativa (`getMaintenanceEngine().getEmbeddingOperationState()`).

#### 2.1.2 Problemas e Entropia Identificados
- **Snapshots Ad-Hoc / Fragmentados:**
  - `main.ts:confirmAndRequestEmbeddingGeneration()` reconstrói um snapshot isolado a partir de `readEmbeddingUpdatePreview` e `readEmbeddingStatus` para avaliar políticas e confirmações, duplicando campos (`upstreamTextIndex: "ready"`, `canonicalExists: summary?.exists ?? true`).
  - `main.ts:hasAutomaticEmbeddingWork()` reconstrói outro snapshot ad-hoc com flags manuais (`canonicalExists: updatePlan.mode !== "initial-build"`).
  - `src/search/linaSearchView.ts` reconstrói um snapshot local (linhas 2705–2715) em vez de reutilizar a fonte canónica centralizada.
- **Snapshots Artificiais de Fallback na UI:**
  - `src/search/sidebarStatusViewModel.ts` (linhas 255–300) cria um snapshot artificial completo com `deviceRuntimeState` simulado se `input.lifecycleSnapshot` não for fornecido.
  - `src/search/embeddingStatusViewModel.ts` (linhas 181–207) faz o mesmo com dimensões hardcoded (1536) e heurísticas ad-hoc.

---

### 2.2 Eixo 2: Adapter (`src/index/embeddingLifecycleAdapter.ts`)

#### 2.2.1 Análise Estrutural
- `adaptCurrentStateToLifecycleSnapshot` é uma função pura e síncrona sem I/O.
- Recebe `CurrentEmbeddingStateInputs` com 22 campos opcionais.
- Realiza a classificação de trabalho através de `classifyEmbeddingWork()`.

#### 2.2.2 Problemas Identificados
- **Multiplicidade de Fontes de Identidade:** O adapter tenta resolver identidades em cascata (`publishedIdentity` -> `vectorContract` -> `companionState.vectorContract` -> defaults artificiais como `"default-producer"` / `"default-model"`).
- **Defaults Permissivos:** Na ausência de `deviceRuntimeState`, assume `deviceRole: "producer"` e `isActiveProducer: true`, o que pode mascarar erros de inicialização se não for fornecido um runtime state explícito.

---

### 2.3 Eixo 3: Controllers e Motores de Decisão

| Componente | Estado de Aderência Canónica | Análise |
|---|---|---|
| **`EmbeddingWorkStatusController`** | **100% Canónico** | Gera `lifecycleSnapshot` e `decision` via `deriveEmbeddingWritePathDecision()` e armazena em `EmbeddingWorkRuntimeState`. |
| **`EmbeddingPolicyEngine`** | **100% Canónico** | Avalia políticas exclusivamente a partir de `EmbeddingLifecycleSnapshot` (`evaluateEmbeddingUpdatePolicyFromSnapshot`). |
| **`EmbeddingScheduler`** | **100% Canónico** | Avalia elegibilidade de despacho exclusivamente via `evaluateSchedulerDecisionFromSnapshot(snapshot, policy)`. |
| **`EmbeddingOperationManager`** | **100% Canónico** | Valida arranque de operações via `evaluateOperationStartGate(decision, origin)` e `EmbeddingOperationEligibilityDecision`. |
| **`EmbeddingWorker`** | **100% Canónico** | Pré-valida execução contra `evaluateOperationDecisionFromSnapshot(snapshot)`. |

**Conclusão do Eixo 3:** Todos os 5 controladores centrais já consomem o pipeline canónico `EmbeddingLifecycleSnapshot → deriveEmbeddingWritePathDecision()`. Não existem heurísticas locais paralelas nestes componentes centrais.

---

### 2.4 Eixo 4: Orquestração e Wiring em `main.ts`

#### 2.4.1 Fluxo Atual de Execução
```text
Plugin Methods (confirmAndRequest, hasAutomaticWork, UI)
  ├── getEmbeddingLifecycleSnapshot() ──► Worker / OperationManager (Consistente)
  ├── confirmAndRequestEmbeddingGeneration() ──► Ad-hoc snapshot (Duplicação)
  └── hasAutomaticEmbeddingWork() ──► Ad-hoc snapshot (Duplicação)
```

#### 2.4.2 Problemas Identificados em `main.ts`
1. **Leituras Redundantes de Update Plan:**
   - O controller lê `readEmbeddingUpdatePreview` durante o refresh regular.
   - `confirmAndRequestEmbeddingGeneration` executa outra leitura física de `readEmbeddingUpdatePreview`.
   - `hasAutomaticEmbeddingWork` executa mais uma leitura física de `readEmbeddingUpdatePreview`.
2. **Duplicação de Lógica de Confirmação:**
   - `confirmAndRequestEmbeddingGeneration` reconstrói a decisão de confirmação manualmente em vez de confiar estritamente em `decision.requiresConfirmation` derivado do snapshot canónico.

---

### 2.5 Eixo 5: Camada de UI e View Models

#### 2.5.1 `SidebarStatusViewModel` (`src/search/sidebarStatusViewModel.ts`)
- Consome `lifecycleSnapshot` para apresentação de estado, roles e freshness.
- Se `lifecycleSnapshot` for fornecido, a UI apresenta fielmente o estado canónico.
- Contém fallback legado (linhas 255–300) que pode ser simplificado / tornado seguro quando o chamador (`linaSearchView.ts`) garante a passagem do snapshot.

#### 2.5.2 `EmbeddingStatusViewModel` (`src/search/embeddingStatusViewModel.ts`)
- Consome `lifecycleSnapshot` para headline, contagens, checkpoint e labels de runtime.
- **Ponto Crítico de Melhoria:** `buildActions()` (linhas 113–175) ainda contém regras ad-hoc (`mode === "full-rebuild"`, `isReady`, `updateAvailable`) para decidir botões (`generate`, `update`, `rebuild`), em vez de derivar diretamente de `deriveEmbeddingWritePathDecision(lifecycleSnapshot).action`.

#### 2.5.3 `LinaSearchView` (`src/search/linaSearchView.ts`)
- O método `updateSidebarStatusUX()` monta um snapshot ad-hoc na linha 2705.
- Deveria consumir diretamente `this.plugin.getEmbeddingLifecycleSnapshot()` ou o `embeddingWorkState.lifecycleSnapshot` já calculado pelo controller.

---

## 3. Matriz de Simplificação Proposta

| Alvo | Situação Atual | Simplificação Proposta | Benefício |
|---|---|---|---|
| **`main.ts:confirmAndRequestEmbeddingGeneration`** | Constrói snapshot ad-hoc e valida confirmação com heurística | Utiliza `this.getEmbeddingLifecycleSnapshot()` e `decision.requiresConfirmation` | Elimina duplicação de snapshot e leitura redundante de estado |
| **`main.ts:hasAutomaticEmbeddingWork`** | Constrói snapshot ad-hoc via `adaptCurrentStateToLifecycleSnapshot` | Utiliza `this.getEmbeddingLifecycleSnapshot()` e `evaluateSchedulerDecisionFromSnapshot` | Garante decisão factual 100% idêntica ao resto do sistema |
| **`src/search/linaSearchView.ts`** | Constrói snapshot ad-hoc na linha 2705 | Passa `this.plugin.getEmbeddingLifecycleSnapshot()` para os view models | Unifica a fonte de dados da UI com o runtime |
| **`src/search/embeddingStatusViewModel.ts:buildActions`** | Heurística própria para escolher ação (generate/update/rebuild) | Utiliza `deriveEmbeddingWritePathDecision(lifecycleSnapshot).action` | UI expressa exatamente a ação autorizada pelo Write Path |
| **`src/search/sidebarStatusViewModel.ts`** | Fallback com snapshot artificial complexo | Fallback seguro mínimo mantendo contrato do view model | Reduz código morto e complexidade ciclomática |

---

## 4. Plano de Implementação (Subfases Sugeridas)

1. **B4.1 — Alinhamento de Ações na UI de Estado:**
   - Atualizar `buildActions` em `embeddingStatusViewModel.ts` para basear a seleção de ação (`generate` / `update` / `rebuild`) diretamente em `deriveEmbeddingWritePathDecision(lifecycleSnapshot)`.
2. **B4.2 — Unificação de Snapshots na `LinaSearchView`:**
   - Substituir a construção ad-hoc em `linaSearchView.ts:updateSidebarStatusUX` pelo consumo canónico de `this.plugin.getEmbeddingLifecycleSnapshot()`.
3. **B4.3 — Consolidação de Snapshots em `main.ts`:**
   - Refatorar `hasAutomaticEmbeddingWork()` e `confirmAndRequestEmbeddingGeneration()` para reutilizar `getEmbeddingLifecycleSnapshot()`.
4. **B4.4 — Validação e Testes de Regressão:**
   - Assegurar que todos os 141 ficheiros e 1875+ testes continuam 100% verdes.

---

## 5. Conclusão da Auditoria

A arquitetura do Lina atingiu um elevado nível de maturidade na autoridade do ciclo de vida: todos os 5 controladores centrais já operam sobre `EmbeddingLifecycleSnapshot` + `deriveEmbeddingWritePathDecision()`.

A eliminação dos pontos de entropia identificados nos pontos de entrada de `main.ts` e nas view models da UI fechará o ciclo de consolidação, garantindo:
1. **Fonte Única de Fato:** Apenas um pipeline de construção e avaliação de snapshot.
2. **Decisão Operacional Única:** UI, Scheduler, Worker e Operation Manager concordam sempre na ação recomendada.
3. **Zero Heurísticas Paralelas:** Código mais simples, manutenível e auditável.
