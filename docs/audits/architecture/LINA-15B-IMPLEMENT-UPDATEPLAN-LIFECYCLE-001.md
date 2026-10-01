# Relatório de Implementação: LINA-15B — Reconciliação `updatePlan` ↔ `EmbeddingLifecycleSnapshot`

**Identificador:** `LINA-15B-IMPLEMENT-UPDATEPLAN-LIFECYCLE-001`
**Data:** 2026-10-01
**Autor:** Arquiteto de Software Sénior & Engenheiro de Embeddings
**Âmbito:** Reconciliação canónica entre o planeador de atualização (`updatePlan`), o modelo de ciclo de vida (`EmbeddingLifecycleSnapshot`), a decisão do Write Path (`deriveEmbeddingWritePathDecision`), o Scheduler e o Worker.
**Estado:** **IMPLEMENTADA E VALIDADA**

---

## 1. Finding e Causa Raiz

### 1.1 Finding F-03
A auditoria global pós-LINA-14 identificou que planos de reconstrução total destrutiva (`updatePlan.mode = "full-rebuild"`) — originados por manifestos legados incompletos (`published-identity-incomplete`), identidades canónicas mistas (`canonical-identity-mixed`), registos com modelo divergente (`canonical-record-identity-mismatch`) ou duplicados/inválidos — eram silenciosamente rebaixados para `UPDATE_AVAILABLE` com `action = "update"` e `requiresConfirmation = false`. O Scheduler com política `automatic-local-only` aprovava o auto-despacho em segundo plano (`canDispatch = true`), violando a invariante de segurança "reconstruções destrutivas exigem confirmação explícita do utilizador".

### 1.2 Causa Raiz
1. `ClassifyEmbeddingWorkInput` e `classifyEmbeddingWork` em [`src/index/embeddingLifecycleModel.ts`](src/index/embeddingLifecycleModel.ts) ignoravam completamente o `planMode` e `planReasons` calculados pelo planeador central (`calculateEmbeddingUpdatePlan`), tentando reclassificar o modo apenas a partir de contagens (`toGenerateCount > 0` ⇒ `mode: "incremental"`).
2. O adapter [`src/index/embeddingLifecycleAdapter.ts`](src/index/embeddingLifecycleAdapter.ts) não encaminhava o `mode` e `reasons` do `updatePlan` para a classificação factual.
3. A função [`src/index/embeddingWorkStatusController.ts`](src/index/embeddingWorkStatusController.ts) (`buildEmbeddingWorkLifecycleSnapshot`) sobrescrevia as dimensões publicadas com as dimensões do alvo e fixava `inputVersion: 1`, mascarando discrepâncias de identidade entre o índice publicado e as definições ativas.

---

## 2. Correção Implementada

### 2.1 Enriquecimento do Modelo Factual (`src/index/embeddingLifecycleModel.ts`)
- Expandida a interface `ClassifyEmbeddingWorkInput` com os campos opcionais `planMode?: "initial-build" | "incremental" | "full-rebuild" | "indeterminate"` e `planReasons?: readonly string[]`.
- Atualizada a função `classifyEmbeddingWork`:
  - Se `planMode === "indeterminate"` ou `canonicalReadability === "unreadable"` ⇒ classifica estritamente como `kind: "indeterminate"`, `severity: "none"`.
  - Se `planMode === "initial-build"` ou `!canonicalExists` ⇒ classifica como `kind: "pending"`, `mode: "initial-build"`, `severity: "action"`.
  - Se `planMode === "full-rebuild"` ou se for detetada incompatibilidade entre `publishedIdentity` e `targetIdentity` ⇒ classifica como `kind: "pending"`, `mode: "full-rebuild"`, `severity: "blocking"`, preservando as razões do planeador.
- Atualizado o resolver `resolveEmbeddingLifecycle`:
  - Quando o trabalho factual exige reconstrução total (`effectiveWork.mode === "full-rebuild"`), `readCompatible` é avaliado como `false`, `read.semanticAvailable` é `false`, `read.effectiveMode` torna-se `"text-only"`, `read.compatibility.status` torna-se `"incompatible"` e o estado primário é resolvido como **`INCOMPATIBLE`**.
  - Assegurada a total conformidade com os invariantes canónicos I1 a I15 (incluindo o invariante I3: `primary === "INCOMPATIBLE" ⇒ read.effectiveMode !== "full"`).

### 2.2 Encaminhamento no Adapter (`src/index/embeddingLifecycleAdapter.ts`)
- A função `adaptCurrentStateToLifecycleSnapshot` agora encaminha `planMode: inputs.updatePlan.mode` e `planReasons: inputs.updatePlan.reasons` diretamente para `classifyEmbeddingWork`.

### 2.3 Correção de Identidades no Controller (`src/index/embeddingWorkStatusController.ts`)
- Corrigida a função `buildEmbeddingWorkLifecycleSnapshot`:
  - `targetIdentity.inputVersion` agora consome `safeSummary.updatePlan?.targetIdentity?.inputVersion ?? 1`.
  - `publishedIdentity.dimensions` agora preserva `safeSummary.dimensions` (prioridade real da persistência) em vez de priorizar o alvo.

---

## 3. Comportamento Anterior vs Posterior

| Cenário | Comportamento Anterior (Buggy) | Comportamento Posterior (Corrigido) |
|---|---|---|
| **Manifesto Legado (`published-identity-incomplete`)** | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: false`<br>`canDispatch: true` (auto-dispatch) | `primary: INCOMPATIBLE`<br>`action: rebuild`<br>`requiresConfirmation: true`<br>`canDispatch: false` (**auto-dispatch bloqueado**) |
| **Canónico Misto (`canonical-identity-mixed`)** | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: false` | `primary: INCOMPATIBLE`<br>`action: rebuild`<br>`requiresConfirmation: true`<br>`canDispatch: false` |
| **Registo Divergente (`canonical-record-identity-mismatch`)** | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: false` | `primary: INCOMPATIBLE`<br>`action: rebuild`<br>`requiresConfirmation: true`<br>`canDispatch: false` |
| **Alteração de Dimensões / Prefixo / Modelo** | `primary: INCOMPATIBLE`<br>`action: rebuild`<br>`requiresConfirmation: true` | `primary: INCOMPATIBLE`<br>`action: rebuild`<br>`requiresConfirmation: true`<br>`canDispatch: false` |
| **Atualização Incremental Normal (Local)** | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: false`<br>`canDispatch: true` | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: false`<br>`canDispatch: true` |
| **Atualização Incremental Normal (Externa)** | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: true`<br>`canDispatch: false` | `primary: UPDATE_AVAILABLE`<br>`action: update`<br>`requiresConfirmation: true`<br>`canDispatch: false` |
| **Canónico Ilegível (`canonical-unreadable`)** | `primary: INDETERMINATE`<br>`action: none`<br>`canExecute: false` | `primary: INDETERMINATE`<br>`action: none`<br>`canExecute: false`<br>`canDispatch: false` |

---

## 4. Invariantes Preservados

1. **Modelo Canónico Único:** `EmbeddingLifecycleSnapshot` permanece a representação normativa de todo o subsistema de embeddings.
2. **Motor de Decisão Canónico Único:** `deriveEmbeddingWritePathDecision()` permanece a única função autorizada a traduzir snapshots em decisões e ações.
3. **Rebuild Destrutivo com Confirmação:** Nenhuma operação `full-rebuild` pode ser despachada sem confirmação explícita do utilizador.
4. **Zero Auto-Dispatch para Rebuild:** O Scheduler recusa categoricamente despachar ações `rebuild` ou quando `requiresConfirmation === true`.
5. **Start Gate Blindado:** `evaluateOperationStartGate` rejeita execuções automáticas para qualquer operação que exija confirmação (`confirmation-required`).

---

## 5. Testes Adicionados e Validação Completa

Criada a suíte de testes de integração e invariantes em [`tests/index/embeddingPlanLifecycleReconciliation.test.ts`](tests/index/embeddingPlanLifecycleReconciliation.test.ts):
- 8 testes cobrindo todos os fluxos de full-rebuild, atualizações incrementais locais/externas, indexação inicial, indeterminação e isolamento de Standby.

### Resultados dos Quality Gates:
- `npm test`: **148 ficheiros / 1955 testes aprovados (100%)**, exit 0.
- `npm run typecheck`: **Aprovado sem erros**, exit 0.
- `npm run lint:obsidian:strict`: **0 erros, 0 avisos**, exit 0.
- `npm run build`: **Build de produção concluído com sucesso**, exit 0.
- `npm run release-check`: **READY FOR OBSIDIAN RELEASE**, exit 0.
- `git diff --check`: **0 erros de formatação/whitespace**, exit 0.

---

## 6. Dívida Técnica Restante Encaminhada

- **LINA-15C:** Separação entre teto de leitura JSONL e corrupção real em `INDETERMINATE` (Finding F-04).
- **LINA-15D:** Remoção dos sintetizadores paralelos de snapshots e identidades fabricadas (Findings F-06 e F-07).
- **LINA-15E:** Ligação direta da Sidebar à decisão canónica `deriveEmbeddingWritePathDecision` (Finding F-05).
