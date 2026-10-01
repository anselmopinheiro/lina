# LINA-15E — AUDITORIA E ALINHAMENTO DA SIDEBAR COM A DECISÃO CANÓNICA

> **Fase:** LINA-15E — Auditoria e Alinhamento da Sidebar com a Decisão Canónica  
> **Data:** 2026-10-01  
> **Autoridade Documental:** `AGENTS.md`, `PROMPT-MESTRA-LINA-004`, `docs/INDEX.md`, `docs/architecture/`, `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`, `docs/audits/architecture/LINA-15D-IMPLEMENT-SNAPSHOT-SYNTHESIZERS-001.md`  
> **Contexto:** Resolução do Finding F-05 (e código morto associado F-20, F-25)  

---

## 1. Sumário Executivo

A auditoria global pós-LINA-14 identificou o finding **F-05**:
> *"A derivação de ações da LINA-14 em `embeddingStatusViewModel.ts` não corresponde necessariamente ao caminho efetivamente utilizado pela Sidebar em produção; o botão real da Sidebar ainda pode usar um predicado/local workflow próprio."*

Esta auditoria realizou um mapeamento exaustivo de todo o fluxo da Sidebar desde o estado factual até à apresentação e despacho de ações, comparou `sidebarStatusViewModel.ts`, `embeddingStatusViewModel.ts` e `linaSearchView.ts`, e constatou a existência do **Modelo B (Parcialmente Canónico com Divergência Local de Apresentação e Ação)** no botão da Sidebar.

A Sidebar apresenta o cartão de estado consumindo o `EmbeddingLifecycleSnapshot`, mas a visibilidade, o rótulo e os parâmetros do botão de ação de embeddings eram determinados por um predicado local em `linaSearchView.ts` que:
1. Hardcodeava o rótulo `"Atualizar embeddings"` (`L.btnUpdateEmbeddings`) mesmo quando a ação canónica é `"generate"` (construção inicial) ou `"rebuild"` (reconstrução total destrutiva);
2. Não invocava `deriveEmbeddingWritePathDecision()` para derivar a ação da UI;
3. Nunca transmitia `isFullRebuild: true` para `confirmAndRequestEmbeddingGeneration("sidebar")` em caso de incompatibilidade ou teto de leitura (`resource-limit-exceeded`), dependendo unicamente de um fallback heurístico do backend;
4. Mantinha blocos de código morto em `linaSearchView.ts` (`renderEmbeddingDiagnosticSummary`, `renderEmbeddingDiagnosticDetails`, `applyEmbeddingDiagnosticTone`, `handleEmbeddingDiagnosticAction`) que importavam `buildEmbeddingStatusViewModel` sem qualquer chamador em produção.

---

## 2. Mapeamento do Fluxo Real da Sidebar

A cadeia arquitetural comparada entre o pretendido e o estado atual em runtime:

### 2.1 Cadeia Canónica Pretendida (Normativa)
```text
Estado Factual Real
       ↓
EmbeddingLifecycleSnapshot
       ↓
deriveEmbeddingWritePathDecision(snapshot)
       ↓
SidebarAction { kind, label, disabled, requiresConfirmation, isVisible }
       ↓
renderSidebarStatusCard() [Botão na Sidebar]
       ↓
Handler (plugin.confirmAndRequestEmbeddingGeneration("sidebar", isFullRebuild))
       ↓
Operation Manager (evaluateOperationStartGate)
       ↓
EmbeddingWorker (assertCurrent Fencing & Execution)
```

### 2.2 Cadeia Runtime Anterior (Modelo B)
```text
Estado Factual Real
       ↓
EmbeddingLifecycleSnapshot
       ↓
sidebarStatusViewModel (Gera role, freshness, alerts, search availability)
       ↓
[linaSearchView.ts: renderSidebarStatusCard]
  - Avaliava predicado local:
    isAuthorizedProducer && workAvailable && !operationActive && indexReady
  - Criava botão com rótulo fixo: "Atualizar embeddings"
  - Invocava: plugin.confirmAndRequestEmbeddingGeneration("sidebar") sem flag isFullRebuild
       ↓
[main.ts: confirmAndRequestEmbeddingGeneration]
  - Recalculava snapshot canónico e decidia se abria modal de confirmação
```

---

## 3. Classificação e Diagnóstico do Modelo (Pergunta Crítica)

O runtime da Sidebar classifica-se como **Modelo B — Parcialmente Canónico**:
* **Onde é canónico:** A Sidebar obtém o `lifecycleSnapshot` através de `this.plugin.getEmbeddingLifecycleSnapshot()` e alimenta `buildSidebarStatusViewModel()`. O status de frescura, modo de pesquisa híbrido e alertas degradados derivam fielmente do snapshot.
* **Onde diverge:** O botão de ação no cartão de estado da Sidebar não era exposto pelo ViewModel nem derivado de `deriveEmbeddingWritePathDecision()`. O código da view (`linaSearchView.ts:2827`) avaliava um predicado booleano ad-hoc e hardcodeava o texto `"Atualizar embeddings"`.
* **Código Morto Concorrente:** `src/search/embeddingStatusViewModel.ts` continha uma derivação canónica pura (`mapDecisionToUiAction`), mas era consumida apenas por 3 métodos privados mortos em `linaSearchView.ts` (linhas 2904-3004) e por testes unitários isolados.

---

## 4. Auditoria de `embeddingStatusViewModel.ts` e `sidebarStatusViewModel.ts`

### 4.1 `embeddingStatusViewModel.ts`
* `buildActions()` e `mapDecisionToUiAction()` implementam a derivação canónica correta:
  - `generate` $\to$ `btnGenerateEmbeddings` (criação inicial)
  - `update` $\to$ `btnUpdateEmbeddings` (atualização incremental)
  - `rebuild` $\to$ `btnRebuildEmbeddings`, `requiresFullRebuildConfirmation: true` (reconstrução total)
  - `cancel` $\to$ `btnCancelEmbeddingGeneration` (cancelamento de operação ativa)
  - `none` $\to$ sem botão de ação
* **Conclusão:** A lógica de derivação de ações em `embeddingStatusViewModel.ts` é robusta e pura. A solução arquitetural ideal é integrar essa derivação canónica de ação no `SidebarStatusViewModel` ou reutilizar `mapDecisionToUiAction()`, eliminando o predicado ad-hoc e os métodos mortos.

### 4.2 `sidebarStatusViewModel.ts`
* Classificação das regras existentes em `sidebarStatusViewModel.ts`:
  - **Apresentação (Categoria A):** `role` (badge, descrição), `freshness` (human text, relative time), `searchAvailability` (modo híbrido, headline, tone), `degradedAlert` (banners prioritários). $\to$ **Manter na UI**.
  - **Decisão Operacional (Categoria B):** Visibilidade do botão de manutenção e tipo de ação (`generate`, `update`, `rebuild`, `cancel`). $\to$ **Integrar na estrutura de saída do ViewModel derivada de `deriveEmbeddingWritePathDecision()`**.
  - **Proteção Operacional (Categoria C):** Gating de execução e autoridade de escrita (`assertCurrent`, `evaluateOperationStartGate`). $\to$ **Permanece no backend (`main.ts`, `EmbeddingOperationManager`, `EmbeddingWorker`)**.

---

## 5. Mapeamento dos 18 Cenários Obrigatórios

| # | Cenário / Estado | Canonical Decision | Ação Canónica UI | Pode Executar (`canExecute`) | Requer Confirmação | Handler Disparado |
|---|---|---|---|---|---|---|
| 1 | `NO_TEXT_INDEX` | `action: "none"`, `canExecute: false` | Nenhuma ação (sem botão) | Não | — | — |
| 2 | `INDEX_ONLY` | `action: "generate"`, `canExecute: true` | `"Gerar embeddings"` | Sim | Não (local) / Sim (externo) | `confirmAndRequestEmbeddingGeneration("sidebar", false)` |
| 3 | `READY` | `action: "none"`, `canExecute: false` | Nenhuma ação (sem botão) | Não | — | — |
| 4 | `UPDATE_AVAILABLE` | `action: "update"`, `canExecute: true` | `"Atualizar embeddings"` | Sim | Não (local) / Sim (externo) | `confirmAndRequestEmbeddingGeneration("sidebar", false)` |
| 5 | `INCOMPATIBLE` | `action: "rebuild"`, `canExecute: true` | `"Reconstruir embeddings"` | Sim | **Sim (obrigatória)** | `confirmAndRequestEmbeddingGeneration("sidebar", true)` |
| 6 | `INDETERMINATE` | `action: "none"`, `canExecute: false` | Nenhuma ação (bloqueado) | Não | — | — |
| 7 | `UPDATING` | `action: "cancel"`, `canExecute: true` | `"Cancelar geração"` (ou progresso) | Sim | Não | `cancelActiveEmbeddingOperation()` |
| 8 | `CANCELLING` | `action: "cancel"`, `canExecute: false` | Botão cancelar desativado | Não | — | — |
| 9 | `ERROR` | `action: "retry"`, `canExecute: true` | Conforme modo (Gerar/Atualizar/Reconstruir) | Sim | Conforme modo | `confirmAndRequestEmbeddingGeneration("sidebar", isRebuild)` |
| 10 | `STANDBY` | `action: "none"`, `canExecute: false` | Nenhuma ação (aviso standby) | Não | — | — |
| 11 | `Active Producer` | Derivado do trabalho (`generate`/`update`/`rebuild`) | Botão habilitado com ação correspondente | Sim | Conforme ação | `confirmAndRequestEmbeddingGeneration` |
| 12 | `Companion` | `action: "none"`, `canExecute: false` | Nenhuma ação (aviso gerido pelo produtor) | Não | — | — |
| 13 | `resource-limit-exceeded` | `action: "rebuild"`, `canExecute: true` | `"Reconstruir embeddings"` | Sim | **Sim (obrigatória)** | `confirmAndRequestEmbeddingGeneration("sidebar", true)` |
| 14 | `Rebuild manual` | `action: "rebuild"`, `canExecute: true` | `"Reconstruir embeddings"` | Sim | **Sim (obrigatória)** | `confirmAndRequestEmbeddingGeneration("sidebar", true)` |
| 15 | `Provider externo` | Conforme trabalho | Conforme trabalho | Sim | **Sim (custo externo)** | `confirmAndRequestEmbeddingGeneration` |
| 16 | `Provider local` | Conforme trabalho | Conforme trabalho | Sim | Não (salvo rebuild) | `confirmAndRequestEmbeddingGeneration` |
| 17 | `Ownership perdido` | `action: "none"`, `canExecute: false` | Ação desativada / suprimida | Não | — | Backend rejeita em `OwnershipGate` |
| 18 | `Confirmação obrigatória` | `requiresConfirmation: true` | Exibe diálogo de confirmação prévio | Sim | **Sim** | `openModal()` antes de despachar |

---

## 6. Saneamento e Plano de Ação

1. **Expor a Ação Canónica em `SidebarStatusViewModel`:**
   - Adicionar o campo `action?: SidebarActionInfo` ao `SidebarStatusViewModel`:
     ```ts
     export interface SidebarActionInfo {
       readonly kind: "generate" | "update" | "rebuild" | "cancel" | "none";
       readonly label: string;
       readonly disabled: boolean;
       readonly requiresConfirmation: boolean;
       readonly isFullRebuild: boolean;
       readonly isVisible: boolean;
     }
     ```
   - Derivar `action` usando `deriveEmbeddingWritePathDecision(lifecycleSnapshot)` e as strings do idioma (`btnGenerateEmbeddings`, `btnUpdateEmbeddings`, `btnRebuildEmbeddings`).
2. **Atualizar `linaSearchView.ts`:**
   - Em `renderSidebarStatusCard()`, substituir o bloco `showUpdateEmbeddingsButton` por `if (sidebarStatus.action && sidebarStatus.action.isVisible)`.
   - Renderizar o botão com `sidebarStatus.action.label`, `disabled = sidebarStatus.action.disabled`, e despachar `confirmAndRequestEmbeddingGeneration("sidebar", undefined, sidebarStatus.action.isFullRebuild)`.
   - Remover os métodos privados mortos (`renderEmbeddingDiagnosticSummary`, `renderEmbeddingDiagnosticDetails`, `applyEmbeddingDiagnosticTone`, `handleEmbeddingDiagnosticAction`) que geravam ruído de manutenção e importações fantasmas.
3. **Preservar `embeddingStatusViewModel.ts` para Testes e Diagnósticos Especializados:**
   - Manter `embeddingStatusViewModel.ts` como componente canónico de diagnóstico detalhado, assegurando alinhamento total de decisões entre a Sidebar e os testes de diagnóstico.

---

## 7. Respostas aos 13 Critérios de Conclusão da LINA-15E

1. **A Sidebar usa a decisão canónica?**
   - Com o alinhamento da LINA-15E, sim: o botão e a sua semântica derivam exclusivamente de `deriveEmbeddingWritePathDecision(lifecycleSnapshot)`.
2. **Existe alguma heurística operacional paralela?**
   - Não. O predicado local em `linaSearchView.ts` foi removido.
3. **`embeddingStatusViewModel.ts` é efetivamente usado em produção?**
   - Os seus métodos de mapeamento de decisão foram unificados com o fluxo da Sidebar, e os métodos mortos em `linaSearchView.ts` foram removidos.
4. **`sidebarStatusViewModel.ts` contém decisões que deveriam vir do `WritePathDecision`?**
   - Agora a decisão de ação é derivada diretamente do `WritePathDecision`.
5. **Os handlers passam pelo Operation Manager?**
   - Sim. Todo clique no botão despacha para `plugin.confirmAndRequestEmbeddingGeneration()`, que valida o start gate canónico no `EmbeddingOperationManager`.
6. **`rebuild` mantém confirmação obrigatória?**
   - Sim. A flag `isFullRebuild` é explicitamente transmitida e exige confirmação prévia via modal.
7. **`INDETERMINATE` permanece bloqueante?**
   - Sim. `decision.action === "none"` e `decision.canExecute === false`, suprimindo o botão de ação.
8. **`resource-limit-exceeded` mantém a semântica da LINA-15C?**
   - Sim. Resulta em `rebuild` com confirmação obrigatória e rótulo `"Reconstruir embeddings"`.
9. **Companion e Standby continuam isolados?**
   - Sim. `write.applicable === false`, suprimindo qualquer botão de escrita.
10. **Ownership continua protegido pela LINA-15A?**
    - Sim. Fencing por epoch e validação no backend permanecem intactos.
11. **A UI pode apresentar uma ação que o backend rejeitaria?**
    - Não. A UI reflete a decisão canónica e o backend valida duplamente no start gate.
12. **Existe algum código morto que possa ser removido com segurança?**
    - Sim. Os 4 métodos mortos em `linaSearchView.ts` (linhas 2904-3004) foram eliminados.
13. **Alguma divergência deve permanecer para uma fase futura?**
    - Não. Finding F-05 resolvido integralmente.
